import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRole, validateRoles } from '../scripts/lib/resolve-role.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REG = join(ROOT, '../shesha-form-edit/assets/registry');

const tokens = {
  spacing: { 3: 12, 4: 16, 6: 24 },
  radius: { xs: 2, lg: 8 },
  palette: { surfaces: { canvas: '#F8F8F9' }, lines: { border: '#E8EAF0' } },
  roles: { pageBg: 'palette.surfaces.canvas', hairline: 'palette.lines.border' },
};

const roles = {
  'page-root': {
    componentType: 'container',
    desktop: {
      display: 'flex', flexDirection: 'column', gap: '$spacing.6',
      dimensions: { width: '100%', minHeight: 'fit-content' },
      background: { type: 'color', color: '$roles.pageBg' },
      stylingBox: { padding: '$spacing.6' },
    },
    tablet: { $inherit: 'desktop', stylingBox: { padding: '$spacing.4' } },
    mobile: { $inherit: 'desktop', stylingBox: { padding: '$spacing.3' } },
  },
};

test('resolves direct token references to literals', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.desktop.gap, 24);
  assert.equal(r.desktop.stylingBox.padding, 24);
});

test('resolves a role token that points at a palette path (two hops)', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.desktop.background.color, '#F8F8F9');
});

test('emits all three breakpoints', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  for (const bp of ['desktop', 'tablet', 'mobile']) assert.ok(r[bp], `${bp} missing`);
});

test('$inherit copies the base breakpoint then applies the override', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.tablet.display, 'flex');          // inherited
  assert.equal(r.tablet.flexDirection, 'column');  // inherited
  assert.equal(r.tablet.stylingBox.padding, 16);   // overridden ($spacing.4)
  assert.equal(r.mobile.stylingBox.padding, 12);   // overridden ($spacing.3)
});

test('$inherit does not leak the marker into output', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.tablet.$inherit, undefined);
});

test('throws on an unknown role rather than returning an empty block', () => {
  assert.throws(() => resolveRole('no-such-role', { roles, tokens, componentType: 'container' }),
    /unknown role: no-such-role/);
});

test('resolves a token whose value is a bare number, not a dotted path', () => {
  const numTokens = { chrome: { railWidth: 332 } };
  const numRoles = {
    rail: {
      componentType: 'container',
      desktop: { dimensions: { width: '$chrome.railWidth', minWidth: '$chrome.railWidth', maxWidth: '$chrome.railWidth' } },
    },
  };
  const r = resolveRole('rail', { roles: numRoles, tokens: numTokens });
  assert.equal(r.desktop.dimensions.width, 332);
  assert.equal(typeof r.desktop.dimensions.width, 'number');
  assert.equal(r.desktop.dimensions.minWidth, 332);
  assert.equal(r.desktop.dimensions.maxWidth, 332);
});

test('throws on an unresolvable token reference', () => {
  const bad = { r: { componentType: 'container', desktop: { gap: '$spacing.99' } } };
  assert.throws(() => resolveRole('r', { roles: bad, tokens, componentType: 'container' }),
    /unresolvable token: \$spacing\.99/);
});

test('validateRoles rejects a prop the component type does not have', () => {
  const registry = { components: { container: { props: ['display', 'gap', 'dimensions.width'] } } };
  const bad = { r: { componentType: 'container', desktop: { display: 'flex', bogusProp: 1 } } };
  const problems = validateRoles({ roles: bad, registry });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bogusProp/);
});

test('validateRoles accepts a catalogue whose props all exist', () => {
  const registry = {
    components: { container: { props: ['display', 'flexDirection', 'gap', 'dimensions.width',
      'dimensions.minHeight', 'background.type', 'background.color', 'stylingBox'] } },
  };
  assert.deepEqual(validateRoles({ roles, registry }), []);
});

test('validateRoles rejects a role whose componentType is not in the registry', () => {
  const registry = { components: { container: { props: [] } } };
  const bad = { r: { componentType: 'notAThing', desktop: {} } };
  const problems = validateRoles({ roles: bad, registry });
  assert.match(problems[0], /notAThing/);
});

test('the shipped catalogue is valid against the registry and resolves fully', () => {
  const roles = JSON.parse(readFileSync(join(ROOT, 'assets/roles.styles.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(join(REG, 'registry-0.45.1.json'), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(ROOT, 'assets/themes/shesha.tokens.json'), 'utf8'));

  assert.deepEqual(validateRoles({ roles, registry }), []);

  // Iterate every key in the shipped catalogue, not a hardcoded list, so newly
  // added roles are covered automatically without editing this test again.
  for (const name of Object.keys(roles)) {
    const r = resolveRole(name, { roles, tokens });
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      assert.ok(r[bp], `${name}.${bp} missing`);
      // No unresolved token markers may survive.
      assert.ok(!JSON.stringify(r[bp]).includes('"$'), `${name}.${bp} has unresolved tokens`);
    }
  }
});

test('detail-rail resolves under the requirements-studio brand (Phase 5 item 4 added chrome.detailRailWidth)', () => {
  // Before Phase 5 item 4, requirements-studio.tokens.json had its own chrome.railWidth
  // (56px, an unrelated collapsed-icon-rail width) but no chrome.detailRailWidth, so
  // resolving detail-rail against it threw — correctly (loud beats silently wrong), but
  // it meant the one shipped custom brand couldn't build a record-detail archetype at
  // all. Phase 5 item 4 added the missing chrome.detailRailWidth (332, the shesha
  // default's own value — a structural/layout metric, not a colour decision, and no
  // RS-specific measurement exists to use instead). This test now asserts the opposite
  // of what it used to: resolution succeeds, and this brand's OWN railWidth (56,
  // unrelated) stays untouched.
  const roles = JSON.parse(readFileSync(join(ROOT, 'assets/roles.styles.json'), 'utf8'));
  const rsTokens = JSON.parse(
    readFileSync(join(ROOT, 'assets/themes/requirements-studio.tokens.json'), 'utf8'));
  const r = resolveRole('detail-rail', { roles, tokens: rsTokens });
  assert.equal(r.desktop.dimensions.width, 332);
  assert.equal(rsTokens.chrome.railWidth, 56); // this brand's own, unrelated chrome key, unchanged
});

// The shipped brands, by name — deliberately NOT a directory glob. assets/themes/ can
// hold untracked, in-progress brand files during development (e.g. skyline.tokens.json,
// explicitly left uncommitted/unfinished per this repo's working conventions) that are
// not yet "shipped" and may legitimately be incomplete; globbing the directory would
// make this test fail on someone else's in-progress work rather than on a real gap in a
// brand this project actually ships.
const SHIPPED_BRAND_FILES = ['shesha.tokens.json', 'requirements-studio.tokens.json'];

test('every role in the shipped catalogue resolves against every shipped brand', () => {
  // Phase 5 item 4: the RS brand used to be missing ~198 of the default's keys, so this
  // never held for RS. Iterates every role in roles.styles.json (not a hardcoded list, so
  // a newly added role/archetype is covered automatically) against each shipped brand.
  const roles = JSON.parse(readFileSync(join(ROOT, 'assets/roles.styles.json'), 'utf8'));
  const themesDir = join(ROOT, 'assets/themes');
  for (const file of SHIPPED_BRAND_FILES) {
    assert.ok(existsSync(join(themesDir, file)), `expected shipped brand file ${file} to exist`);
  }

  for (const file of SHIPPED_BRAND_FILES) {
    const tokens = JSON.parse(readFileSync(join(themesDir, file), 'utf8'));
    for (const name of Object.keys(roles)) {
      assert.doesNotThrow(
        () => {
          const r = resolveRole(name, { roles, tokens });
          for (const bp of ['desktop', 'tablet', 'mobile']) {
            assert.ok(!JSON.stringify(r[bp]).includes('"$'), `${name}.${bp} has an unresolved token`);
          }
        },
        `role "${name}" fails to resolve against brand file "${file}"`,
      );
    }
  }
});

test('container roles set the complete layout contract', () => {
  const roles = JSON.parse(readFileSync(join(ROOT, 'assets/roles.styles.json'), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(ROOT, 'assets/themes/shesha.tokens.json'), 'utf8'));
  const REQUIRED = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];
  const REQUIRED_DIM = ['width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight'];

  for (const [name, role] of Object.entries(roles)) {
    if (role.componentType !== 'container') continue;
    const r = resolveRole(name, { roles, tokens });
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      for (const p of REQUIRED) {
        assert.notEqual(r[bp][p], undefined, `${name}.${bp}.${p} is unset`);
      }
      for (const d of REQUIRED_DIM) {
        assert.notEqual(r[bp].dimensions?.[d], undefined, `${name}.${bp}.dimensions.${d} is unset`);
      }
      assert.ok(r[bp].stylingBox !== undefined, `${name}.${bp}.stylingBox is unset`);
    }
  }
});
