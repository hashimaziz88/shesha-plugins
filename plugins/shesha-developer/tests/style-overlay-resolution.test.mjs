import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: every `$styleOverlay` a block declares must resolve to a real file.
 *
 * Phase 5 task 2 found `page-header-band.block.json` declaring
 * `"$styleOverlay": "page-header-band"` while the overlay file itself sat in a
 * stray top-level `plugins/shesha-design-system/assets/block-styles/` directory
 * that no skill ever reads — not a plugin (no .claude-plugin/plugin.json), not
 * wired into any script. `validate-blocks.js` never caught this because it
 * doesn't check `$styleOverlay` at all (see its own doc comment: it checks
 * skeleton JSON, `$validatedAgainst` matrix rows, and structural/hex smells —
 * nothing about the overlay pairing). The original audit misread the symptom
 * as a *missing* asset; it was actually *misfiled*, and only reading both
 * directories side by side surfaced that. This test closes the gap directly:
 * every block's overlay name must resolve inside the real
 * shesha-design-system/assets/block-styles/ directory, so a re-misfiled or
 * renamed overlay fails fast instead of silently no-op'ing at compile time.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, '..', 'skills'); // tests/ -> shesha-developer -> skills
const BLOCKS_DIR = join(SKILLS_DIR, 'shesha-form-edit', 'assets', 'blocks');
const BLOCK_STYLES_DIR = join(SKILLS_DIR, 'shesha-design-system', 'assets', 'block-styles');

function readJson(p) {
  let raw = readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
  return JSON.parse(raw);
}

test('every $styleOverlay declared under assets/blocks resolves to a real block-styles file', () => {
  const blockFiles = readdirSync(BLOCKS_DIR).filter((f) => f.endsWith('.block.json'));
  assert.ok(blockFiles.length > 0, `no *.block.json files found in ${BLOCKS_DIR}`);

  const unresolved = [];
  for (const file of blockFiles) {
    const path = join(BLOCKS_DIR, file);
    const block = readJson(path);
    const overlay = block.$styleOverlay;
    if (overlay === undefined) continue; // not every block need declare one
    const overlayPath = join(BLOCK_STYLES_DIR, `${overlay}.style.json`);
    if (!existsSync(overlayPath)) {
      unresolved.push(`${file}: $styleOverlay "${overlay}" -> ${overlayPath} does not exist`);
    }
  }

  assert.deepEqual(
    unresolved, [],
    `these blocks declare a $styleOverlay that does not resolve to a file in `
    + `${BLOCK_STYLES_DIR}: ${unresolved.join('; ')}`,
  );
});

test('every *.style.json in block-styles is named after the $overlay it declares', () => {
  const styleFiles = readdirSync(BLOCK_STYLES_DIR).filter((f) => f.endsWith('.style.json'));
  assert.ok(styleFiles.length > 0, `no *.style.json files found in ${BLOCK_STYLES_DIR}`);

  const mismatches = [];
  for (const file of styleFiles) {
    const stem = file.replace(/\.style\.json$/, '');
    const overlay = readJson(join(BLOCK_STYLES_DIR, file)).$overlay;
    if (overlay !== stem) {
      mismatches.push(`${file}: $overlay is "${overlay}", expected "${stem}"`);
    }
  }

  assert.deepEqual(mismatches, [], `overlay/filename mismatch: ${mismatches.join('; ')}`);
});
