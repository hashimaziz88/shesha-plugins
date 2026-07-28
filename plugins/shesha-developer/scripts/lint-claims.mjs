#!/usr/bin/env node
/**
 * lint-claims.mjs — fails when a designer doc asserts something no code enforces.
 *
 * This release exists because the documentation described a compiler that did not
 * exist. This lint is the mechanism that stops that happening again.
 *
 * Two checks over every SKILL.md and reference doc in the designer surface:
 *
 *   1. RULE CITATIONS. A doc citing [R-xxx] must cite a rule that exists in
 *      _rules.json. If the citation appears in strong-claim language, that rule
 *      must also carry a `validator` naming a script that exists on disk.
 *
 *   2. STRONG CLAIMS. A line asserting MUST / measured / fail-closed / enforced /
 *      non-negotiable / guaranteed / blocking must have an enforcement anchor
 *      within ANCHOR_WINDOW lines — a script path, a runnable command, a hook
 *      name, or a validator-backed rule id. A claim with nothing to point at is
 *      either softened or deleted.
 *
 * Usage:
 *   node scripts/lint-claims.mjs            # lint, exit 1 on findings
 *   node scripts/lint-claims.mjs --list     # also print every claim it accepted
 *
 * Scope is deliberately the four designer skills plus the plugin root. Other
 * skills are out of scope for this release and are not linted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANCHOR_WINDOW = 6;

const SCOPE = [
  'skills/shesha-claude-designer',
  'skills/shesha-design-comprehension',
  'skills/shesha-form-edit',
  'skills/shesha-design-system',
  'agents',
  'commands',
];

// Vocabulary that promises mechanical enforcement. Matched case-sensitively for
// MUST (so ordinary prose "must" does not trip it) and case-insensitively for
// the rest, which are unambiguous regardless of case.
const STRONG = [
  { re: /\bMUST\b/, label: 'MUST' },
  { re: /\bNON-NEGOTIABLE\b/i, label: 'non-negotiable' },
  { re: /\bfail-closed\b/i, label: 'fail-closed' },
  { re: /\bfails? closed\b/i, label: 'fails closed' },
  { re: /\benforced\b/i, label: 'enforced' },
  { re: /\bmechanically (?:enforced|checked|killed)\b/i, label: 'mechanically enforced' },
  { re: /\bguarantee[ds]?\b/i, label: 'guaranteed' },
  { re: /\bblocking gate\b/i, label: 'blocking gate' },
  { re: /\bis measured\b/i, label: 'is measured' },
  { re: /\bmeasured, not\b/i, label: 'measured, not' },
];

// Anything that makes a claim checkable: a script/hook path, a runnable command,
// an npm script, or a validator-backed rule id (handled separately).
const ANCHOR = [
  /\b[\w./-]+\.(?:js|mjs|cjs|json|ps1|sh)\b/,
  /\bnode\s+\S+/,
  /\bnpm\s+(?:run\s+)?\w+/,
  /\bhook-[\w-]+\b/,
  /\bscripts\/[\w./-]+/,
  /\bhooks\/[\w./-]+/,
  /`[^`]*\b(?:validate|compile|resolve|render|lint|probe)[\w-]*\b[^`]*`/,
];

function loadRules() {
  const p = path.join(PLUGIN_ROOT, 'skills/shesha-form-edit/references/_rules.json');
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  const byId = new Map();
  for (const r of doc.rules) byId.set(r.id, r);
  return byId;
}

function validatorResolves(rule) {
  if (!rule?.validator) return false;
  const list = Array.isArray(rule.validator) ? rule.validator : [rule.validator];
  const skill = path.join(PLUGIN_ROOT, 'skills/shesha-form-edit');
  return list.length > 0 && list.every((rel) => fs.existsSync(path.resolve(skill, rel)));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const rules = loadRules();
const files = SCOPE.flatMap((s) => walk(path.join(PLUGIN_ROOT, s)));
const findings = [];
const accepted = [];

for (const file of files) {
  const rel = path.relative(PLUGIN_ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  // Fenced code blocks are examples, not assertions.
  const inFence = new Array(lines.length).fill(false);
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; inFence[i] = true; return; }
    inFence[i] = fence;
  });

  lines.forEach((line, i) => {
    if (inFence[i]) return;
    const lineNo = i + 1;

    // --- check 1: rule citations resolve ---
    const cited = [...line.matchAll(/\[?(R-\d{3})\]?/g)].map((m) => m[1]);
    for (const id of new Set(cited)) {
      if (!rules.has(id)) {
        findings.push({ rel, lineNo, kind: 'unknown-rule',
          msg: `cites ${id}, which is not in _rules.json` });
      }
    }

    // --- check 2: strong claims have an enforcement anchor ---
    const hit = STRONG.find((s) => s.re.test(line));
    if (!hit) return;

    const from = Math.max(0, i - ANCHOR_WINDOW);
    const to = Math.min(lines.length, i + ANCHOR_WINDOW + 1);
    const window = lines.slice(from, to).join('\n');

    const hasPathAnchor = ANCHOR.some((re) => re.test(window));
    const backedRule = [...window.matchAll(/R-\d{3}/g)]
      .map((m) => m[0]).find((id) => validatorResolves(rules.get(id)));

    if (hasPathAnchor || backedRule) {
      accepted.push(`${rel}:${lineNo}  ${hit.label} → ${backedRule ? `${backedRule} (${
        [].concat(rules.get(backedRule).validator).join(', ')})` : 'script/command in range'}`);
      return;
    }

    // A cited rule with no validator is the specific failure this lint exists for.
    const unbacked = [...window.matchAll(/R-\d{3}/g)].map((m) => m[0])
      .filter((id) => rules.has(id) && !validatorResolves(rules.get(id)));

    findings.push({
      rel, lineNo, kind: 'unenforced-claim',
      msg: unbacked.length
        ? `asserts "${hit.label}" citing ${[...new Set(unbacked)].join(', ')}, which ${
          unbacked.length > 1 ? 'have' : 'has'} no validator — soften the wording or add the check`
        : `asserts "${hit.label}" with no script, command, hook or validator-backed rule within ${
          ANCHOR_WINDOW} lines`,
      excerpt: line.trim().slice(0, 120),
    });
  });
}

if (process.argv.includes('--list')) {
  console.log(`# accepted claims (${accepted.length})`);
  for (const a of accepted) console.log(`  ${a}`);
  console.log('');
}

console.log(`lint-claims: ${files.length} docs, ${accepted.length} claims backed, ${findings.length} findings`);

if (!findings.length) process.exit(0);

console.error('');
for (const f of findings) {
  console.error(`${f.rel}:${f.lineNo}  [${f.kind}]  ${f.msg}`);
  if (f.excerpt) console.error(`    ${f.excerpt}`);
}
console.error(
  `\n${findings.length} unbacked claim(s). Every MUST/enforced/fail-closed/measured assertion needs `
  + `a script, command, hook or a validator-backed rule id within ${ANCHOR_WINDOW} lines. `
  + `Fix the claim or add the enforcement — do not add a document.`
);
process.exit(1);
