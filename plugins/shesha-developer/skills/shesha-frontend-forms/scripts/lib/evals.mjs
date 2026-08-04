/**
 * The eval harness.
 *
 * DESIGN MINED from the previous stack's evals/ (branch claude/shesha-designer-fs-watcher-0550e8),
 * which got the epistemics right even though its code targeted a pipeline that no longer exists.
 * Two of its rules are carried over verbatim in spirit:
 *
 *  1. AN EVAL'S ASSERTION IS THE TOOLCHAIN'S OWN VERDICT, NEVER A MODEL'S OPINION. A case is
 *     graded by the same runGates() the `check` CLI calls. Mechanical and reproducible by
 *     construction; there is no judge, no rubric and no scoring of prose.
 *
 *  2. THIS MEASURES TOOLING VARIANCE, NOT MODEL VARIANCE. compileSpec() is a pure function of
 *     its spec, so compiling the same spec N times is byte-identical and the reported spread is
 *     0. That is correct and expected — and it is NOT evidence that an agent is consistent. Read
 *     a zero spread as "the compiler is deterministic", never as "the model is reliable".
 *     Measuring model variance would mean driving a real agent per run and grading N
 *     independently-authored specs. This harness deliberately does not do that.
 *
 * What is NEW here is the negative half. The old harness graded "does a good blueprint come out
 * clean". That cannot fail in the interesting direction: a gate chain that returns zero findings
 * on everything also passes every positive case. So each negative case names the EXACT rule id it
 * must provoke, and fails if the chain stays silent OR fires something else. It is the only part
 * of this build that tests the gates rather than trusting them.
 *
 * Negative cases are MUTATIONS of valid markup, not fixture files on disk — a broken fixture
 * rots silently as the compiler improves, whereas a mutation is re-derived from a currently-valid
 * form every run.
 */
import { readFileSync } from 'node:fs';
import { runGates } from './gates.mjs';

/**
 * Walk every component so mutations can target one by predicate. Deliberately a local walk: a
 * mutation must be able to reach into slots and item arrays that the rule walker also reaches.
 */
function eachComponent(components, fn) {
  for (const node of components || []) {
    fn(node);
    if (Array.isArray(node.components)) eachComponent(node.components, fn);
    for (const slot of ['content', 'header', 'customHeader', 'footer']) {
      if (node[slot] && Array.isArray(node[slot].components)) eachComponent(node[slot].components, fn);
    }
    for (const key of ['columns', 'tabs', 'panels', 'steps']) {
      for (const c of node[key] || []) {
        if (c && Array.isArray(c.components)) eachComponent(c.components, fn);
      }
    }
  }
}

/** First component matching a predicate, or null. */
function findComponent(markup, predicate) {
  let hit = null;
  eachComponent(markup.components, (n) => {
    if (!hit && predicate(n)) hit = n;
  });
  return hit;
}

/**
 * The negative cases.
 *
 * Each names one rule and one mutation that must provoke it. `expect` is a rule id because
 * "something failed" is not a useful assertion — a chain that fails everything would satisfy it.
 * `skipIf` lets a case stand down honestly when its precondition is absent from the fixture,
 * rather than being quietly counted as a pass.
 */
export const NEGATIVE_CASES = [
  {
    id: 'stale-version',
    expect: 'R-003',
    why: 'a stale version silently drops the entire desktop style block',
    mutate(markup) {
      const n = findComponent(markup, (c) => typeof c.version === 'number' && c.version > 0);
      if (!n) return null;
      n.version = 0;
      return `set ${n.type}.version = 0`;
    },
  },
  {
    id: 'pascal-case-binding',
    expect: 'R-004',
    why: 'Shesha camelCases the query but the cell accessor reads the literal propertyName, so every cell renders blank while the pager count stays right',
    /**
     * Targets a DATATABLE COLUMN, not any propertyName-bearing component.
     *
     * The first version of this mutation PascalCased whatever carried a propertyName and the case
     * failed — the golden's only two such components are `dataContext` and `datatable`, whose
     * propertyName is an identifier rather than an entity property, and whose dataTypeSupported
     * is null. R-004 is deliberately narrowed to exclude exactly those, because flagging them was
     * a false positive on correct shipped markup. The rule was right and the mutation was wrong:
     * real bindings live in datatable.items, which the component walk does not reach.
     */
    mutate(markup) {
      const table = findComponent(markup, (c) => c.type === 'datatable' && Array.isArray(c.items));
      if (!table) return null;
      const col = table.items.find((c) => typeof c.propertyName === 'string' && /^[a-z]/.test(c.propertyName));
      if (!col) return null;
      col.propertyName = col.propertyName[0].toUpperCase() + col.propertyName.slice(1);
      return `PascalCased the datatable column "${col.propertyName}"`;
    },
  },
  {
    id: 'duplicate-id',
    expect: 'R-002',
    why: 'the flat structure is keyed by id, so a duplicate silently overwrites',
    mutate(markup) {
      const ids = [];
      eachComponent(markup.components, (c) => c.id && ids.push(c));
      if (ids.length < 2) return null;
      ids[1].id = ids[0].id;
      return 'pointed two components at one id';
    },
  },
  {
    id: 'illegal-enum-value',
    expect: 'R-058',
    why: 'the renderer substitutes a default rather than erroring, so the authored value vanishes silently',
    mutate(markup) {
      const n = findComponent(markup, (c) => c.type === 'text' && typeof c.textType === 'string');
      if (!n) return null;
      n.textType = 'heading';
      return 'set text.textType = "heading", which is not a legal value';
    },
  },
  {
    id: 'inert-font-channel',
    expect: 'R-059',
    why: 'this is the Phase 6 font-channel defect: the form passes every other offline gate and renders unstyled text',
    mutate(markup) {
      const n = findComponent(markup, (c) => c.type === 'text' && c.content && c.textType);
      if (!n) return null;
      delete n.textType;
      delete n.contentDisplay;
      return 'removed textType and contentDisplay from a text that carries content';
    },
  },
  {
    id: 'unknown-component-type',
    expect: 'R-003',
    why: 'an unregistered type fails SOFT — upgradeComponents skips it and the renderer shows a placeholder with no error',
    mutate(markup) {
      const n = findComponent(markup, (c) => c.type === 'text');
      if (!n) return null;
      n.type = 'txet';
      return 'typo\'d a component type';
    },
  },
];

/** Deep clone without structuredClone, so this stays usable on any Node the toolchain supports. */
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/**
 * runGates returns a flat `failures` array of violations already filtered to severity fail, each
 * carrying its own `gate` and (for rules) `ruleId`. Warnings are deliberately excluded: a case
 * asserting on warnings would fail the moment a rule is correctly demoted.
 */
function failuresOf(report) {
  return (report.failures || []).map((f) => ({
    gate: f.gate || null,
    ruleId: f.ruleId || null,
    message: f.message,
  }));
}

/**
 * Grade one positive case: a valid markup document must produce zero failures.
 */
export function evalPositive({ id, markup, ctx }) {
  const report = runGates(clone(markup), ctx, null);
  const failures = failuresOf(report);
  return {
    id,
    kind: 'positive',
    pass: failures.length === 0,
    failures,
    detail: failures.length === 0 ? 'zero failures' : `${failures.length} failure(s)`,
  };
}

/**
 * Grade one negative case: the named rule must fire, and the mutation must actually have been
 * applicable. An inapplicable mutation is reported as a SKIP with its reason — never as a pass,
 * because "we could not break it" is not evidence that breaking it would be caught.
 */
export function evalNegative({ testCase, markup, ctx }) {
  const copy = clone(markup);
  const applied = testCase.mutate(copy);
  if (!applied) {
    return {
      id: testCase.id,
      kind: 'negative',
      pass: null,
      skipped: true,
      reason: `the fixture has no component this mutation can target (needs one for ${testCase.expect})`,
    };
  }

  const failures = failuresOf(runGates(copy, ctx, null));
  const hit = failures.filter((f) => f.ruleId === testCase.expect);
  const others = failures.filter((f) => f.ruleId !== testCase.expect);

  return {
    id: testCase.id,
    kind: 'negative',
    pass: hit.length > 0,
    expect: testCase.expect,
    applied,
    why: testCase.why,
    // Collateral findings are reported, not failed on: one mutation can legitimately trip more
    // than one rule, and suppressing that would hide real information.
    collateral: others.map((f) => f.ruleId || f.gate),
    detail:
      hit.length > 0
        ? `${testCase.expect} fired`
        : `${testCase.expect} did NOT fire${others.length ? ` (got ${others.map((f) => f.ruleId || f.gate).join(', ')})` : ' — the chain stayed silent'}`,
  };
}

/**
 * Compile determinism. Byte-identical output over N runs proves the id seeding is stable, which
 * is what keeps re-compiles diffable. It says nothing about model consistency.
 */
export function evalDeterminism({ id, compileOnce, runs = 3 }) {
  const outputs = [];
  for (let i = 0; i < runs; i += 1) outputs.push(JSON.stringify(compileOnce()));
  const identical = outputs.every((o) => o === outputs[0]);
  return {
    id,
    kind: 'determinism',
    pass: identical,
    runs,
    distinctOutputs: new Set(outputs).size,
    detail: identical
      ? `${runs} compiles byte-identical (spread 0 — the COMPILER is deterministic, not the model)`
      : `${new Set(outputs).size} distinct outputs across ${runs} compiles`,
  };
}

/**
 * Theme invariance: switching theme may change resolved values and nothing structural. Compared
 * on a structural skeleton with all leaf values stripped, so a colour change cannot mask a
 * component change and vice versa.
 */
export function evalThemeInvariance({ id, byTheme }) {
  const skeleton = (markup) => {
    const strip = (nodes) =>
      (nodes || []).map((n) => ({
        type: n.type,
        children: strip(n.components),
        content: n.content && typeof n.content === 'object' ? strip(n.content.components) : undefined,
        header: n.header && typeof n.header === 'object' ? strip(n.header.components) : undefined,
      }));
    return JSON.stringify(strip(markup.components));
  };

  const themes = Object.keys(byTheme);
  const shapes = themes.map((t) => skeleton(byTheme[t]));
  const same = shapes.every((s) => s === shapes[0]);
  // Values must actually DIFFER, or the token boundary is not wired and the test would pass
  // vacuously on a theme that changes nothing.
  const raws = themes.map((t) => JSON.stringify(byTheme[t]));
  const differ = new Set(raws).size === themes.length;

  return {
    id,
    kind: 'theme-invariance',
    pass: same && differ,
    themes,
    detail: !same
      ? 'themes produced DIFFERENT structure — the token boundary leaks'
      : !differ
        ? 'themes produced identical bytes — the theme is not reaching the output at all'
        : `${themes.length} themes: structure identical, values differ`,
  };
}

/** Load a golden markup document, tolerating the shapes push/check accept. */
export function loadMarkup(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return j.markup && typeof j.markup === 'object' ? j.markup : j;
}

/**
 * What this harness does NOT cover, stated in its own output. A pass here is not a claim that the
 * form looks right — the rendered gates need a live app and a real browser, and the design
 * verdict needs the critic.
 */
export const NOT_COVERED = [
  'styled-ness and brand fidelity (rendered gate — needs a live app)',
  'layout anatomy (rendered gate — needs a live app)',
  'mock-vs-real geometry and pixel drift (fidelity — needs a live app)',
  'whether the design is any good (the critic subagent judges that, from evidence)',
  'model variance — every case here compiles a FIXED spec, so the spread measures the compiler',
];

export function summarise(results) {
  const passed = results.filter((r) => r.pass === true).length;
  const failed = results.filter((r) => r.pass === false).length;
  const skipped = results.filter((r) => r.skipped).length;
  return { total: results.length, passed, failed, skipped, ok: failed === 0 };
}
