// Generates packages/sfs/registry/decisions.json from /DECISIONS.md (D-029).
//
// g-decisions runs this same parser and byte-compares the result against the
// committed file, so there is exactly one decision registry and the machine-
// readable copy cannot drift from the human-readable one.
//
// Usage: node packages/registry/src/gen-decisions.mjs [--check | --archive]
//
// --archive moves closed rows out of DECISIONS.md into docs/decisions-archive.md
// until the live file is under its target (D-075). The registry is the UNION of
// the two files, so this moves bytes out of the prompt and never a rule out of
// the gate. It refuses to move an open row and refuses to raise any cap.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseDecisions, toDecisionsJson, readRegistry, isArchivable, ARCHIVE_PATH, ARCHIVE_HEADINGS,
} from './decisions.mjs';

const EXIT = { pass: 0, fail: 1, usage: 2 };

/** Where the archive's own knobs live. Data, so no size is a literal in code. */
export const ARCHIVE_CONFIG = 'packages/verify/config/decisions-archive.json';

/** @returns {string} repository root, resolved from this file */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** @returns {string} the generated artifact's path, relative to the repo root */
export const GENERATED_PATH = 'packages/sfs/registry/decisions.json';

/**
 * Read one repo-relative file with the same normalisation the gates use, or null.
 * @param {string} root
 * @returns {(rel:string) => string|null}
 */
function readerFor(root) {
  return (rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch { return null; }
  };
}

/**
 * @param {string} root
 * @returns {{ok:true, json:string} | {ok:false, reason:string}}
 */
export function generate(root) {
  const read = readerFor(root);
  if (read('DECISIONS.md') === null) return { ok: false, reason: 'DECISIONS.md does not exist' };
  const { rows } = readRegistry(read);
  if (rows.length === 0) return { ok: false, reason: 'DECISIONS.md contains no parsable rows' };
  return { ok: true, json: toDecisionsJson(rows) };
}

/**
 * Rewrite a decisions table file, replacing its data rows with `rows` and keeping
 * everything else (headings, the header row, the separator, any fenced block)
 * byte-identical. Row text is never regenerated from the parsed cells — a
 * round-trip through the parser would silently reformat cells, and the archive
 * has to be a move, not a rewrite.
 * @param {string} text
 * @param {Set<string>} keepIds
 * @returns {string}
 */
function withOnlyRows(text, keepIds) {
  return `${text.split('\n')
    .filter((line) => {
      const m = /^\|\s*(D-\d{3})\s*\|/.exec(line.trim());
      return m === null || keepIds.has(m[1] ?? '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/**
 * Move the fewest closed rows needed to bring DECISIONS.md under its target.
 * @param {string} root
 * @returns {{ok:true, moved:string[], liveBytes:number, target:number} | {ok:false, reason:string}}
 */
export function archive(root) {
  const read = readerFor(root);
  const cfgText = read(ARCHIVE_CONFIG);
  if (cfgText === null) return { ok: false, reason: `${ARCHIVE_CONFIG} does not exist` };
  /** @type {{liveTargetBytes:number, keepMinLive:number}} */
  const cfg = JSON.parse(cfgText);

  const liveText = read('DECISIONS.md');
  if (liveText === null) return { ok: false, reason: 'DECISIONS.md does not exist' };
  const live = parseDecisions(liveText);
  const archiveText = read(ARCHIVE_PATH);

  const byId = new Map(live.rows.map((r) => [r.id, r]));
  const candidates = live.rows.filter(isArchivable).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));

  /** @type {string[]} */
  const moved = [];
  let keptIds = new Set(live.rows.map((r) => r.id));
  let bytes = Buffer.byteLength(withOnlyRows(liveText, keptIds), 'utf8');

  for (const row of candidates) {
    if (bytes <= cfg.liveTargetBytes) break;
    if (keptIds.size - 1 < cfg.keepMinLive) break;
    keptIds.delete(row.id);
    moved.push(row.id);
    bytes = Buffer.byteLength(withOnlyRows(liveText, keptIds), 'utf8');
  }

  if (bytes > cfg.liveTargetBytes) {
    return {
      ok: false,
      reason: `cannot reach the ${cfg.liveTargetBytes} B target: ${bytes} B remain with ${keptIds.size} live row(s), `
        + `${candidates.length - moved.length} closed row(s) left and keepMinLive=${cfg.keepMinLive}. `
        + 'Shorten cells or lower keepMinLive; raising the target is forbidden.',
    };
  }
  if (moved.length === 0) return { ok: true, moved, liveBytes: bytes, target: cfg.liveTargetBytes };

  // The moved rows keep their exact source line, so the archive is a move.
  const movedLines = moved.map((id) => {
    const r = byId.get(id);
    return liveText.split('\n')[/** @type {{line:number}} */ (r).line - 1];
  });

  const header = '| ID | Date | Status | Decision | Why | Consequence | Enforced by | Confirmation |\n'
    + '|---|---|---|---|---|---|---|---|';
  const existing = archiveText === null
    ? `${ARCHIVE_HEADINGS[0]}\n\n${header}\n`
    : `${withOnlyRows(archiveText, new Set(parseDecisions(archiveText).rows.map((r) => r.id)))}`;
  fs.writeFileSync(path.join(root, ARCHIVE_PATH), `${existing.trimEnd()}\n${movedLines.join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'DECISIONS.md'), withOnlyRows(liveText, keptIds));
  return { ok: true, moved, liveBytes: bytes, target: cfg.liveTargetBytes };
}

async function main() {
  const root = repoRoot();

  if (process.argv.includes('--archive')) {
    const moved = archive(root);
    if (!moved.ok) { console.error(`gen-decisions --archive: ${moved.reason}`); return EXIT.fail; }
    console.log(moved.moved.length === 0
      ? `gen-decisions --archive: nothing to move · DECISIONS.md is ${moved.liveBytes} B of ${moved.target} B`
      : `gen-decisions --archive: moved ${moved.moved.length} closed row(s) to ${ARCHIVE_PATH} `
        + `(${moved.moved[0]}..${moved.moved[moved.moved.length - 1]}) · DECISIONS.md now ${moved.liveBytes} B of ${moved.target} B`);
  }

  const got = generate(root);
  if (!got.ok) { console.error(`gen-decisions: ${got.reason}`); return EXIT.fail; }

  const out = path.join(root, GENERATED_PATH);
  const check = process.argv.includes('--check');
  const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : null;

  if (check) {
    if (existing === got.json) { console.log(`gen-decisions: ${GENERATED_PATH} is identical`); return EXIT.pass; }
    console.error(`gen-decisions: ${GENERATED_PATH} differs from DECISIONS.md — run without --check to regenerate`);
    return EXIT.fail;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, got.json);
  const n = JSON.parse(got.json).count;
  console.log(`gen-decisions: wrote ${GENERATED_PATH} · ${n} decisions${existing === got.json ? ' (unchanged)' : ''}`);
  return EXIT.pass;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main());
}
