import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, flagContainerArtifacts, expectTokensFor } from '../scripts/gym-lib/classify.js';

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

// ---------------------------------------------------------------- container artifacts
// classify() sees one variant at a time, so it cannot tell a per-setting effect from a
// difference in how the component's own container rendered. flagContainerArtifacts is the
// post-pass that catches it. Every case below asserts BOTH that the artifact is demoted and
// that distinct, genuine findings survive.

test('a cluster of identical deltas across unrelated settings becomes unknown', () => {
  // The real barChart shape: one `display: block → flex` recorded for every setting.
  const shared = { display: { baseline: 'block', variant: 'flex' } };
  const settings = {};
  for (const k of ['aggregationMethod=min', 'orderDirection=asc', 'strokeWidth=17', 'showLegend=true', 'showTitle=true']) {
    settings[k] = { effect: 'changes-geometry', cssDelta: shared };
  }
  const flagged = flagContainerArtifacts(settings);

  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].keys.length, 5);
  assert.equal(flagged[0].was, 'changes-geometry');
  for (const k of Object.keys(settings)) {
    assert.equal(settings[k].effect, 'unknown', `${k} should be unknown`);
    assert.equal(settings[k].attribution, 'container-level');
    assert.equal(settings[k].attributedEffect, 'changes-geometry', 'the measured verdict must be preserved');
    assert.match(settings[k].notes, /not attributable to this setting/);
  }
});

test('settings with distinct deltas are untouched', () => {
  const shared = { display: { baseline: 'block', variant: 'flex' } };
  const settings = {
    'a=1': { effect: 'changes-geometry', cssDelta: shared },
    'b=1': { effect: 'changes-geometry', cssDelta: shared },
    'c=1': { effect: 'changes-geometry', cssDelta: shared },
    'd=1': { effect: 'changes-geometry', cssDelta: shared },
    'e=1': { effect: 'changes-geometry', cssDelta: shared },
    // genuine, distinct findings
    'desktop.dimensions.height=117px': { effect: 'changes-geometry', cssDelta: { height: { baseline: '40px', variant: '117px' } } },
    'desktop.background=color#ff00aa': { effect: 'changes-style', cssDelta: { backgroundColor: { baseline: 'rgba(0,0,0,0)', variant: 'rgb(255,0,170)' } } },
  };
  flagContainerArtifacts(settings);

  assert.equal(settings['desktop.dimensions.height=117px'].effect, 'changes-geometry');
  assert.equal(settings['desktop.background=color#ff00aa'].effect, 'changes-style');
  assert.equal(settings['desktop.dimensions.height=117px'].attribution, undefined);
});

test('a cluster below the threshold is left alone — two settings can legitimately agree', () => {
  const shared = { display: { baseline: 'block', variant: 'flex' } };
  const settings = {
    'a=1': { effect: 'changes-geometry', cssDelta: shared },
    'b=1': { effect: 'changes-geometry', cssDelta: shared },
  };
  assert.equal(flagContainerArtifacts(settings).length, 0);
  assert.equal(settings['a=1'].effect, 'changes-geometry');
});

test('no-op and not-measured rows are never reclassified', () => {
  const settings = {
    'a=1': { effect: 'no-op' },
    'b=1': { effect: 'not-measured', notes: 'capped' },
    'c=1': { effect: 'unknown' },
  };
  assert.equal(flagContainerArtifacts(settings).length, 0);
  assert.equal(settings['a=1'].effect, 'no-op');
  assert.equal(settings['b=1'].effect, 'not-measured');
});

test('rows with no recorded delta cannot form a cluster', () => {
  // Without cssDelta there is no evidence to compare, so nothing is attributable either way.
  const settings = {};
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) settings[`${k}=1`] = { effect: 'changes-geometry' };
  assert.equal(flagContainerArtifacts(settings).length, 0);
});
