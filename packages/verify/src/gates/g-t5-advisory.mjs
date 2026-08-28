// D-015 (§3.6 T5-R8, T5-R9): T5 visual is advisory. `verdict.result` is byte-identical
// whichever score T5 reports, and no push is admitted or refused because of it.
//
// Advisory-ness is not a property anyone can read off a rubric — it is a property of two
// code paths and one ledger, so this gate holds all three:
//
//   pushIsolation  — the push-admission path (the gate-push hook, its pure decide module,
//                    and packages/verify/src/bin/push-admissible.mjs) contains ZERO
//                    references to t5, in any case. A path that cannot name T5 cannot be
//                    made to consult it, which is a stronger statement than "it currently
//                    does not".
//   resultIsolation — RESULT_TIERS in packages/verify/src/verify.mjs is the whole input to
//                    `result`, and it names neither T4 nor T5; and the block that computes
//                    `result` does not reference T5 either. T5 may be recorded in
//                    verdict.tiers; it may not reach the verdict.
//   gapLedger      — T5-R9: packages/verify/anchors/judge-truth-gap.json carries an entry
//                    for the current release. An advisory signal whose disagreement with
//                    hand review is unmeasured is not advisory, it is unaccountable.
//
// The version is read from plugins/shesha-developer/.claude-plugin/plugin.json when that
// file exists, falling back to the root package.json `version`; the root package is a
// private workspace root pinned at 0.0.0, so the plugin manifest is the release identity
// this repository actually ships.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { repoRoot, readText } from '../lib/fsx.mjs';

export const id = 'g-t5-advisory';
export const describe = 'T5 is advisory: the push-admission path and the result computation carry no t5 reference, and the judge-truth gap is recorded for this release (D-015)';
export const inputPaths = [
  '.claude/hooks/gate-push.mjs',
  '.claude/hooks/gate-push.decide.mjs',
  'packages/verify/src/bin/push-admissible.mjs',
  'packages/verify/src/verify.mjs',
  'packages/verify/anchors/judge-truth-gap.json',
  'plugins/shesha-developer/.claude-plugin/plugin.json',
  'package.json',
];

/** Every file on the push-admission path. The hook detects; these decide. */
const PUSH_FILES = [
  '.claude/hooks/gate-push.mjs',
  '.claude/hooks/gate-push.decide.mjs',
  'packages/verify/src/bin/push-admissible.mjs',
];
const VERIFY = 'packages/verify/src/verify.mjs';
const LEDGER = 'packages/verify/anchors/judge-truth-gap.json';
/** In precedence order: the shipped plugin manifest, then the workspace root. */
const VERSION_SOURCES = [
  'plugins/shesha-developer/.claude-plugin/plugin.json',
  'package.json',
];

/** The tiers that may never enter `result`, whatever they report (D-015). */
const ADVISORY_TIERS = /^t[45]b?$/i;
const T5 = /t5/gi;
const RESULT_TIERS_DECL = /const\s+RESULT_TIERS\s*=\s*\[([^\]]*)\]/;
const RESULT_START = /let\s+result\s*=\s*'pass'\s*;/;

/**
 * @param {string} text
 * @returns {number}
 */
export function countT5(text) { return (text.match(T5) || []).length; }

/**
 * Drop `//` comments so a comment that merely EXPLAINS the rule ("T4/T5 never enter
 * result") is not read as the code that breaks it.
 * @param {string} text
 * @returns {string}
 */
function stripLineComments(text) {
  return text.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

/**
 * The source text of the block that computes `result`: from `let result = 'pass';`
 * through the end of the loop that folds the result tiers together. Brace-matched
 * rather than line-counted, so inserting a line inside it cannot slip past.
 * @param {string} text
 * @returns {string|null}
 */
export function resultBlock(text) {
  const start = RESULT_START.exec(text);
  if (start === null) return null;
  const open = text.indexOf('{', start.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start.index, i + 1);
    }
  }
  return null;
}

/**
 * The quoted tier ids inside `const RESULT_TIERS = [...]`, or null when the
 * declaration is absent.
 * @param {string} text
 * @returns {string[]|null}
 */
export function resultTiers(text) {
  const m = RESULT_TIERS_DECL.exec(text);
  if (m === null) return null;
  const body = m[1] ?? '';
  return [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2] ?? '');
}

/**
 * The release identity this repository ships, and where it was read from.
 * @param {string} root
 * @returns {{version:string, source:string}}
 */
export function currentVersion(root) {
  for (const src of VERSION_SOURCES) {
    const text = readText(path.join(root, src));
    if (text === null) continue;
    try {
      const v = JSON.parse(text).version;
      if (typeof v === 'string' && v !== '' && v !== '0.0.0') return { version: v, source: src };
    } catch { /* try the next source rather than inventing a version */ }
  }
  return { version: 'unknown', source: 'none' };
}

/**
 * @param {unknown} entry
 * @returns {string|null}
 */
function entryVersion(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (entry);
  const v = typeof o.version === 'string' ? o.version : o.release;
  return typeof v === 'string' ? v : null;
}

/**
 * Does the ledger carry an entry for `version`? Accepts the three shapes a
 * per-release ledger is legibly written in: a top-level array, a named array of
 * entries, or an object keyed by version.
 * @param {unknown} json
 * @param {string} version
 * @returns {boolean}
 */
export function hasRelease(json, version) {
  return releaseEntry(json, version) !== null;
}

/**
 * The ledger entry for `version`, in whichever of the accepted shapes the file uses.
 * @param {unknown} json @param {string} version @returns {any|null}
 */
export function releaseEntry(json, version) {
  if (json === null || typeof json !== 'object') return null;
  if (Array.isArray(json)) return json.find((e) => entryVersion(e) === version) ?? null;
  const obj = /** @type {Record<string, unknown>} */ (json);
  for (const key of ['releases', 'entries', 'records', 'versions']) {
    const v = obj[key];
    if (Array.isArray(v)) { const hit = v.find((e) => entryVersion(e) === version); if (hit) return hit; }
    else if (v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, version)) return /** @type {any} */ (v)[version];
  }
  return Object.prototype.hasOwnProperty.call(obj, version) ? obj[version] : null;
}

/**
 * T5-R9 asks for the NUMBER, and zero is a number — but an entry recording zero
 * hand-verified screens is only honest if it says which blocker stopped them being
 * verified. Without that rule the ledger could be satisfied forever by writing zeros,
 * which is silence wearing an entry's clothes.
 * @param {any} entry @returns {{ok:boolean, reason:string}}
 */
export function entryStatesTheGap(entry) {
  if (entry === null || typeof entry !== 'object') return { ok: false, reason: 'the entry is not an object' };
  const n = entry.handVerifiedScreens;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    return { ok: false, reason: 'handVerifiedScreens is not a whole number; T5-R9 asks for the count, and a count that is not stated is not recorded' };
  }
  if (n === 0) {
    const blocked = typeof entry.blocked === 'string' && /^(BL|B)-?\d+$/.test(entry.blocked.trim());
    return blocked
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'the entry records 0 hand-verified screens and names no `blocked` id; a gap of zero screens is only honest when it says what stopped them' };
  }
  if (typeof entry.gap !== 'number') return { ok: false, reason: `the entry records ${n} hand-verified screens but no numeric gap` };
  return { ok: true, reason: '' };
}

/**
 * The one line §3.6's acceptance row requires, alongside the coverage report.
 * @param {string} root
 * @returns {string}
 */
export function summaryLine(root) {
  let pushHits = 0;
  for (const f of PUSH_FILES) pushHits += countT5(readText(path.join(root, f)) || '');

  const block = resultBlock(readText(path.join(root, VERIFY)) || '');
  const resultHits = block === null ? 'unlocatable' : String(countT5(stripLineComments(block)));

  const { version } = currentVersion(root);
  const raw = readText(path.join(root, LEDGER));
  /** @type {unknown} */
  let ledger = null;
  if (raw !== null) { try { ledger = JSON.parse(raw); } catch { ledger = null; } }
  const gap = hasRelease(ledger, version)
    ? `judge-truth gap recorded for ${version}`
    : `judge-truth gap: unrecorded for ${version}`;

  return `t5 references in gate-push.mjs: ${pushHits} · t5 references in result computation: ${resultHits} · ${gap}`;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'pushIsolation', unit: 'file' },
    { name: 'resultIsolation', unit: 'file' },
    { name: 'gapLedger', unit: 'release' },
  ]);

  // ---- pushIsolation: the push path cannot name T5 ------------------------
  const pushFam = fams.get('pushIsolation');
  for (const f of PUSH_FILES) {
    const p = pushFam.pointer(f);
    const text = readText(path.join(root, f));
    if (text === null) {
      p.fail(`${f} is missing — push admission cannot be shown to be free of t5`);
      continue;
    }
    const hits = countT5(text);
    p.assert(hits === 0,
      `${f} carries ${hits} t5 reference(s); D-015 makes T5 advisory, so the push-admission path must not be able to see it at all`);
  }

  // ---- resultIsolation: T4/T5 never enter `result` ------------------------
  const resultFam = fams.get('resultIsolation');
  const tiersPointer = resultFam.pointer(`${VERIFY}#RESULT_TIERS`);
  const blockPointer = resultFam.pointer(`${VERIFY}#result`);
  const verifyText = readText(path.join(root, VERIFY));
  if (verifyText === null) {
    tiersPointer.fail(`${VERIFY} is missing — there is no result computation to hold advisory tiers out of`);
    blockPointer.fail(`${VERIFY} is missing — there is no result computation to inspect`);
  } else {
    const tiers = resultTiers(verifyText);
    if (tiers === null) {
      tiersPointer.fail(`${VERIFY} declares no \`const RESULT_TIERS = [...]\`; the input to \`result\` must be one named constant, not a scattered condition`);
    } else {
      const advisory = tiers.filter((t) => ADVISORY_TIERS.test(t));
      /** @type {string[]} */
      const problems = [];
      if (tiers.length === 0) problems.push('is empty, so `result` folds over nothing and is always pass');
      if (advisory.length > 0) problems.push(`admits ${advisory.join(', ')}, which D-015 keeps out of \`result\` entirely`);
      tiersPointer.assert(problems.length === 0, `${VERIFY} RESULT_TIERS ${problems.join('; ')}`);
    }

    const block = resultBlock(verifyText);
    if (block === null) {
      blockPointer.fail(`could not locate the \`let result = 'pass';\` block in ${VERIFY}; the result computation must stay one inspectable block`);
    } else {
      const hits = countT5(stripLineComments(block));
      blockPointer.assert(hits === 0,
        `the block computing \`result\` in ${VERIFY} carries ${hits} t5 reference(s); a visual score must not be able to move the verdict`);
    }
  }

  // ---- gapLedger: T5-R9, the judge-truth gap is published -----------------
  const gapFam = fams.get('gapLedger');
  const { version, source } = currentVersion(root);
  const got = readJsonGuarded(path.join(root, LEDGER), gapFam, LEDGER);
  const releasePointer = gapFam.pointer(`${LEDGER}#${version}`);
  if (!got.ok) {
    releasePointer.fail(`judge-truth gap: unrecorded for ${version} — ${LEDGER} is missing or unreadable (version read from ${source})`);
  } else {
    const entry = releaseEntry(got.value, version);
    if (entry === null) {
      releasePointer.fail(`judge-truth gap: unrecorded for ${version} — ${LEDGER} carries no entry for this release (version read from ${source}). ` +
        'If you cannot state the gap between the judge and hand review, you do not know whether the judge works');
    } else {
      const stated = entryStatesTheGap(entry);
      releasePointer.assert(stated.ok, `judge-truth gap for ${version} is present but does not state the gap: ${stated.reason}`);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'the gap ledger records zero hand-verified screens and names no blocker',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, LEDGER);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      // Silence wearing an entry's clothes: the release is listed, so the presence check
      // is satisfied, but nothing about the gap is actually stated.
      for (const e of j.releases || []) delete e.blocked;
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the push-admission program grows a t5 reference',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/bin/push-admissible.mjs');
      fs.appendFileSync(f, '\nexport const t5Weight = 1;\n');
    },
    expect: 'fail',
  },
  {
    name: 'RESULT_TIERS admits T5 into the verdict',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, VERIFY);
      const text = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, text.replace(RESULT_TIERS_DECL, "const RESULT_TIERS = ['T1', 'T2', 'T3', 'T5']"));
    },
    expect: 'fail',
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const root = repoRoot();
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));
    console.log(summaryLine(root));
    return exitFor(verdictOf(fams));
  }));
}
