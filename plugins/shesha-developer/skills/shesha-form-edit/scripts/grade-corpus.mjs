#!/usr/bin/env node
/**
 * grade-corpus.mjs — Phase 2 Task 5.
 *
 * Grades tier1/tier2/tier3 (and the normalizer's mechanical effect) over a
 * large corpus of REAL production form markup, so the project can answer:
 * "does the validator accuse real, working forms of things that are not
 * actually wrong?"
 *
 * Corpus data is NEVER read from or written into this repo. This script
 * reads a JSONL dump from an explicit --in path (outside the repo,
 * typically the scratchpad) and writes its own JSON report to an explicit
 * --out path (also outside the repo). Nothing here touches the repo except
 * this script file itself.
 *
 * Each JSONL line is `{ db, form, module, label, model, len, markup }` where
 * `markup` is a JSON-encoded STRING (escaped JSON, needs a second parse) —
 * this is exactly the shape `frwk.form_configurations.markup` / the old
 * `Frwk_FormConfigurations.Markup` column comes back as from SQL Server.
 *
 * Usage:
 *   node scripts/grade-corpus.mjs --in <corpus.jsonl> --out <report.json> [--seeds]
 *
 * --seeds also grades the bundled assets/examples/*.json + assets/patterns/*.json
 * + assets/exemplars/*.json seed forms as a SEPARATE cohort (these are NOT
 * read from --in; they are read directly from this skill's own assets/,
 * which is fine to read from — the constraint is not committing CORPUS data,
 * and the seeds are already committed, versioned project assets, not corpus
 * data).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tier1 } from './lib/tier1.mjs';
import { tier2 } from './lib/tier2.mjs';
import { tier3 } from './lib/tier3.mjs';
import { flatten } from './lib/walk.mjs';
import { normalize } from './normalize-form.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(SCRIPT_DIR);

const REGISTRY_PATH = join(SKILL_ROOT, 'assets/registry/registry-0.45.1.json');
const ROLES_PATH = join(SKILL_ROOT, '../shesha-design-system/assets/roles.styles.json');
const TOKENS_PATH = join(SKILL_ROOT, '../shesha-design-system/assets/themes/shesha.tokens.json');
const EXAMPLES_DIR = join(SKILL_ROOT, 'assets/examples');
const PATTERNS_DIR = join(SKILL_ROOT, 'assets/patterns');
const EXEMPLARS_DIR = join(SKILL_ROOT, 'assets/exemplars');

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const opts = { seeds: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') opts.in = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--seeds') opts.seeds = true;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Grading a single form's markup object through all three tiers + normalizer.
// ---------------------------------------------------------------------------

function gradeMarkup(markup, ctx) {
  const t1 = tier1(markup, { registry: ctx.registry });
  const t2Raw = tier2(markup, { registry: ctx.registry, roles: ctx.roles });
  const t2 = t2Raw.filter((f) => f.severity !== 'skip');
  const t3 = tier3(markup, { registry: ctx.registry, thresholds: ctx.thresholds });

  // Normalizer effect: findings BEFORE vs findings the normalized output
  // would still trip (tier1+tier2 only — those are the ones the push-hook
  // would gate on; tier3 is observe-only and not part of the "findings
  // cleared" argument for the normalizer's existence).
  let normalized = null;
  let t1After = [];
  let t2After = [];
  try {
    normalized = normalize(markup, { registry: ctx.registry, roles: ctx.roles, tokens: ctx.tokens });
    t1After = tier1(normalized, { registry: ctx.registry });
    t2After = tier2(normalized, { registry: ctx.registry, roles: ctx.roles }).filter((f) => f.severity !== 'skip');
  } catch (err) {
    // A normalizer crash on some corpus shape is itself useful information —
    // record it but don't let it kill the whole grading run.
    normalized = { __normalizeError: err.message };
  }

  // componentCount/bindings MUST match tier3.mjs's OWN checkComponentRatio
  // arithmetic exactly (entries.length / entries-with-a-propertyName-count,
  // both over walk.mjs's flatten() — which does NOT descend into
  // buttonGroup/datatable `items[]`, per tier2.mjs's own documented reason:
  // items carry no top-level `type` and are not separately walked). An
  // earlier version of this script re-implemented its own deep traversal
  // that DID count `items[].propertyName` (e.g. every datatable column) as
  // a "binding" while NOT counting those same items as "components" — that
  // mismatch silently deflated the ratio for every table-shaped form and
  // would have corrupted the calibration in Step 6. Reusing the checked-in
  // `flatten()` guarantees this script measures the exact same ratio the
  // check itself computes at runtime.
  const components = Array.isArray(markup?.components) ? markup.components : [];
  const entries = flatten(components);
  const componentCount = entries.length;
  const bindings = entries.filter(({ node }) => typeof node.propertyName === 'string' && node.propertyName.length > 0).length;

  return {
    t1, t2, t3,
    before: { t1: t1.length, t2: t2.length },
    after: { t1: t1After.length, t2: t2After.length },
    normalizeError: normalized && normalized.__normalizeError ? normalized.__normalizeError : null,
    componentCount,
    bindings,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function newAgg() {
  return {
    total: 0,
    parseErrors: 0,
    byCode: {}, // code -> { forms: Set<label>, instances: 0, examples: [] }
    perForm: [], // { key, t1, t2, t3score, componentCount, bindings, ratio }
    normalizerClearedTotal: 0,
    normalizerClearedForms: 0,
    normalizeErrors: [],
  };
}

function recordFinding(agg, code, formKey) {
  if (!agg.byCode[code]) agg.byCode[code] = { forms: new Set(), instances: 0, examples: [] };
  const entry = agg.byCode[code];
  entry.instances++;
  if (!entry.forms.has(formKey)) {
    entry.forms.add(formKey);
    if (entry.examples.length < 3) entry.examples.push(formKey);
  }
}

function gradeOne(agg, formKey, markup, ctx) {
  agg.total++;
  let graded;
  try {
    graded = gradeMarkup(markup, ctx);
  } catch (err) {
    agg.parseErrors++;
    return;
  }

  for (const f of graded.t1) recordFinding(agg, f.code, formKey);
  for (const f of graded.t2) recordFinding(agg, f.code, formKey);
  for (const f of graded.t3.findings) recordFinding(agg, f.code, formKey);

  const before = graded.before.t1 + graded.before.t2;
  const after = graded.after.t1 + graded.after.t2;
  const cleared = Math.max(0, before - after);
  agg.normalizerClearedTotal += cleared;
  if (cleared > 0) agg.normalizerClearedForms++;
  if (graded.normalizeError) agg.normalizeErrors.push({ formKey, error: graded.normalizeError });

  agg.perForm.push({
    key: formKey,
    t1: graded.t1.length,
    t2: graded.t2.length,
    t3score: graded.t3.score,
    componentCount: graded.componentCount,
    bindings: graded.bindings,
    ratio: graded.bindings > 0 ? graded.componentCount / graded.bindings : null,
    before,
    after,
  });
}

function summarize(agg) {
  const codes = Object.entries(agg.byCode)
    .map(([code, v]) => ({
      code,
      formsAffected: v.forms.size,
      hitRatePct: agg.total > 0 ? Number(((v.forms.size / agg.total) * 100).toFixed(1)) : 0,
      instances: v.instances,
      examples: [...v.examples],
    }))
    .sort((a, b) => b.formsAffected - a.formsAffected || b.instances - a.instances);

  return {
    total: agg.total,
    parseErrors: agg.parseErrors,
    codes,
    normalizer: {
      formsWithFindingsCleared: agg.normalizerClearedForms,
      totalFindingsCleared: agg.normalizerClearedTotal,
      normalizeErrorCount: agg.normalizeErrors.length,
      normalizeErrorSample: agg.normalizeErrors.slice(0, 5),
    },
    perForm: agg.perForm,
  };
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

function* readJsonlForms(path) {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const key = `${row.db ?? '?'}/${row.module ?? '?'}/${row.form ?? '?'}`;
    let markup;
    try {
      markup = typeof row.markup === 'string' ? JSON.parse(row.markup) : row.markup;
    } catch {
      yield { key, markup: null, parseError: true };
      continue;
    }
    yield { key, markup };
  }
}

function loadSeedForms() {
  const out = [];
  for (const dir of [EXAMPLES_DIR, PATTERNS_DIR, EXEMPLARS_DIR]) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      const key = `seeds/${f}`;
      try {
        out.push({ key, markup: loadJson(join(dir, f)) });
      } catch {
        out.push({ key, markup: null, parseError: true });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.in) {
    console.error('Usage: node scripts/grade-corpus.mjs --in <corpus.jsonl> --out <report.json> [--seeds]');
    process.exit(1);
  }

  const registry = loadJson(REGISTRY_PATH);
  let roles = {};
  try { roles = loadJson(ROLES_PATH); } catch { /* optional */ }
  let tokens = {};
  try { tokens = loadJson(TOKENS_PATH); } catch { /* optional */ }
  // thresholds are intentionally NOT loaded from assets/thresholds.json here:
  // T3-COMPONENT-RATIO is skipped entirely without a budget, and this run's
  // whole point is to MEASURE ratios across the corpus in order to derive
  // that budget — reading the (still-provisional) file first would bias the
  // very numbers being calibrated.
  const ctx = { registry, roles, tokens, thresholds: {} };

  const corpusAgg = newAgg();
  for (const { key, markup, parseError } of readJsonlForms(opts.in)) {
    if (parseError || !markup) { corpusAgg.parseErrors++; continue; }
    gradeOne(corpusAgg, key, markup, ctx);
  }

  const result = { corpus: summarize(corpusAgg) };

  if (opts.seeds) {
    const seedAgg = newAgg();
    for (const { key, markup, parseError } of loadSeedForms()) {
      if (parseError || !markup) { seedAgg.parseErrors++; continue; }
      gradeOne(seedAgg, key, markup, ctx);
    }
    result.seeds = summarize(seedAgg);
  }

  const json = JSON.stringify(result, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json, 'utf8');
    console.log(`Wrote report to ${opts.out}`);
    console.log(`Corpus: ${result.corpus.total} forms graded, ${result.corpus.parseErrors} parse errors.`);
    if (result.seeds) console.log(`Seeds: ${result.seeds.total} forms graded, ${result.seeds.parseErrors} parse errors.`);
  } else {
    console.log(json);
  }
}

main();
