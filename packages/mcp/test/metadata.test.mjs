// WP-13 row: metadata_entity's source vocabulary, proved with no backend configured.
//
// The tool's contract is one sentence: it never reports `source: "live"` over an empty
// properties[]. Everything below exists to make that sentence falsifiable, because the
// consumer of `source` is T3 - "none" leaves a binding uninspectable (partial, exit 3)
// while "live" or "cache" lets the check run, so a fabricated "live" is a clean pass over
// nothing at all.
//
// The tool reads .build/backend from the repo root it computes itself, so these cases
// drive `run()` with the env vars cleared and assert on what it does when the backend is
// unreachable: it must answer from the recorded snapshot and SAY so, or answer "none"
// with the reason - never an empty success.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, inputSchema, name } from '../src/tools/metadata_entity.mjs';

/**
 * The four env vars the transport reads, cleared for the duration of `fn`.
 * @param {Record<string,string|undefined>} over @param {() => any} fn
 */
async function withEnv(over, fn) {
  const keys = ['SHESHA_BACKEND', 'SHESHA_TOKEN', 'SHESHA_USER', 'SHESHA_PASSWORD'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('the tool still declares its name and schema', () => {
  assert.equal(name, 'metadata_entity');
  assert.equal(inputSchema.required.length, 1);
});

test('a recorded entity answers from the snapshot without touching a backend', async () => {
  await withEnv({ SHESHA_BACKEND: 'http://127.0.0.1:1' }, async () => {
    const out = await run({ entity: 'boxfusion.test.Domain.InventoryItems.InventoryItem' });
    assert.equal(out.source, 'cache', 'a snapshot exists for this entity, so no backend is needed');
    assert.ok(out.properties.length > 0);
  });
});

test('an unknown entity with no backend is "none" with a reason, never an empty success', async () => {
  await withEnv({ SHESHA_BACKEND: 'http://127.0.0.1:1', SHESHA_TOKEN: 'irrelevant' }, async () => {
    const out = await run({ entity: 'Not.Recorded.Anywhere', refresh: true });
    assert.equal(out.source, 'none');
    assert.equal(out.properties.length, 0);
    assert.ok(out.reason && out.reason.length > 0, 'source "none" must carry the reason it could not resolve');
    assert.match(out.reason, /did not complete|answered/);
  });
});

test('refresh against an unreachable backend falls back to the snapshot and says so', async () => {
  await withEnv({ SHESHA_BACKEND: 'http://127.0.0.1:1', SHESHA_TOKEN: 'irrelevant' }, async () => {
    const out = await run({ entity: 'boxfusion.test.Domain.InventoryItems.InventoryItem', refresh: true });
    assert.equal(out.source, 'cache', 'a stale answer is legitimate, silence about its staleness is not');
    assert.match(out.reason, /answered from the recorded snapshot/, 'the fallback must name itself, whichever half failed');
  });
});

test('source is never "live" with zero properties, on any input', async () => {
  // The invariant, asserted over every path this tool can take with no backend to reach:
  // recorded, unrecorded, refreshed, unrefreshed.
  await withEnv({ SHESHA_BACKEND: 'http://127.0.0.1:1' }, async () => {
    for (const entity of ['boxfusion.test.Domain.InventoryItems.InventoryItem', 'Not.Recorded.Anywhere']) {
      for (const refresh of [false, true]) {
        const out = await run({ entity, refresh });
        assert.ok(['live', 'cache', 'none'].includes(out.source), `unknown source "${out.source}"`);
        if (out.properties.length === 0) assert.notEqual(out.source, 'live', `${entity} refresh=${refresh} reported live over nothing`);
        if (out.source === 'none') assert.ok(out.reason, `${entity} refresh=${refresh} reported none with no reason`);
      }
    }
  });
});
