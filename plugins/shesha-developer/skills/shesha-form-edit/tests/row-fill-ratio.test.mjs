import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(join(ROOT, 'scripts/render-instrument.js'), 'utf8');

/**
 * The row fill-ratio metric in `render-instrument.js`.
 *
 * `rowsThatStacked` catches a flex row that failed to split. It does NOT catch a
 * row that split and then left most of the track empty — which is exactly what a
 * child at `dimensions.width:"auto"` produces: flex-basis resolves to content
 * size and flex-grow is 0, so each child hugs its own label. Two fields render as
 * two narrow stubs sitting side by side, and every other check passes. This ratio
 * is the only signal that sees it.
 *
 * The metric lives inside a `page.evaluate` browser closure, so it cannot be
 * imported. The formula is MIRRORED here (the same duplicate-with-a-comment
 * pattern tier2.mjs uses for INTERACTIVE_TYPES), and the last test asserts the
 * threshold constant still matches the source so the two cannot silently drift.
 */
function fillRatio({ trackWidth, pad = 0, gap = 0, childWidths }) {
  const track = Math.max(1, trackWidth - pad);
  const gaps = (childWidths.length - 1) * gap;
  return Math.round(((childWidths.reduce((s, w) => s + w, 0) + gaps) / track) * 100) / 100;
}

const THRESHOLD = 0.8;

test('fill ratio: an even split fills the track', () => {
  assert.equal(fillRatio({ trackWidth: 1000, gap: 24, childWidths: [488, 488] }), 1);
});

test('fill ratio: a 66/33 split fills the track', () => {
  assert.equal(fillRatio({ trackWidth: 1000, gap: 24, childWidths: [646, 330] }), 1);
});

test('fill ratio: a filling main column beside a fixed rail fills the track', () => {
  assert.equal(fillRatio({ trackWidth: 1000, gap: 16, childWidths: [652, 332] }), 1);
});

test('fill ratio: the width:auto defect reads far below threshold', () => {
  // Content-sized children: two labels' worth of width in a 1000px track.
  const fill = fillRatio({ trackWidth: 1000, gap: 24, childWidths: [120, 140] });
  assert.ok(fill < THRESHOLD, `content-sized children must fail the gate, got ${fill}`);
  assert.equal(fill, 0.28);
});

test('fill ratio: every legitimate layout clears the threshold with headroom', () => {
  const legitimate = [
    { trackWidth: 1000, gap: 24, childWidths: [488, 488] },
    { trackWidth: 1000, gap: 24, childWidths: [646, 330] },
    { trackWidth: 1000, gap: 16, childWidths: [652, 332] },
    { trackWidth: 1440, pad: 48, gap: 24, childWidths: [900, 468] },
  ];
  for (const c of legitimate) {
    const fill = fillRatio(c);
    assert.ok(fill >= THRESHOLD, `${JSON.stringify(c)} → ${fill} must not trip the gate`);
  }
});

test('fill ratio: padding is excluded from the track, not counted as unfilled', () => {
  // A row with 48px of horizontal padding and children filling the remainder
  // must read as full — otherwise every padded container would false-fail.
  assert.equal(fillRatio({ trackWidth: 1000, pad: 48, gap: 0, childWidths: [952] }), 1);
});

test('fill ratio: the source still uses the threshold this test pins', () => {
  assert.match(SRC, /r\.fill < 0\.8/, 'threshold drifted from the mirrored formula in this test');
  assert.match(SRC, /rowsUnderFilled/, 'the metric must still be reported');
  assert.match(SRC, /fillExpected/, 'the legitimate-non-fill exemption must still be applied');
});

test('fill ratio: only default-packed rows of non-button children are graded', () => {
  // Guards the exemption itself: an action row, or a centred / end-packed /
  // space-between row, is legitimately short of the track and must be exempt or
  // the metric is pure noise on real forms.
  assert.match(SRC, /justifyContent/, 'justifyContent must gate the check');
  assert.match(SRC, /flex-start|normal|start/, 'only start-packed rows are expected to fill');
  assert.match(SRC, /querySelector\('button'\)|button/i, 'button-bearing children must be exempt');
});
