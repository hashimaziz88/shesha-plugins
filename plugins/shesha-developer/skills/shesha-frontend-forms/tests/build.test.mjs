/**
 * Supervisor tests.
 *
 * The load-bearing behaviour is the BARRIER: offline gates for every screen complete before any
 * push happens, so a broken screen four cannot leave screens one to three deployed. That is a
 * property of the ORDERING, which means it has to be tested as ordering — summariseBuild refusing
 * to report a pushable outcome while any screen has failed offline.
 *
 * The manifest loader is tested hard because it is the last point at which a bad build is free to
 * abort. Everything after it costs a backend write.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BUILD_EXIT, loadManifest, summariseBuild } from '../scripts/lib/build.mjs';

function withManifest(doc, { specs = ['a.spec.jsx'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shesha-build-'));
  for (const s of specs) writeFileSync(join(dir, s), '// spec\n', 'utf8');
  const p = join(dir, 'manifest.json');
  writeFileSync(p, JSON.stringify(doc), 'utf8');
  return { dir, path: p };
}

describe('manifest loading', () => {
  it('accepts a screens array and resolves specs relative to the MANIFEST', () => {
    const { dir, path } = withManifest({
      screens: [{ module: 'm', name: 'n', spec: 'a.spec.jsx' }],
    });
    const m = loadManifest(path);
    assert.equal(m.screens.length, 1);
    assert.equal(m.screens[0].form, 'm/n');
    // Relative to the manifest, not the cwd: a manifest should travel with its specs.
    assert.equal(m.screens[0].specPath, join(dir, 'a.spec.jsx'));
    assert.equal(m.theme, 'shesha');
  });

  it('accepts a bare array as the whole manifest', () => {
    const { path } = withManifest([{ module: 'm', name: 'n', spec: 'a.spec.jsx' }]);
    assert.equal(loadManifest(path).screens.length, 1);
  });

  it('refuses a missing file, bad JSON, and an empty manifest', () => {
    assert.throws(() => loadManifest(join(tmpdir(), 'definitely-not-here.json')), /no manifest at/);

    const bad = withManifest({});
    writeFileSync(bad.path, '{ not json', 'utf8');
    assert.throws(() => loadManifest(bad.path), /not valid JSON/);

    const empty = withManifest({ screens: [] });
    assert.throws(() => loadManifest(empty.path), /no `screens` array/);
  });

  it('reports EVERY problem at once, not just the first', () => {
    const { path } = withManifest({
      screens: [{ module: 'm' }, { module: 'm', name: 'n', spec: 'nope.spec.jsx' }],
    });
    try {
      loadManifest(path);
      assert.fail('expected the manifest to be rejected');
    } catch (e) {
      assert.equal(e.exitCode, BUILD_EXIT.MANIFEST_INVALID);
      // screens[0] is missing name and spec; screens[1]'s spec does not exist. All three named.
      assert.match(e.message, /screens\[0\]\.name is required/);
      assert.match(e.message, /screens\[0\]\.spec is required/);
      assert.match(e.message, /screens\[1\]\.spec does not exist/);
    }
  });

  it('refuses two screens that target one form', () => {
    const { path } = withManifest({
      screens: [
        { module: 'm', name: 'n', spec: 'a.spec.jsx' },
        { module: 'm', name: 'n', spec: 'a.spec.jsx' },
      ],
    });
    assert.throws(() => loadManifest(path), /repeats m\/n/);
  });
});

describe('the barrier', () => {
  const clean = { ok: true, pushed: true, rendered: true };

  it('reports offline failure and NEVER a pushable outcome when any screen failed its gates', () => {
    const s = summariseBuild([clean, { ok: false, failures: [{ message: 'boom' }] }, clean], { pushed: true });
    assert.equal(s.ok, false);
    assert.equal(s.phase, 'offline');
    assert.equal(s.exitCode, BUILD_EXIT.OFFLINE_GATES);
    assert.match(s.why, /nothing was pushed/);
    // The counts must not imply anything was deployed.
    assert.equal(s.counts.pushed, undefined);
  });

  it('a clean --offline run is a success that says it stopped early', () => {
    const s = summariseBuild([clean, clean], { pushed: false });
    assert.equal(s.ok, true);
    assert.equal(s.exitCode, BUILD_EXIT.OK);
    assert.match(s.why, /stopped before the backend/);
  });

  it('surfaces the worst outcome once pushing has started', () => {
    const pushFailed = summariseBuild([clean, { ok: true, pushed: false }], { pushed: true });
    assert.equal(pushFailed.exitCode, BUILD_EXIT.PUSH_FAILED);
    assert.equal(pushFailed.counts.pushFailed, 1);

    const renderFailed = summariseBuild([clean, { ok: true, pushed: true, rendered: false }], { pushed: true });
    assert.equal(renderFailed.exitCode, BUILD_EXIT.RENDER_FAILED);
    assert.equal(renderFailed.counts.renderFailed, 1);

    // A push failure outranks a render failure: an unverified write is worse than an
    // unmeasurable one, because the backend state is unknown rather than merely unproven.
    const both = summariseBuild([{ ok: true, pushed: false }, { ok: true, pushed: true, rendered: false }], { pushed: true });
    assert.equal(both.exitCode, BUILD_EXIT.PUSH_FAILED);
  });

  it('calls a fully clean fleet complete', () => {
    const s = summariseBuild([clean, clean, clean], { pushed: true });
    assert.equal(s.ok, true);
    assert.equal(s.phase, 'complete');
    assert.deepEqual(s.counts, { total: 3, pushed: 3, rendered: 3, pushFailed: 0, renderFailed: 0 });
  });
});
