/**
 * Tests for the eval harness itself.
 *
 * An eval harness that cannot fail is decoration. The old stack ran three phases with zero
 * evals/ directories, so several rules that sat in SKILL.md as authoritative turned out to be
 * false — one firing on 95.6% of real forms, another with a 99.3% false-positive rate. The point
 * of this file is that the thing meant to catch that is itself falsifiable.
 *
 * So the load-bearing test here is `a negative case FAILS when the rule does not fire`. Without
 * it, a harness whose grading was broken would report nine green cases and mean nothing.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import {
  NEGATIVE_CASES,
  NOT_COVERED,
  evalDeterminism,
  evalNegative,
  evalPositive,
  evalThemeInvariance,
  loadMarkup,
  summarise,
} from '../scripts/lib/evals.mjs';

const SKILL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GOLDEN = join(SKILL_ROOT, 'tests', 'golden', 'table-worklist.shesha.json');
const WCG = join(SKILL_ROOT, 'tests', 'golden', 'table-worklist.wcg.json');

const CANDIDATES = [
  join('C:', 'Users', 'Hashim', 'Downloads', 'boxfusion.test', '.shesha', 'ground-truth.json'),
];

let ctx = null;
let markup = null;

before(() => {
  markup = loadMarkup(GOLDEN);
  for (const p of CANDIDATES) {
    if (existsSync(p)) {
      ctx = { registry: JSON.parse(readFileSync(p, 'utf8')).registry, formName: 'eval-test' };
      break;
    }
  }
});

describe('eval harness', () => {
  it('grades the golden as clean', (t) => {
    if (!ctx) return t.skip('no ground-truth.json');
    const r = evalPositive({ id: 'golden', markup, ctx });
    assert.equal(r.pass, true, `golden is not clean: ${JSON.stringify(r.failures, null, 2)}`);
  });

  it('every negative case provokes the rule it names', (t) => {
    if (!ctx) return t.skip('no ground-truth.json');
    const bad = [];
    for (const testCase of NEGATIVE_CASES) {
      const r = evalNegative({ testCase, markup, ctx });
      if (r.skipped) {
        bad.push(`${testCase.id}: SKIPPED — ${r.reason}`);
      } else if (!r.pass) {
        bad.push(`${testCase.id}: ${r.detail}`);
      }
    }
    assert.deepEqual(bad, [], bad.join('\n'));
  });

  /**
   * The one that keeps the rest honest. A mutation that does nothing must be graded as a FAILURE,
   * because "the rule did not fire" is exactly the state a real regression would produce.
   */
  it('FAILS a negative case whose mutation does not actually break anything', (t) => {
    if (!ctx) return t.skip('no ground-truth.json');
    const inert = {
      id: 'inert-mutation',
      expect: 'R-003',
      why: 'a deliberately harmless edit, to prove grading is not rubber-stamping',
      mutate(m) {
        m.components[0].componentName = String(m.components[0].componentName || '') + '';
        return 'touched nothing that matters';
      },
    };
    const r = evalNegative({ testCase: inert, markup, ctx });
    assert.equal(r.pass, false, 'the harness passed a case whose rule never fired');
    assert.match(r.detail, /did NOT fire/);
  });

  it('reports an inapplicable mutation as a skip, never as a pass', (t) => {
    if (!ctx) return t.skip('no ground-truth.json');
    const unreachable = {
      id: 'unreachable',
      expect: 'R-003',
      why: 'nothing in the fixture matches',
      mutate: () => null,
    };
    const r = evalNegative({ testCase: unreachable, markup, ctx });
    assert.equal(r.skipped, true);
    assert.notEqual(r.pass, true, '"could not break it" must never read as a pass');
  });

  it('detects a structural theme leak, and a theme that changes nothing', () => {
    const a = { components: [{ type: 'text' }, { type: 'card' }] };
    const b = { components: [{ type: 'text' }, { type: 'card' }] };
    // Identical bytes: the theme is not reaching the output, so this must NOT pass.
    assert.equal(evalThemeInvariance({ id: 'x', byTheme: { a, b } }).pass, false);

    // Different structure: a leak.
    const leak = { components: [{ type: 'text' }] };
    assert.equal(evalThemeInvariance({ id: 'x', byTheme: { a, leak } }).pass, false);

    // Same structure, different resolved value: the boundary holds.
    const themed = { components: [{ type: 'text', colour: '#111' }, { type: 'card' }] };
    assert.equal(evalThemeInvariance({ id: 'x', byTheme: { a, themed } }).pass, true);
  });

  it('reports determinism honestly, and catches non-determinism', () => {
    let n = 0;
    assert.equal(evalDeterminism({ id: 'stable', compileOnce: () => ({ v: 1 }), runs: 3 }).pass, true);
    const drifting = evalDeterminism({ id: 'drifting', compileOnce: () => ({ v: (n += 1) }), runs: 3 });
    assert.equal(drifting.pass, false);
    assert.equal(drifting.distinctOutputs, 3);
  });

  it('says what it does not cover, including that it measures the compiler and not the model', () => {
    assert.ok(NOT_COVERED.length >= 4);
    const joined = NOT_COVERED.join(' ');
    assert.match(joined, /model variance/, 'the harness must state that it does not measure model variance');
    assert.match(joined, /rendered gate/);
  });

  it('summarises without counting a skip as a pass', () => {
    const s = summarise([{ pass: true }, { pass: false }, { pass: null, skipped: true }]);
    assert.deepEqual(s, { total: 3, passed: 1, failed: 1, skipped: 1, ok: false });
  });

  it('has a golden for each committed theme', () => {
    assert.ok(existsSync(GOLDEN), 'shesha golden missing');
    assert.ok(existsSync(WCG), 'wcg golden missing');
  });

  /**
   * Every archetype gets the same treatment, so a second archetype cannot ship with weaker
   * evidence than the first. record-detail was added in Phase 10.
   */
  describe('record-detail archetype', () => {
    const RD = join(SKILL_ROOT, 'tests', 'golden', 'record-detail.shesha.json');
    const RD_WCG = join(SKILL_ROOT, 'tests', 'golden', 'record-detail.wcg.json');

    it('has a golden per theme, and the themes actually differ', () => {
      assert.ok(existsSync(RD), 'record-detail shesha golden missing');
      assert.ok(existsSync(RD_WCG), 'record-detail wcg golden missing');
      assert.notEqual(
        readFileSync(RD, 'utf8'),
        readFileSync(RD_WCG, 'utf8'),
        'the two themes produced identical bytes — the theme is not reaching the output'
      );
    });

    it('grades clean and holds the token boundary', (t) => {
      if (!ctx) return t.skip('no ground-truth.json');
      const rd = loadMarkup(RD);
      const r = evalPositive({ id: 'record-detail', markup: rd, ctx });
      assert.equal(r.pass, true, `record-detail golden is not clean: ${JSON.stringify(r.failures, null, 2)}`);

      const inv = evalThemeInvariance({
        id: 'record-detail-theme',
        byTheme: { shesha: rd, wcg: loadMarkup(RD_WCG) },
      });
      assert.equal(inv.pass, true, inv.detail);
    });

    it('every negative case provokes its rule here too', (t) => {
      if (!ctx) return t.skip('no ground-truth.json');
      const rd = loadMarkup(RD);
      const bad = [];
      for (const testCase of NEGATIVE_CASES) {
        const r = evalNegative({ testCase, markup: rd, ctx });
        // A worklist-shaped mutation (the table binding) has nothing to target here, and a skip
        // with a reason is the honest outcome rather than a pass.
        if (r.skipped) continue;
        if (!r.pass) bad.push(`${testCase.id}: ${r.detail}`);
      }
      assert.deepEqual(bad, [], bad.join('\n'));
    });

    it('carries the typed controls its fields require, not textField for everything', (t) => {
      if (!ctx) return t.skip('no ground-truth.json');
      const types = new Set();
      const walk = (a) => {
        for (const n of a || []) {
          types.add(n.type);
          if (n.components) walk(n.components);
          for (const s of ['content', 'header']) if (n[s] && n[s].components) walk(n[s].components);
          for (const tb of n.tabs || []) if (tb.components) walk(tb.components);
        }
      };
      walk(loadMarkup(RD).components);
      // dateField and numberField are the point: Field declares textField, and the framework's
      // own dataTypeSupported REFUSES textField for date-time — exit 7, measured. A record-detail
      // form that compiled with textField everywhere would mean that refusal had been bypassed.
      for (const required of ['dateField', 'numberField', 'dropdown', 'tabs', 'card']) {
        assert.ok(types.has(required), `record-detail golden has no ${required}`);
      }
    });

    it('emits the header identifier as a real text node', (t) => {
      if (!ctx) return t.skip('no ground-truth.json');
      // It rendered in the MOCK and nowhere else until the compiler was fixed: the prop reached
      // the anatomy and the generator, and the compiler emitted no Shesha node. Neither the three
      // rendered gates nor the fidelity geometry diff caught it.
      const raw = readFileSync(RD, 'utf8');
      assert.match(raw, /recordIdentifier/, 'the PageHeader identifier is not emitted as a component');
      assert.match(raw, /AST-000481/, 'the identifier content is missing from the compiled form');
    });
  });
});
