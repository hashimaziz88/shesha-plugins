import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: zero literal hex colours in assets/block-styles/**.
 *
 * Mirrors the discipline `roles.styles.json` already follows (every colour
 * channel there is a `$roles.*` reference, never a hex) — see
 * resolve-role.test.mjs's "the shipped catalogue is valid against the
 * registry and resolves fully", which asserts a fully-resolved role carries
 * no leftover "$" token markers. `roles.styles.json` happens to ship zero raw
 * hexes today, but nothing in this repo directly scans it for one; this test
 * is the first direct hex-zero guard for a design-system style asset, and it
 * covers block-styles/**, the file family Task 3 (Phase 5 debt paydown)
 * found carrying 49 literal hexes against 10 `$role:` references.
 *
 * A colour channel here must be `$role:<name>` (preferred — resolves through
 * the role indirection so a brand swap actually changes it) or, when no role
 * exists for the exact palette value, `$palette.<section>.<key>` (still
 * token-derived, just not yet promoted to a semantic role).
 *
 * Three hexes survive as a NAMED, COMMENTED allowlist (never a blanket
 * exemption): task-3-report.md found no value in shesha.tokens.json (the
 * default brand) equal to any of them, and inventing a token to absorb them
 * was explicitly out of scope for that task. If any of these ever gets a
 * matching token added to shesha.tokens.json, this allowlist becomes STALE
 * and must be updated in the same change — the exact-match check below
 * fails loudly if a listed survivor no longer appears (path or value
 * changed) so the exemption can't quietly outlive its reason.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOCK_STYLES_DIR = join(HERE, '..', 'assets', 'block-styles');

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

// file -> [{ path, value, reason }]
// `path` is the dotted JSON path from the file root (matches this test's own
// walker below), `value` is the exact literal hex string still in place.
const ALLOWLIST = {
  'page-header-band.style.json': [
    {
      path: 'targets.pageHeaderBand.desktop.border.border.bottom.color',
      value: '#f0f0f0',
      reason: 'No colour in shesha.tokens.json (default brand) equals #f0f0f0. The '
        + 'nearest candidate, palette.lines.divider (#F0F2F5), is a genuinely '
        + 'different value, not a case/shorthand variant — using it would silently '
        + 'change the rendered colour. Proposed: add a divider-strength token for '
        + 'this exact grey, or confirm #f0f0f0 was meant to BE #F0F2F5 and fix the '
        + 'source design. See task-3-report.md.',
    },
    {
      path: 'targets.breadcrumbTrail.desktop.font.color',
      value: '#8c8c8c',
      reason: 'No colour in shesha.tokens.json equals #8c8c8c (closest inks are '
        + 'ink.muted #333333 and ink.soft #9BA3B8, both meaningfully lighter/darker). '
        + 'Known unmatched hex flagged in the Task 3 brief; propose a '
        + '"breadcrumbText" role once a designer confirms the intended shade. '
        + 'See task-3-report.md.',
    },
    {
      path: 'targets.titleText.desktop.font.color',
      value: '#262626',
      reason: 'No colour in shesha.tokens.json equals #262626 (ink.primary is '
        + '#181818, a darker near-black). Known unmatched hex flagged in the Task 3 '
        + 'brief; propose a dedicated "pageTitle" ink token once confirmed. '
        + 'See task-3-report.md.',
    },
    {
      path: 'targets.titleText.tablet.font.color',
      value: '#262626',
      reason: 'Same #262626 as the desktop breakpoint above — repeated per breakpoint, '
        + 'same finding. See task-3-report.md.',
    },
    {
      path: 'targets.titleText.mobile.font.color',
      value: '#262626',
      reason: 'Same #262626 as the desktop breakpoint above — repeated per breakpoint, '
        + 'same finding. See task-3-report.md.',
    },
  ],
};

function readJson(p) {
  let raw = readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
  return JSON.parse(raw);
}

/** Walk `targets` only — the actual style values, not $note/_note prose. */
function collectHexes(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => collectHexes(n, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === 'string' && HEX_RE.test(v)) {
        out.push({ path: p, value: v });
      } else {
        collectHexes(v, p, out);
      }
    }
  }
}

const files = readdirSync(BLOCK_STYLES_DIR).filter((f) => f.endsWith('.style.json')).sort();

test('block-styles overlays carry zero literal hexes outside the named allowlist', () => {
  assert.ok(files.length > 0, `no *.style.json files found in ${BLOCK_STYLES_DIR}`);

  const unexpected = [];
  for (const file of files) {
    const json = readJson(join(BLOCK_STYLES_DIR, file));
    const found = [];
    collectHexes(json.targets ?? {}, 'targets', found);

    const allowed = ALLOWLIST[file] ?? [];
    for (const hit of found) {
      const isAllowed = allowed.some((a) => a.path === hit.path && a.value === hit.value);
      if (!isAllowed) {
        unexpected.push(`${file}: ${hit.path} = ${hit.value}`);
      }
    }
  }

  assert.deepEqual(
    unexpected, [],
    `unexpected literal hex(es) in block-styles (replace with $role:<name> or `
    + `$palette.<section>.<key>, or add a named+reasoned allowlist entry): `
    + `${unexpected.join('; ')}`,
  );
});

test('the block-styles hex allowlist names only survivors that still actually exist', () => {
  // Guards against the allowlist quietly becoming a blanket exemption: if a
  // listed hex gets fixed (or removed) upstream, this fails until the entry
  // is deleted too, so the allowlist can never outlive its own reason.
  const stale = [];
  for (const [file, entries] of Object.entries(ALLOWLIST)) {
    const json = readJson(join(BLOCK_STYLES_DIR, file));
    const found = [];
    collectHexes(json.targets ?? {}, 'targets', found);
    for (const entry of entries) {
      const stillThere = found.some((h) => h.path === entry.path && h.value === entry.value);
      if (!stillThere) {
        stale.push(`${file}: allowlist entry ${entry.path} = ${entry.value} no longer found — remove it`);
      }
    }
  }
  assert.deepEqual(stale, []);
});
