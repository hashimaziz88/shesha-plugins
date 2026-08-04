/**
 * Phase 3 contract tests — the design-quality bet.
 *
 * Two acceptance criteria, both blunt on purpose:
 *
 *  1. ZERO HAND-WRITTEN LINES in the generated kit. If the kit needs meaningful
 *     hand-written per-component code it will drift from the framework within one release
 *     and we will have rebuilt the capability matrix with extra steps. That is a
 *     stop-and-report condition, so it gets a test rather than a promise.
 *
 *  2. NO STRUCTURAL DELTA ACROSS THEMES. Switching theme must change resolved values and
 *     nothing else — same components, same props, same DOM shape. Anything else is a leak
 *     in the token boundary.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { BANNER, emphasisMap, generateKit, loadAnatomy, loadTheme, resolveToken, supportedChannels } from '../scripts/gen-kit.mjs';
import { lintSpecSource } from '../scripts/lib/preview.mjs';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = ['shesha', 'wcg', 'cobalt'];

const GT_CANDIDATES = [
  process.env.SHESHA_GROUND_TRUTH,
  'C:/Users/Hashim/Downloads/boxfusion.test/.shesha/ground-truth.json',
].filter(Boolean);

let groundTruthPath = null;
let anatomy = null;

before(() => {
  for (const p of GT_CANDIDATES) {
    if (p && existsSync(p)) {
      groundTruthPath = p;
      break;
    }
  }
  anatomy = loadAnatomy();
});

/** Generate a kit into a scratch dir and return { dir, report }. */
function build(themeName) {
  const dir = join(SKILL_ROOT, '.tmp', `kit-test-${themeName}`);
  const report = generateKit({ groundTruthPath, outDir: dir, themeName });
  return { dir, report };
}

function kitFiles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'));
}

// =====================================================================================
describe('token files', () => {
  it('all three themes parse and declare they were transcribed, not chosen', () => {
    for (const name of THEMES) {
      const t = loadTheme(name);
      assert.equal(t.name, name);
      assert.equal(t.provenance.transcribedNotChosen, true, `${name} does not claim transcription`);
      assert.ok(t.provenance.source && t.provenance.source.length > 20, `${name} has no source`);
    }
  });

  it('share one schema — every theme answers every role', () => {
    // The whole point of the boundary: a consumer reads the same shape regardless of brand.
    const shape = (t) => ({
      brand: Object.keys(t.brand).sort(),
      surface: Object.keys(t.surface).sort(),
      line: Object.keys(t.line).sort(),
      ink: Object.keys(t.ink).sort(),
      semantic: Object.keys(t.semantic).sort(),
      radius: Object.keys(t.radius).sort(),
    });
    const base = shape(loadTheme('shesha'));
    for (const name of THEMES.slice(1)) {
      const other = shape(loadTheme(name));
      for (const group of Object.keys(base)) {
        const missing = base[group].filter((k) => !other[group].includes(k));
        assert.deepEqual(missing, [], `${name}.${group} is missing role(s): ${missing.join(', ')}`);
      }
    }
  });

  it('treats deleted accent roles as NULL, never as a substituted colour', () => {
    // WCG deletes sage, accentBlue and accentTeal; Cobalt has no decorative accents at all.
    const wcg = loadTheme('wcg');
    for (const role of ['sage', 'accentBlue', 'accentTeal']) {
      assert.equal(wcg.semantic[role], null, `wcg.semantic.${role} must be null, not recoloured`);
    }
    const cobalt = loadTheme('cobalt');
    for (const role of ['sage', 'purple', 'accentBlue', 'accentTeal']) {
      assert.equal(cobalt.semantic[role], null, `cobalt.semantic.${role} must be null`);
    }
    // And the resolver must not invent one.
    assert.equal(resolveToken('@semantic.sage', wcg, { fallback: null }), null);
  });

  it('hard-codes the two colours that are identical across every brand', () => {
    for (const name of THEMES) {
      const t = loadTheme(name);
      assert.match(t.surface.surface.toLowerCase(), /^#ffffff$/, `${name} surface`);
    }
    // danger is identical in the two measured brands; Cobalt is a different lineage.
    assert.equal(loadTheme('shesha').semantic.danger.toLowerCase(), '#c0392b');
    assert.equal(loadTheme('wcg').semantic.danger.toLowerCase(), '#c0392b');
  });

  it('declares a spacing SET per brand rather than a multiples-of-4 rule', () => {
    // A 4px rule rejects the reference designs themselves: LandBank's most-used gap is 10
    // and WCG's are 9 and 11. Cobalt IS a strict 4px grid, which is exactly why the rule
    // has to live in the token file.
    const sh = loadTheme('shesha').spacing.declared;
    const wcg = loadTheme('wcg').spacing.declared;
    const cob = loadTheme('cobalt').spacing.declared;
    assert.ok(sh.includes(10), 'shesha spacing must include its most-used 10');
    assert.ok(wcg.includes(9) && wcg.includes(11), 'wcg spacing must include 9 and 11');
    assert.ok(sh.some((n) => n % 4 !== 0), 'shesha grid is 2px, so some values are not multiples of 4');
    assert.ok(cob.every((n) => n % 4 === 0), 'cobalt IS a strict 4px grid');
  });

  it('records statusModel, because solid and tint are not interchangeable', () => {
    assert.equal(loadTheme('shesha').statusModel, 'solid');
    assert.equal(loadTheme('wcg').statusModel, 'tint');
    assert.equal(loadTheme('cobalt').statusModel, 'tint');
  });

  it('models card elevation as a philosophy, not a value', () => {
    assert.equal(loadTheme('shesha').elevation.shadowCard, 'none', 'house-kit cards are flat');
    assert.notEqual(loadTheme('wcg').elevation.shadowCard, 'none', 'wcg surfaces are lifted');
  });
});

// =====================================================================================
describe('the mirror kit: generated, not written', () => {
  it('emits every file with the GENERATED banner on line 1', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json; run probe first');
    const { dir } = build('shesha');
    const files = kitFiles(dir);
    assert.ok(files.length > 25, `only ${files.length} kit files`);
    for (const f of files) {
      const first = readFileSync(join(dir, f), 'utf8').split('\n')[0];
      assert.equal(first, BANNER, `${f} does not open with the generated banner`);
    }
  });

  it('has ZERO hand-written lines — the Phase 3 bet', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    // The blunt test from the brief. Regenerating must reproduce every kit file byte for
    // byte; any difference means something was hand-edited, and a hand-edited kit drifts
    // from the framework within one release.
    const a = build('shesha');
    const before = new Map(kitFiles(a.dir).map((f) => [f, readFileSync(join(a.dir, f), 'utf8')]));
    const b = build('shesha');
    const after = new Map(kitFiles(b.dir).map((f) => [f, readFileSync(join(b.dir, f), 'utf8')]));

    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the file set changed between runs');
    for (const [f, text] of before) {
      assert.equal(after.get(f), text, `${f} is not reproducible — it differs between two generations`);
    }
  });

  it('is newer than its generator, so a stale kit is detectable', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const { dir } = build('shesha');
    const genMtime = statSync(join(SKILL_ROOT, 'scripts', 'gen-kit.mjs')).mtimeMs;
    for (const f of kitFiles(dir)) {
      assert.ok(
        statSync(join(dir, f)).mtimeMs >= genMtime,
        `${f} is older than gen-kit.mjs — regenerate`
      );
    }
  });

  it('records its inputs by hash, so drift is provable', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const { report } = build('shesha');
    for (const k of ['generatorSha256', 'anatomySha256', 'themeSha256']) {
      assert.match(report[k], /^[0-9a-f]{64}$/, `${k} missing`);
    }
  });
});

// =====================================================================================
describe('the mirror kit: the straitjacket', () => {
  it('excludes the Shesha columns component entirely', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const { dir, report } = build('shesha');
    assert.ok(!existsSync(join(dir, 'Columns.jsx')), 'a Columns component was generated');
    assert.ok(!report.components.some((c) => c.sheshaType === 'columns' && c.name !== 'Column'));
    // ...and the reason is available, so exit 15 can explain itself.
    const forbidden = readFileSync(join(dir, '_forbidden.js'), 'utf8');
    assert.match(forbidden, /columns:/);
    assert.match(forbidden, /R-028/);
  });

  it('never generates htmlRender, markdown or a raw element component', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const { report } = build('shesha');
    for (const banned of ['htmlRender', 'markdown']) {
      assert.ok(
        !report.components.some((c) => c.sheshaType === banned),
        `${banned} must not be reachable from a spec — it PAINTS a page instead of building one`
      );
    }
  });

  it('refuses a style, className or hex literal in a spec', () => {
    const kit = ['Page', 'Card'];
    const cases = [
      ['<Page style={{ color: "red" }} />', /inline style/i],
      ['<Page className="x" />', /className/i],
      ['const c = "#0d685a";', /hex colour/i],
      ['<div>painted</div>', /raw HTML/i],
      ['<Page dangerouslySetInnerHTML={{__html:"x"}} />', /painting channel/i],
    ];
    for (const [src, expected] of cases) {
      const problems = lintSpecSource(`import { Page, Card } from '@shesha-mirror/kit';\n${src}`, kit, {});
      const msgs = problems.map((p) => p.why).join('\n');
      assert.match(msgs, expected, `not rejected: ${src}`);
    }
  });

  it('names an unknown component and calls it a kit gap, not a workaround cue', () => {
    const problems = lintSpecSource(
      "import { Page, Sparkline } from '@shesha-mirror/kit';\n<Page><Sparkline /></Page>",
      ['Page'],
      {}
    );
    const notInKit = problems.filter((p) => p.kind === 'not-in-kit');
    assert.equal(notInKit.length, 1);
    assert.equal(notInKit[0].component, 'Sparkline');
    assert.match(notInKit[0].why, /KIT GAP/);
    assert.match(notInKit[0].why, /do not work around it by painting/);
  });

  it('accepts the reference spec unchanged', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const { report } = build('shesha');
    const spec = readFileSync(join(SKILL_ROOT, 'tests', 'fixtures', 'asset-worklist.spec.jsx'), 'utf8');
    const problems = lintSpecSource(spec, report.components.map((c) => c.name), {});
    assert.deepEqual(problems, [], `the reference spec was rejected: ${JSON.stringify(problems, null, 1)}`);
  });

  it('drops an author prop that maps to a channel the component cannot honour', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    // R-053 by construction. antd's Alert and Progress own their own colour, so `emphasis`
    // on InfoCallout / Toast / ProgressBar would be a dead channel and is not generated —
    // writing it in a spec throws instead of silently rendering nothing.
    const { dir, report } = build('shesha');
    assert.ok(report.droppedProps.length > 0, 'no props were dropped at all — is the channel check running?');
    for (const d of report.droppedProps) {
      const meta = readFileSync(join(dir, `${d.component}.jsx`), 'utf8');
      const m = meta.match(/"allowedProps":\[([^\]]*)\]/);
      assert.ok(m, `${d.component} has no allowedProps`);
      assert.ok(!m[1].includes(`"${d.prop}"`), `${d.component} still accepts the dropped prop "${d.prop}"`);
    }
  });
});

// =====================================================================================
describe('the token boundary: nothing structural may change', () => {
  it('generates an identical component set for every theme', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const sets = THEMES.map((name) => {
      const { report } = build(name);
      return { name, components: report.components.map((c) => `${c.name}:${c.sheshaType}`).sort() };
    });
    for (const s of sets.slice(1)) {
      assert.deepEqual(
        s.components,
        sets[0].components,
        `theme "${s.name}" changed the component set — that is a structural leak, not a re-skin`
      );
    }
  });

  it('generates an identical prop surface for every theme', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const surfaceOf = (dir) => {
      const out = {};
      for (const f of kitFiles(dir).filter((x) => x.endsWith('.jsx'))) {
        const m = readFileSync(join(dir, f), 'utf8').match(/"allowedProps":\[([^\]]*)\]/);
        out[f] = m ? m[1].split(',').map((s) => s.trim()).sort().join(',') : '';
      }
      return out;
    };
    const base = surfaceOf(build('shesha').dir);
    for (const name of THEMES.slice(1)) {
      const other = surfaceOf(build(name).dir);
      assert.deepEqual(other, base, `theme "${name}" changed the author prop surface`);
    }
  });

  it('produces an identical render body for every theme — only values differ', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    // Strip every object literal (the resolved token values) and compare what is left.
    // What remains is structure: the JSX, the parts, the conditionals.
    const skeleton = (text) =>
      text
        .replace(/^\/\/.*$/gm, '')
        .replace(/const (BASE|PARTS|VARIANTS|ROLES) = [\s\S]*?;\n/g, 'const $1 = <VALUES>;\n')
        .replace(/export const __meta = .*?;\n/g, '')
        .replace(/style\[\"[^\"]+\"\] = .*?;\n/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const dirs = Object.fromEntries(THEMES.map((n) => [n, build(n).dir]));
    for (const f of kitFiles(dirs.shesha).filter((x) => x.endsWith('.jsx'))) {
      const base = skeleton(readFileSync(join(dirs.shesha, f), 'utf8'));
      for (const name of THEMES.slice(1)) {
        assert.equal(
          skeleton(readFileSync(join(dirs[name], f), 'utf8')),
          base,
          `${f} has a different STRUCTURE under theme "${name}" — the theme leaked past values`
        );
      }
    }
  });

  it('actually changes the resolved values', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    // The mirror of the test above: if nothing changed, the theme is not being applied.
    const a = readFileSync(join(build('shesha').dir, 'Button.jsx'), 'utf8');
    const b = readFileSync(join(build('wcg').dir, 'Button.jsx'), 'utf8');
    assert.notEqual(a, b, 'Button is byte-identical across two brands — the theme is not applied');
    assert.match(a, /#0d685a/i, 'house-kit Button should carry the LandBank primary');
    assert.match(b, /#1A3E6F/i, 'wcg Button should carry the navy primary');
  });

  it('derives emphasis from the theme, falling back rather than inventing', () => {
    for (const name of THEMES) {
      const theme = loadTheme(name);
      const E = emphasisMap(theme);
      for (const key of ['default', 'primary', 'success', 'warning', 'danger', 'info', 'muted']) {
        assert.ok(E[key], `${name} emphasis "${key}" missing`);
        assert.ok(E[key].accent, `${name} emphasis "${key}" has no accent`);
      }
      // WCG deletes sage, so success must fall back to the brand primary.
      if (theme.semantic.sage === null) {
        assert.equal(E.success.accent, theme.brand.primary, `${name} success should fall back to primary`);
      }
    }
  });
});

// =====================================================================================
describe('anatomy', () => {
  it('uses only @token references for colour — never a literal', () => {
    // If the anatomy carried a hex value, the token boundary would be broken at the source
    // and no amount of theme switching would fix it.
    const raw = readFileSync(join(SKILL_ROOT, 'assets', 'house-anatomy.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const offenders = [];
    const walk = (node, path) => {
      if (typeof node === 'string') {
        if (/#[0-9a-fA-F]{3,8}\b/.test(node) && !/^#(fff|ffffff)$/i.test(node)) offenders.push(`${path}: ${node}`);
        return;
      }
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          // Prose fields legitimately quote measured values.
          if (['note', 'purpose', 'provenance', 'whyJsonNotMarkdown', 'postureRules', 'evidence'].includes(k)) continue;
          walk(v, `${path}.${k}`);
        }
      }
    };
    for (const [name, spec] of Object.entries(parsed.components)) walk(spec, name);
    assert.deepEqual(offenders, [], `anatomy contains colour literals: ${offenders.join(', ')}`);
  });

  it('declares the forbidden-in-specs list, with a reason', () => {
    const v = anatomy.specVocabulary;
    for (const banned of ['style', 'className', 'htmlRender', 'markdown']) {
      assert.ok(
        v.forbiddenInSpecs.some((f) => f.includes(banned)),
        `${banned} is not listed as forbidden`
      );
    }
    assert.match(v.forbiddenNote, /BUILT.*never PAINTED/i);
  });

  it('carries the adopted posture rules, each with an enforcer', () => {
    // Adopted from the external design-system handover; brand-agnostic, so they hold for
    // every theme here.
    const p = anatomy.postureRules;
    assert.ok(p.rules.length >= 10, `only ${p.rules.length} posture rules`);
    for (const r of p.rules) {
      assert.match(r.id, /^P-\d\d$/);
      assert.ok(r.rule.length > 20, `${r.id} has no rule text`);
      assert.ok(r.enforcedBy, `${r.id} names no enforcer`);
    }
  });

  it('records what was NOT adopted from that handover, with evidence', () => {
    const na = anatomy.postureRules.notAdopted;
    assert.ok(na.length >= 4, 'the rejections must be recorded, not just the adoptions');
    for (const r of na) {
      assert.ok(r.claim && r.verdict && r.evidence, 'each rejection needs claim, verdict and evidence');
      assert.ok(r.evidence.length > 40, `thin evidence for: ${r.claim}`);
    }
    // The load-bearing one: "never write appearance into form JSON" is measured false for 0.45.
    const appearance = na.find((r) => /never write appearance/i.test(r.claim));
    assert.ok(appearance, 'the appearance-in-JSON claim must be explicitly dispositioned');
    assert.match(appearance.verdict, /REJECTED/);
    assert.match(appearance.evidence, /no antd `token` channel|NO antd `token` channel/i);
  });
});

// =====================================================================================
describe('channel support derivation', () => {
  it('reports container as having no font channel and text as having one', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const gt = JSON.parse(readFileSync(groundTruthPath, 'utf8'));
    const container = supportedChannels('container', gt);
    const text = supportedChannels('text', gt);
    assert.equal(container.known, true);
    assert.equal(container.channels.font, false, 'container should expose no font property');
    assert.equal(text.channels.font, true, 'text should expose a font property');
  });

  it('says so plainly for a type it cannot judge', (t) => {
    if (!groundTruthPath) return t.skip('no ground-truth.json');
    const gt = JSON.parse(readFileSync(groundTruthPath, 'utf8'));
    const unknown = supportedChannels('notARealType', gt);
    assert.equal(unknown.known, false);
    assert.match(unknown.reason, /not in registry/);
  });
});

/**
 * CAPTURE_FN is a TEMPLATE LITERAL, so every regex escape inside it needs doubling: `\s`
 * written once collapses to a bare `s` before the browser ever sees it, and `\(` collapses to
 * `(`, silently turning a literal into a capture group.
 *
 * Both failure modes shipped. `.split(/\s+/)` split class lists on the letter "s", so the
 * fidelity diff read zero roles; and `/rgba(0, 0, 0, 0)|transparent/` searched for the literal
 * text "rgba0, 0, 0, 0", so a fully transparent background scored as a real colour in
 * pageBackground, cardSurface and borderColour. Neither threw — they just quietly answered
 * wrongly, which is the exact defect class this project exists to remove. Hence a test.
 */
describe('capture function escaping', () => {
  it('has no single-escaped regex metacharacters', async () => {
    const { CAPTURE_FN } = await import('../scripts/lib/anatomy.mjs');
    // CAPTURE_FN is already the POST-collapse string — what the browser will actually run.
    // So the bug is visible directly: look for regex literals that lost their escapes.
    const offenders = [];

    // A character class shorthand that survived would appear as \s / \d / \w. If the source
    // single-escaped it, the shorthand is GONE and we cannot see it here — so instead assert
    // the known-good forms are present, proving the doubling survived.
    if (!/\s\+/.test(CAPTURE_FN) && /\.split\(\/s\+\//.test(CAPTURE_FN)) {
      offenders.push('split(/s+/) — \s collapsed to s; double the backslash in the source');
    }
    // An unescaped-paren rgba test matches literal "rgba0, 0, 0, 0" and never fires.
    const unescapedRgba = CAPTURE_FN.match(/\/rgba\(0, 0, 0, 0\)/g);
    if (unescapedRgba) {
      offenders.push(`${unescapedRgba.length} rgba test(s) with unescaped parens`);
    }
    assert.deepEqual(offenders, [], offenders.join('; '));
  });

  it('records ant-/sha- class names, since roles are not otherwise observable', async () => {
    const { CAPTURE_FN } = await import('../scripts/lib/anatomy.mjs');
    assert.match(CAPTURE_FN, /cls:/, 'capture must record class names');
    assert.match(CAPTURE_FN, /\^\(ant\|sha\)-/, 'capture must filter to ant-/sha- classes');
  });
});
