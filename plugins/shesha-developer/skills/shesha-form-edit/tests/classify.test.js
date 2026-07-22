import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, expectTokensFor } from '../scripts/gym-lib/classify.js';

const snap = (over = {}) => ({
  rect: { x: 0, y: 0, w: 400, h: 32 },
  childCount: 5,
  wrapperStyle: { display: 'block' },
  style: { color: 'rgb(0, 0, 0)', fontSize: '14px' },
  controlStyle: { color: 'rgb(0, 0, 0)' },
  measuredTag: 'input',
  text: 'gym textField :',
  attrs: { type: 'text' },
  ...over,
});

test('identical snapshots → no-op', () => {
  assert.equal(classify(snap(), snap()).effect, 'no-op');
});

test('missing variant wrapper → breaks-render', () => {
  assert.equal(classify(snap(), undefined).effect, 'breaks-render');
});

test('missing baseline → unknown', () => {
  assert.equal(classify(undefined, snap()).effect, 'unknown');
});

test('rect delta beyond epsilon → changes-geometry', () => {
  const v = snap({ rect: { x: 0, y: 100, w: 400, h: 48 } });
  assert.equal(classify(snap(), v).effect, 'changes-geometry');
});

test('rect x/y shift alone is ignored (position differs per wrapper)', () => {
  const v = snap({ rect: { x: 10, y: 999, w: 400, h: 32 } });
  assert.equal(classify(snap(), v).effect, 'no-op');
});

test('style prop delta → changes-style with cssDelta', () => {
  const v = snap({ style: { color: 'rgb(255, 0, 170)', fontSize: '14px' } });
  const res = classify(snap(), v, { expectTokens: expectTokensFor('#ff00aa') });
  assert.equal(res.effect, 'changes-style');
  assert.ok(res.cssDelta.color);
  assert.match(res.notes, /expected value observed/);
});

test('hex vs rgb color normalization suppresses false delta', () => {
  const b = snap({ style: { color: '#000000' } });
  const v = snap({ style: { color: 'rgb(0, 0, 0)' } });
  assert.equal(classify(b, v).effect, 'no-op');
});

test('subtree removed (hidden=true) → changes-geometry, not breaks-render', () => {
  const v = snap({ childCount: 0, rect: { x: 0, y: 0, w: 400, h: 0 } });
  const res = classify(snap(), v);
  assert.equal(res.effect, 'changes-geometry');
  assert.match(res.notes, /subtree removed/);
});

test('text-only difference → renders', () => {
  const v = snap({ text: 'GYM-TXT-label :' });
  assert.equal(classify(snap(), v).effect, 'renders');
});

test('geometry outranks style', () => {
  const v = snap({ rect: { x: 0, y: 0, w: 100, h: 32 }, style: { color: 'rgb(1, 2, 3)', fontSize: '14px' } });
  const res = classify(snap(), v);
  assert.equal(res.effect, 'changes-geometry');
  assert.ok(res.cssDelta);
});
