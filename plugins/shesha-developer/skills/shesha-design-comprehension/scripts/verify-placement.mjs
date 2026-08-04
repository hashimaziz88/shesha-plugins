#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/verify-placement.mjs
 *
 * LAYER 3 — the placement oracle. Deterministic, typed, no interpretation.
 *
 *   node verify-placement.mjs --spec <blueprint.json> --evidence <evidence.json>
 *                             [--out <verdict.json>]
 *
 * stdout: JSON { verdict, results: [ { id, kind, outcome, expected, measured, … } ] }
 * exit:   0 all required assertions passed
 *         1 a required assertion did not (mismatch or unverifiable — fail-closed)
 *         2 usage / unreadable input
 *         3 malformed evidence (nothing measurable — an INFRASTRUCTURE failure,
 *           deliberately a different exit code from a placement mismatch)
 *
 * It reads the blueprint's TYPED `assertions` (../schemas/blueprint.schema.json)
 * and the ONE canonical render evidence document written by the render
 * instrument or by layout-probe.js. `description` fields are IGNORED — no
 * language-model interpretation happens anywhere in this file. Every verdict is
 * arithmetic over rects, rowBands, columnClusters and tabMembership, so the same
 * inputs always produce the same verdict.
 *
 * OUTCOMES are a closed set, and the failure modes stay distinguishable because
 * they route to different fixes:
 *   pass               — measured, and right
 *   mismatch           — measured, and wrong           → a placement fix
 *   unverifiable       — subject/target not resolvable  → a MISSING node, or an
 *                        assertion naming something the build never created
 *   malformed-evidence — the probe measured nothing     → fix the instrument
 *
 * ── SUBJECT / TARGET RESOLUTION (ONE rule) ───────────────────────────────────
 * An assertion's `subject`/`target` is a NAME. Resolution tries, in order, and
 * stops at the first step that yields EXACTLY ONE component:
 *   1. `name` exact match (case-sensitive)
 *   2. `name` exact match (case-insensitive)
 *   3. `propertyName` exact match (case-insensitive) — bound fields
 *   4. `type` exact match (case-insensitive) — the "the datatable" shorthand
 * Zero matches (absent) or more than one at the first non-empty step
 * (ambiguous) → `unverifiable`, with a message naming the string and why.
 *
 * ── TOLERANCES (documented, fixed, never per-form) ───────────────────────────
 *   CONTAIN_TOL  2px  per edge — containment survives a 1px border/rounding
 *   ALIGN_TOL    4px         — edge alignment
 *   ROW_TOL     12px         — same-row fallback when rowBands don't decide
 *   COL_TOL     16px         — same-column fallback on left edges
 *   ORDER_TOL    4px         — reading-order y separation before x decides
 *   FRACTION_TOL 0.08        — relative-width, ABSOLUTE fraction slack
 *   RATIO_TOL    0.15        — width-ratio, RELATIVE slack (15%)
 * ───────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const { validateEvidence } = require_('./layout-probe.js');

export const TOLERANCES = {
  CONTAIN_TOL: 2,
  ALIGN_TOL: 4,
  ROW_TOL: 12,
  COL_TOL: 16,
  ORDER_TOL: 4,
  FRACTION_TOL: 0.08,
  RATIO_TOL: 0.15,
};
const T = TOLERANCES;

export const OUTCOMES = ['pass', 'mismatch', 'unverifiable', 'malformed-evidence'];
const ALIGNMENTS = ['start', 'center', 'end', 'space-between'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const hasRect = (c) => !!c && !!c.rect && ['x', 'y', 'w', 'h'].every((k) => isNum(c.rect[k]));
const edges = (c) => ({ l: c.rect.x, t: c.rect.y, r: c.rect.x + c.rect.w, b: c.rect.y + c.rect.h });
const lc = (v) => String(v ?? '').toLowerCase();

/* ── resolution ──────────────────────────────────────────────────────────── */
/**
 * Resolve an assertion operand to exactly one component. THE one rule (see header).
 * @param {object[]} components canonical evidence components
 * @param {string} nameish the assertion's subject/target string
 * @returns {{ component: object|null, reason: string|null }}
 */
export function resolveComponent(components, nameish) {
  const want = String(nameish ?? '');
  if (!want) return { component: null, reason: 'empty subject/target string' };
  const steps = [
    ['name (exact)', (c) => String(c.name ?? '') === want],
    ['name (case-insensitive)', (c) => lc(c.name) === lc(want)],
    ['propertyName', (c) => lc(c.propertyName) === lc(want)],
    ['type', (c) => lc(c.type) === lc(want)],
  ];
  for (const [how, match] of steps) {
    const hits = components.filter(match);
    if (hits.length === 1) return { component: hits[0], reason: null };
    if (hits.length > 1) {
      return { component: null, reason: `"${want}" is AMBIGUOUS — ${hits.length} components match by ${how} (${hits.map((h) => h.id).join(', ')})` };
    }
  }
  return { component: null, reason: `"${want}" is ABSENT from the evidence — no component matches by name, propertyName or type` };
}

/* ── per-kind evaluation ─────────────────────────────────────────────────── */
const P = (expected, measured, message) => ({ outcome: 'pass', expected, measured, message: message ?? null });
const M = (expected, measured, message) => ({ outcome: 'mismatch', expected, measured, message });
const U = (message) => ({ outcome: 'unverifiable', expected: null, measured: null, message });

function childrenOf(components, id) {
  return components.filter((c) => c.parentId === id && hasRect(c))
    .sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
}

function rowBandOf(evidence, comp) {
  const bands = Array.isArray(evidence.rowBands) ? evidence.rowBands : [];
  for (let i = 0; i < bands.length; i++) {
    const ids = bands[i] && Array.isArray(bands[i].componentIds) ? bands[i].componentIds : [];
    if (ids.includes(comp.id)) return i;
  }
  return null;
}

function evalAssertion(a, evidence) {
  const components = evidence.components;
  const kind = String(a.kind ?? '');

  const needSubject = () => {
    const r = resolveComponent(components, a.subject);
    return r.component ? { s: r.component } : { err: U(r.reason) };
  };
  const needTargetComponent = () => {
    const r = resolveComponent(components, a.target);
    return r.component ? { t: r.component } : { err: U(r.reason) };
  };

  const sr = needSubject();
  if (sr.err) return sr.err;
  const s = sr.s;
  if (!hasRect(s) && kind !== 'exists') {
    return U(`subject "${a.subject}" has no measurable rect — it was found but not measured`);
  }

  switch (kind) {
    case 'exists':
      return P(`"${a.subject}" exists`, `found as ${s.id} (${s.type})`);

    case 'visible': {
      const vp = evidence.viewport || {};
      const e = edges(s);
      const onScreen = s.rect.w > 0 && s.rect.h > 0 &&
        (!isNum(vp.w) || (e.l < vp.w && e.r > 0)) &&
        (!isNum(vp.h) || e.t < Math.max(vp.h, e.b)); // vertical scroll is not invisibility
      return onScreen
        ? P('visible (w>0, h>0, within the viewport)', `rect ${s.rect.w}x${s.rect.h} at (${s.rect.x},${s.rect.y})`)
        : M('visible (w>0, h>0, within the viewport)', `rect ${s.rect.w}x${s.rect.h} at (${s.rect.x},${s.rect.y})`,
          `"${a.subject}" is measured but not visibly rendered`);
    }

    case 'parent': {
      const tr = needTargetComponent();
      if (tr.err) return tr.err;
      const parent = components.find((c) => c.id === s.parentId) || null;
      return s.parentId === tr.t.id
        ? P(`parent of "${a.subject}" is "${a.target}"`, `parentId ${s.parentId}`)
        : M(`parent of "${a.subject}" is "${a.target}" (${tr.t.id})`,
          `parent is ${parent ? `"${parent.name}" (${parent.id})` : `${s.parentId ?? 'none'}`}`,
          `"${a.subject}" hangs off the wrong container`);
    }

    case 'contains': {
      const tr = needTargetComponent();
      if (tr.err) return tr.err;
      const t = tr.t;
      if (!hasRect(t)) return U(`target "${a.target}" has no measurable rect`);
      const S = edges(s); const Tg = edges(t);
      const inside = Tg.l >= S.l - T.CONTAIN_TOL && Tg.r <= S.r + T.CONTAIN_TOL &&
        Tg.t >= S.t - T.CONTAIN_TOL && Tg.b <= S.b + T.CONTAIN_TOL;
      const measured = `"${a.target}" at (${t.rect.x},${t.rect.y},${t.rect.w}x${t.rect.h}) vs "${a.subject}" at (${s.rect.x},${s.rect.y},${s.rect.w}x${s.rect.h})`;
      return inside
        ? P(`"${a.subject}" contains "${a.target}" (±${T.CONTAIN_TOL}px)`, measured)
        : M(`"${a.subject}" contains "${a.target}" (±${T.CONTAIN_TOL}px)`, measured,
          `"${a.target}" is rendered OUTSIDE "${a.subject}"`);
    }

    case 'child-count': {
      if (!isNum(a.count)) return U('kind=child-count without a numeric `count`');
      const kids = childrenOf(components, s.id);
      return kids.length === a.count
        ? P(`"${a.subject}" has ${a.count} children`, `${kids.length} children`)
        : M(`"${a.subject}" has ${a.count} children`, `${kids.length} children (${kids.map((k) => k.name).join(', ') || 'unnamed'})`,
          `child count of "${a.subject}" is ${kids.length}, expected ${a.count}`);
    }

    case 'order': {
      const tr = needTargetComponent();
      if (tr.err) return tr.err;
      const t = tr.t;
      if (!hasRect(t)) return U(`target "${a.target}" has no measurable rect`);
      // Reading order: y decides unless the two are on the same line, then x does.
      const sameLine = Math.abs(s.rect.y - t.rect.y) <= T.ORDER_TOL;
      const before = sameLine ? s.rect.x < t.rect.x : s.rect.y < t.rect.y;
      const docBefore = components.indexOf(s) < components.indexOf(t);
      const measured = `"${a.subject}" at y=${s.rect.y},x=${s.rect.x}; "${a.target}" at y=${t.rect.y},x=${t.rect.x} (document order: ${docBefore ? 'subject first' : 'target first'})`;
      return before
        ? P(`"${a.subject}" precedes "${a.target}"`, measured)
        : M(`"${a.subject}" precedes "${a.target}"`, measured, `"${a.subject}" renders AFTER "${a.target}"`);
    }

    case 'same-row': {
      const tr = needTargetComponent();
      if (tr.err) return tr.err;
      const t = tr.t;
      if (!hasRect(t)) return U(`target "${a.target}" has no measurable rect`);
      const bs = rowBandOf(evidence, s); const bt = rowBandOf(evidence, t);
      const sameBand = bs != null && bs === bt;
      const centreDelta = Math.abs((s.rect.y + s.rect.h / 2) - (t.rect.y + t.rect.h / 2));
      const ok = sameBand || centreDelta <= T.ROW_TOL;
      const measured = `rowBand ${bs ?? 'n/a'} vs ${bt ?? 'n/a'}; vertical-centre delta ${Math.round(centreDelta)}px`;
      return ok
        ? P(`"${a.subject}" and "${a.target}" share a row (±${T.ROW_TOL}px)`, measured)
        : M(`"${a.subject}" and "${a.target}" share a row (±${T.ROW_TOL}px)`, measured,
          `"${a.subject}" and "${a.target}" are on different rows — the row stacked`);
    }

    case 'same-column': {
      const tr = needTargetComponent();
      if (tr.err) return tr.err;
      const t = tr.t;
      if (!hasRect(t)) return U(`target "${a.target}" has no measurable rect`);
      const sameIdx = s.parentId === t.parentId && isNum(s.columnIndex) && s.columnIndex === t.columnIndex;
      const leftDelta = Math.abs(s.rect.x - t.rect.x);
      const ok = sameIdx || leftDelta <= T.COL_TOL;
      const measured = `columnIndex ${s.columnIndex} (parent ${s.parentId}) vs ${t.columnIndex} (parent ${t.parentId}); left-edge delta ${leftDelta}px`;
      return ok
        ? P(`"${a.subject}" and "${a.target}" share a column (±${T.COL_TOL}px)`, measured)
        : M(`"${a.subject}" and "${a.target}" share a column (±${T.COL_TOL}px)`, measured,
          `"${a.subject}" and "${a.target}" are in different x-clusters`);
    }

    case 'tab-membership': {
      const anyTabs = components.some((c) => c.tabMembership != null) || evidence.tabMembership != null;
      if (!anyTabs) return U('no tab membership was measured anywhere in the evidence — tabs either do not exist or the probe could not see them');
      return lc(s.tabMembership) === lc(a.target)
        ? P(`"${a.subject}" sits in tab "${a.target}"`, `tabMembership "${s.tabMembership}"`)
        : M(`"${a.subject}" sits in tab "${a.target}"`, `tabMembership ${s.tabMembership == null ? 'null (not inside any tab)' : `"${s.tabMembership}"`}`,
          `"${a.subject}" is not in tab "${a.target}"`);
    }

    case 'relative-width': {
      if (!isNum(a.ratio)) return U('kind=relative-width without a numeric `ratio`');
      const parent = components.find((c) => c.id === s.parentId && hasRect(c));
      const basis = parent ? parent.rect.w : (isNum(evidence.viewport?.w) ? evidence.viewport.w : null);
      if (!isNum(basis) || basis <= 0) return U(`no measurable width basis for "${a.subject}" (no parent rect, no viewport width)`);
      const frac = s.rect.w / basis;
      const ok = Math.abs(frac - a.ratio) <= T.FRACTION_TOL;
      const measured = `${s.rect.w}px of ${basis}px = ${frac.toFixed(3)}`;
      return ok
        ? P(`"${a.subject}" is ${a.ratio} of ${parent ? `"${parent.name}"` : 'the viewport'} (±${T.FRACTION_TOL})`, measured)
        : M(`"${a.subject}" is ${a.ratio} of ${parent ? `"${parent.name}"` : 'the viewport'} (±${T.FRACTION_TOL})`, measured,
          `"${a.subject}" occupies ${frac.toFixed(3)} of its basis, expected ${a.ratio}`);
    }

    case 'width-ratio': {
      if (!isNum(a.ratio)) return U('kind=width-ratio without a numeric `ratio`');
      const tr = needTargetComponent();
      if (tr.err) return tr.err;
      const t = tr.t;
      if (!hasRect(t) || t.rect.w <= 0) return U(`target "${a.target}" has no measurable width`);
      const got = s.rect.w / t.rect.w;
      const ok = Math.abs(got - a.ratio) <= a.ratio * T.RATIO_TOL;
      const measured = `${s.rect.w}px : ${t.rect.w}px = ${got.toFixed(3)}`;
      return ok
        ? P(`"${a.subject}":"${a.target}" width ratio ${a.ratio} (±${Math.round(T.RATIO_TOL * 100)}%)`, measured)
        : M(`"${a.subject}":"${a.target}" width ratio ${a.ratio} (±${Math.round(T.RATIO_TOL * 100)}%)`, measured,
          `width ratio is ${got.toFixed(3)}, expected ${a.ratio}`);
    }

    case 'alignment': {
      const want = lc(a.target);
      if (!ALIGNMENTS.includes(want)) return U(`alignment target "${a.target}" is not one of ${ALIGNMENTS.join('|')}`);
      const kids = childrenOf(components, s.id);
      if (kids.length < 2) return U(`"${a.subject}" has ${kids.length} measurable child(ren) — alignment needs at least 2`);
      const S = edges(s);
      const ke = kids.map(edges);
      let ok = false; let measured = '';
      if (want === 'start') {
        const lefts = ke.map((e) => e.l);
        ok = Math.max(...lefts) - Math.min(...lefts) <= T.ALIGN_TOL;
        measured = `left edges ${lefts.join(', ')}`;
      } else if (want === 'end') {
        const rights = ke.map((e) => e.r);
        ok = Math.max(...rights) - Math.min(...rights) <= T.ALIGN_TOL;
        measured = `right edges ${rights.join(', ')}`;
      } else if (want === 'center') {
        const parentC = (S.l + S.r) / 2;
        const deltas = ke.map((e) => Math.abs((e.l + e.r) / 2 - parentC));
        ok = Math.max(...deltas) <= T.ALIGN_TOL * 2;
        measured = `child centres off parent centre by ${deltas.map((d) => Math.round(d)).join(', ')}px`;
      } else { // space-between
        const first = ke[0]; const last = ke[ke.length - 1];
        ok = Math.abs(first.l - S.l) <= T.ALIGN_TOL * 2 && Math.abs(last.r - S.r) <= T.ALIGN_TOL * 2;
        measured = `first-left gap ${Math.round(first.l - S.l)}px, last-right gap ${Math.round(S.r - last.r)}px`;
      }
      return ok
        ? P(`children of "${a.subject}" align "${want}" (±${T.ALIGN_TOL}px)`, measured)
        : M(`children of "${a.subject}" align "${want}" (±${T.ALIGN_TOL}px)`, measured,
          `children of "${a.subject}" do not align "${want}"`);
    }

    default:
      return U(`kind "${kind}" is not in the assertion vocabulary — nothing was measured`);
  }
}

/* ── the run ─────────────────────────────────────────────────────────────── */
/** Evidence problems that make the WHOLE run unmeasurable. */
function fatalEvidenceProblems(evidence) {
  const problems = validateEvidence(evidence);
  return problems.filter((p) =>
    /^evidence is not an object$/.test(p) ||
    /^missing required field: /.test(p) ||
    /^components is not an array$/.test(p) ||
    /^no component carries a measurable rect/.test(p));
}

/**
 * Evaluate every assertion in `spec` against `evidence`. Pure and deterministic:
 * same inputs, same output, no interpretation of any `description` field.
 * @param {object} spec a validated blueprint (only `assertions` is read)
 * @param {object} evidence a canonical render evidence document
 * @returns {{ verdict: string, results: object[], counts: object, evidenceProblems?: string[] }}
 */
export function evaluateAssertions(spec, evidence) {
  const assertions = Array.isArray(spec?.assertions) ? spec.assertions : [];
  const fatal = fatalEvidenceProblems(evidence);

  if (fatal.length) {
    // The probe measured nothing. That is an infrastructure failure of the
    // instrument, NOT a placement mismatch — reporting it as one sends the fix
    // to the form instead of to the probe.
    return {
      verdict: 'malformed-evidence',
      evidenceProblems: fatal,
      results: assertions.map((a) => ({
        id: a?.id ?? null,
        kind: a?.kind ?? null,
        subject: a?.subject ?? null,
        target: a?.target ?? null,
        required: a?.required !== false,
        outcome: 'malformed-evidence',
        expected: null,
        measured: null,
        message: `evidence cannot be measured: ${fatal.join('; ')}`,
      })),
      counts: { pass: 0, mismatch: 0, unverifiable: 0, 'malformed-evidence': assertions.length },
    };
  }

  const results = assertions.map((a) => {
    const required = a?.required !== false;
    let r;
    try { r = evalAssertion(a ?? {}, evidence); }
    catch (err) { r = U(`assertion could not be evaluated: ${String(err && err.message).slice(0, 200)}`); }
    return {
      id: a?.id ?? null,
      kind: a?.kind ?? null,
      subject: a?.subject ?? null,
      target: a?.target ?? null,
      required,
      outcome: r.outcome,
      expected: r.expected,
      measured: r.measured,
      message: r.message,
    };
  });

  const counts = { pass: 0, mismatch: 0, unverifiable: 0, 'malformed-evidence': 0 };
  for (const r of results) counts[r.outcome]++;
  // Fail-closed: an unverifiable REQUIRED assertion fails the gate just as a
  // mismatch does — "the card is missing" is not a pass.
  const failedRequired = results.filter((r) => r.required && r.outcome !== 'pass');
  return { verdict: failedRequired.length ? 'fail' : 'pass', results, counts };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const USAGE = 'usage: node verify-placement.mjs --spec <blueprint.json> --evidence <evidence.json> [--out <verdict.json>]';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function readJson(file, label) {
  const raw = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`${label} is not valid JSON (${file}): ${e.message}`); }
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || typeof args.spec !== 'string' || typeof args.evidence !== 'string') {
    process.stdout.write(JSON.stringify({ verdict: 'usage', error: USAGE }, null, 2) + '\n');
    return 2;
  }
  let spec; let evidence;
  try {
    spec = readJson(args.spec, 'spec');
    evidence = readJson(args.evidence, 'evidence');
  } catch (e) {
    process.stdout.write(JSON.stringify({ verdict: 'usage', error: String(e.message) }, null, 2) + '\n');
    return 2;
  }

  const report = {
    spec: args.spec,
    evidence: args.evidence,
    form: evidence?.form ?? null,
    screenshotPath: evidence?.screenshotPath ?? null,
    tolerances: TOLERANCES,
    ...evaluateAssertions(spec, evidence),
  };
  const text = JSON.stringify(report, null, 2);
  process.stdout.write(text + '\n');
  if (typeof args.out === 'string') fs.writeFileSync(args.out, text + '\n');

  if (report.verdict === 'malformed-evidence') return 3;
  return report.verdict === 'pass' ? 0 : 1;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
