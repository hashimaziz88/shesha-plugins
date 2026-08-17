// Generates packages/sfs/registry/decisions.json from /DECISIONS.md (D-029).
//
// g-decisions runs this same parser and byte-compares the result against the
// committed file, so there is exactly one decision registry and the machine-
// readable copy cannot drift from the human-readable one.
//
// Usage: node packages/registry/src/gen-decisions.mjs [--check]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDecisions, toDecisionsJson } from './decisions.mjs';

const EXIT = { pass: 0, fail: 1, usage: 2 };

/** @returns {string} repository root, resolved from this file */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** @returns {string} the generated artifact's path, relative to the repo root */
export const GENERATED_PATH = 'packages/sfs/registry/decisions.json';

/**
 * @param {string} root
 * @returns {{ok:true, json:string} | {ok:false, reason:string}}
 */
export function generate(root) {
  const src = path.join(root, 'DECISIONS.md');
  let text;
  try { text = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch {
    return { ok: false, reason: 'DECISIONS.md does not exist' };
  }
  const parsed = parseDecisions(text);
  if (parsed.rows.length === 0) return { ok: false, reason: 'DECISIONS.md contains no parsable rows' };
  return { ok: true, json: toDecisionsJson(parsed.rows) };
}

async function main() {
  const root = repoRoot();
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
