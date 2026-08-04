// Theme inheritance + validation — the isolated theme stage.
//
// Two properties are pinned here, and they pull in opposite directions on purpose:
//
//   SUBTRACTION. A shipped brand file that is an OVERRIDE carries ONLY the keys that differ
//   from its base. So the tests below assert on the RESOLVED theme, and separately assert that
//   the override files do NOT restate a base value — because a restated value is exactly the
//   drift inheritance exists to delete, and nothing else would ever catch it.
//
//   FAIL CLOSED. Every way a theme can be unresolvable — unknown name, unreadable file, a
//   missing role the compiler reads, a role pointing at a token path nothing resolves, a
//   cyclic `extends` — THROWS. `--no-style` is the only opt-out, and it is explicit.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme, validateResolvedTheme, contrastRatio, checkContrast, THEME_SCHEMA_PATH } from '../scripts/compile/resolve-theme.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEME_DIR = path.join(HERE, '..', '..', 'shesha-design-system', 'assets', 'themes');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-resolution-'));

const SHIPPED = ['shesha', 'shesha-bold', 'requirements-studio'];
const raw = (t) => JSON.parse(fs.readFileSync(path.join(THEME_DIR, `${t}.tokens.json`), 'utf8'));
const write = (name, obj) => {
  const f = path.join(WORK, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
};

// The exact set compile-node.mjs asks tk() for. The schema is the authority; this reads it off
// the schema rather than keeping a second copy that can rot.
const REQUIRED_ROLES = JSON.parse(fs.readFileSync(THEME_SCHEMA_PATH, 'utf8')).properties.roles.required;

// ---- every shipped theme resolves to a COMPLETE, valid theme -------------------
test('every shipped theme resolves and validates with no error findings', () => {
  for (const t of SHIPPED) {
    const theme = loadTheme(t);
    assert.ok(theme.tokens, `${t} resolved to no tokens`);
    const errors = theme.findings.filter((f) => f.severity === 'error');
    assert.deepEqual(errors, [], `${t} has error findings: ${JSON.stringify(errors, null, 2)}`);
  }
});

test('every shipped theme resolves every role the compiler reads (tk() never misses)', () => {
  for (const t of SHIPPED) {
    const { tokens, tk } = loadTheme(t);
    for (const role of REQUIRED_ROLES) {
      assert.ok(tokens.roles[role] !== undefined, `${t} is missing roles.${role}`);
      const sentinel = '__NEVER__';
      assert.notEqual(tk(role, sentinel), sentinel,
        `${t}: roles.${role} exists but does not RESOLVE — tk() would fall back and the value ships missing`);
    }
    assert.ok(Number.isInteger(tokens.chrome.tableRowHeight), `${t} is missing chrome.tableRowHeight`);
  }
});

// ---- subtraction: an override may not restate a base value --------------------
test('the override files carry ONLY what differs — no key restates its base value', () => {
  const base = loadTheme('shesha').tokens;
  const at = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const paths = (o, p = '', out = []) => {
    for (const [k, v] of Object.entries(o)) {
      const q = p ? `${p}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) paths(v, q, out);
      else out.push(q);
    }
    return out;
  };
  for (const t of ['shesha-bold', 'requirements-studio']) {
    const own = raw(t);
    assert.equal(own.extends, 'shesha', `${t} must be an override extending shesha`);
    const restated = paths(own)
      .filter((p) => !p.startsWith('$') && p !== 'extends' && !p.split('.').some((s) => s.startsWith('$')))
      .filter((p) => at(base, p) !== undefined && JSON.stringify(at(own, p)) === JSON.stringify(at(base, p)));
    assert.deepEqual(restated, [],
      `${t} restates ${restated.length} base value(s) verbatim — delete them, inheritance supplies them: ${restated.join(', ')}`);
  }
});

test('inheritance SUPPLIES what an override omits, and the override still wins where it speaks', () => {
  const base = loadTheme('shesha').tokens;
  const rs = loadTheme('requirements-studio').tokens;
  // omitted by requirements-studio → inherited verbatim
  assert.equal(rs.spacing['16'], base.spacing['16'], 'an omitted spacing step must be inherited, not dropped');
  assert.equal(rs.roles.selectedBg, base.roles.selectedBg, 'an omitted role must be inherited');
  // declared by requirements-studio → its own value, base overridden
  assert.equal(rs.palette.brand.primary, '#0d685a');
  assert.equal(rs.roles.sectionHeading, 'palette.brand.primary',
    'requirements-studio colours its headings with the brand where shesha uses ink');
  assert.equal(rs.radius.lg, 12, 'a declared radius must beat the base');
  // arrays replace wholesale — a lifecycle is a sequence, not a set of slots to patch
  assert.deepEqual(rs.statusLifecycle.order, ['Draft', 'Confirmed', 'InBuild', 'Delivered', 'Rejected', 'OnHold']);
  // and the chain is reported, so a reader can see where a value came from
  assert.deepEqual(loadTheme('requirements-studio').chain, ['shesha', 'requirements-studio']);
});

test('a resolved role reference still resolves through the OVERRIDDEN palette, not the base one', () => {
  // roles are token REFERENCES, which is what makes a brand re-skinnable: shesha-bold changes
  // only palette.brand.tint, and roles.bandBg picks the new value up for free.
  const bold = loadTheme('shesha-bold');
  assert.equal(bold.tokens.roles.bandBg, 'palette.brand.tint');
  assert.equal(bold.tk('bandBg'), '#E0E9FF');
  assert.equal(loadTheme('shesha').tk('bandBg'), '#FFFFFF');
});

// ---- fail closed --------------------------------------------------------------
test('an unknown theme NAME throws, and names the theme', () => {
  assert.throws(() => loadTheme('definitely-not-a-theme'), (err) => {
    assert.match(err.message, /definitely-not-a-theme/);
    assert.doesNotMatch(err.message, /emitting neutral defaults/);
    return true;
  });
});

test('a resolved theme missing a required role throws, naming the role', () => {
  for (const role of REQUIRED_ROLES) {
    const bad = loadTheme('shesha').tokens;
    delete bad.roles[role];
    assert.throws(() => loadTheme(write(`missing-${role}.tokens.json`, bad), { isFile: true }),
      new RegExp(`roles\\.${role}`), `deleting roles.${role} must be a compile error`);
  }
});

test('a dangling token reference throws, naming the path', () => {
  const bad = loadTheme('shesha').tokens;
  bad.roles.cardBg = 'palette.surfaces.nowhere';
  assert.throws(() => loadTheme(write('dangling.tokens.json', bad), { isFile: true }),
    /dangling-token-reference[\s\S]*palette\.surfaces\.nowhere/);
});

test('a cyclic extends chain throws instead of overflowing the stack', () => {
  const a = path.join(WORK, 'cyc-a.tokens.json');
  const b = path.join(WORK, 'cyc-b.tokens.json');
  fs.writeFileSync(a, JSON.stringify({ $brand: 'cyc-a', extends: './cyc-b.tokens.json' }));
  fs.writeFileSync(b, JSON.stringify({ $brand: 'cyc-b', extends: './cyc-a.tokens.json' }));
  assert.throws(() => loadTheme(a, { isFile: true }), /CYCLE/);
});

test('an extends target that does not resolve throws, naming it', () => {
  const f = write('orphan.tokens.json', { $brand: 'orphan', extends: 'no-such-base' });
  assert.throws(() => loadTheme(f, { isFile: true }), /no-such-base/);
});

test('a malformed theme file throws rather than resolving to a partial theme', () => {
  const f = path.join(WORK, 'broken.tokens.json');
  fs.writeFileSync(f, '{ not json');
  assert.throws(() => loadTheme(f, { isFile: true }), /unreadable/);
});

test('validateResolvedTheme reports STRUCTURED findings, not sentences', () => {
  const bad = loadTheme('shesha').tokens;
  delete bad.roles.pageBg;
  bad.roles.cardBg = 'palette.surfaces.nowhere';
  const findings = validateResolvedTheme(bad).filter((f) => f.severity === 'error');
  for (const f of findings) {
    for (const key of ['path', 'rule', 'message', 'severity']) {
      assert.ok(key in f, `a finding is missing "${key}": ${JSON.stringify(f)}`);
    }
  }
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes('required-key-missing'), `expected a required-key-missing finding, got ${rules.join(', ')}`);
  assert.ok(rules.includes('dangling-token-reference'), `expected a dangling-token-reference finding, got ${rules.join(', ')}`);
  assert.ok(findings.some((f) => f.path === 'roles.pageBg'), 'the missing-role finding must be pathed at roles.pageBg');
});

// ---- --no-style is the ONE opt-out -------------------------------------------
test('--no-style resolves NO tokens, and every lookup takes its neutral fallback', () => {
  const t = loadTheme('shesha', { noStyle: true });
  assert.equal(t.tokens, null);
  assert.match(t.note, /--no-style/);
  assert.equal(t.tk('pageBg', '#f5f6f8'), '#f5f6f8');
  assert.equal(t.px('4', 0), 16, 'the neutral spacing scale still resolves step 4 to 16px');
  // it is the only road that tolerates an unknown name, because the name is never read
  assert.doesNotThrow(() => loadTheme('definitely-not-a-theme', { noStyle: true }));
});

// ---- contrast: a semantic check beside the schema ----------------------------
test('contrastRatio implements the WCAG ratio (and is null for anything non-hex)', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrastRatio('#000', '#fff').toFixed(2), '21.00', 'a 3-digit hex must expand');
  assert.equal(contrastRatio('rgba(0,0,0,0.5)', '#ffffff'), null);
});

test('every shipped theme clears the AA 4.5:1 body-text floor on BOTH grounds', () => {
  for (const t of SHIPPED) {
    assert.deepEqual(checkContrast(loadTheme(t).tokens), [],
      `${t} body text does not clear WCAG AA against the page and card grounds`);
  }
});

test('a low-contrast body ink is REPORTED as a warn finding — not fatal, never silent', () => {
  const dim = loadTheme('shesha').tokens;
  dim.palette.ink.primary = '#c9c9c9';           // roles.bodyText → palette.ink.primary
  const warns = checkContrast(dim);
  assert.equal(warns.length, 2, 'both the page ground and the card ground must be reported');
  assert.ok(warns.every((f) => f.severity === 'warn' && f.rule === 'contrast-below-aa'));
  assert.match(warns[0].message, /4\.5:1/);
  // a brand's own contrast is the brand's call, so it must still COMPILE — loudly
  const theme = loadTheme(write('dim-ink.tokens.json', dim), { isFile: true });
  assert.ok(theme.findings.some((f) => f.rule === 'contrast-below-aa'),
    'the warning must ride along on the loaded theme so the entry can print it');
});
