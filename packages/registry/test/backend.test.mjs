// WP-13: the live-backend transport, proved with no live backend.
//
// The module speaks HTTP to Shesha, so it is tested against a node:http stub on an
// ephemeral port - the same discipline t4-smoke's --selftest uses. What is being proved is
// not that fetch works but that every failure is REPORTED rather than flattened into an
// empty success: a 403, a non-JSON body, an unreachable host and an entity that resolves
// to zero properties must each come back as ok:false with a reason a human can act on,
// because T3 treats "no metadata" as uninspectable and would treat an empty success as a
// clean pass over nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  resolveBackend, resolveCredentials, call, authenticate, session, entityProperties, entityList, crudRouteFor,
} from '../src/backend.mjs';

/** A repo-shaped temp root with an optional .build/backend and .build/backend-auth. */
function mkRoot(/** @type {{backend?:string, auth?:any}} */ opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-'));
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  if (opts.backend !== undefined) fs.writeFileSync(path.join(root, '.build/backend'), opts.backend);
  if (opts.auth !== undefined) fs.writeFileSync(path.join(root, '.build/backend-auth'), typeof opts.auth === 'string' ? opts.auth : JSON.stringify(opts.auth));
  return root;
}

/**
 * Run `fn` with the four env vars this module reads cleared, then restore them.
 * @param {() => any} fn
 */
async function withCleanEnv(fn) {
  const keys = ['SHESHA_BACKEND', 'SHESHA_TOKEN', 'SHESHA_USER', 'SHESHA_PASSWORD'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try { return await fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

/**
 * A Shesha-shaped stub: ABP envelopes, a token endpoint, one entity with properties, and
 * deliberate potholes at /denied and /garbage.
 * @param {(url:string) => any} fn
 */
async function withStub(fn) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    /** @param {number} code @param {any} body */
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/TokenAuth/Authenticate') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        /** @type {any} */
        let j = {};
        try { j = JSON.parse(raw); } catch { /* an unparseable body is a bad credential */ }
        if (j.password === 'right') return send(200, { result: { accessToken: 'stub-token', expireInSeconds: 60 } });
        if (j.password === 'tokenless') return send(200, { result: { expireInSeconds: 60 } });
        return send(401, { error: { message: 'Invalid user name or password' } });
      });
      return;
    }
    if (url.pathname === '/api/services/app/Metadata/GetProperties') {
      const container = url.searchParams.get('container');
      if (container === 'Stub.Empty') return send(200, { result: [] });
      if (container === 'Stub.Missing') return send(404, { error: { message: `Type \`${container}\` not found` } });
      if (container === 'Stub.NoArray') return send(200, { result: { nope: true } });
      return send(200, {
        result: [
          { path: 'FirstName', dataType: 'string', required: true },
          { path: 'FullName', dataType: 'string', required: false, readonly: true },
          { path: 'Gender', dataType: 'reference-list-item', required: false, referenceListName: 'Gender', referenceListModule: 'Shesha' },
        ],
      });
    }
    if (url.pathname === '/api/dynamic/Shesha/Person/Crud/Get') {
      return url.searchParams.get('id') === 'known'
        ? send(200, { result: { id: 'known', firstName: 'Ada' } })
        : send(200, { result: null });
    }
    if (url.pathname === '/api/dynamic/Shesha/Person/Crud/GetAll') return send(200, { result: { items: [{ id: 'a' }, { id: 'b' }], totalCount: 2 } });
    if (url.pathname === '/denied') return send(403, { error: { message: 'permission denied' } });
    if (url.pathname === '/garbage') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); return; }
    return send(404, { error: { message: 'no route' } });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve(undefined)); });
  const { port } = /** @type {any} */ (server.address());
  try { return await fn(`http://127.0.0.1:${port}`); } finally { await new Promise((r) => server.close(r)); }
}

// ---- configuration is reported, never guessed ---------------------------------
test('resolveBackend: absent, malformed and well-formed', async () => {
  await withCleanEnv(() => {
    const none = resolveBackend(mkRoot());
    assert.equal(none.url, null);
    assert.match(none.reason, /SHESHA_BACKEND|\.build\/backend/);
    const bad = resolveBackend(mkRoot({ backend: 'localhost:21021' }));
    assert.equal(bad.url, null);
    assert.match(bad.reason, /http\(s\) URL/);
    assert.equal(resolveBackend(mkRoot({ backend: 'http://localhost:21021/' })).url, 'http://localhost:21021');
    process.env.SHESHA_BACKEND = 'http://from-env:80/';
    assert.equal(resolveBackend(mkRoot({ backend: 'http://from-file' })).url, 'http://from-env:80', 'the environment wins over the file');
  });
});

test('resolveCredentials: env token, env pair, file token, file pair, and nothing', async () => {
  await withCleanEnv(() => {
    assert.match(resolveCredentials(mkRoot()).reason, /no credentials/);
    assert.equal(resolveCredentials(mkRoot({ auth: { token: 'from-file' } })).token, 'from-file');
    const pair = resolveCredentials(mkRoot({ auth: { user: 'u', password: 'p' } }));
    assert.deepEqual([pair.user, pair.password], ['u', 'p']);
    assert.match(resolveCredentials(mkRoot({ auth: 'not json' })).reason, /not JSON/);
    assert.match(resolveCredentials(mkRoot({ auth: { nothing: true } })).reason, /neither a token nor a user\/password/);
    process.env.SHESHA_TOKEN = 'from-env';
    assert.equal(resolveCredentials(mkRoot({ auth: { token: 'from-file' } })).token, 'from-env');
  });
});

// ---- every transport failure is a reason, not an empty result -----------------
test('call: 200, 403, non-JSON and an unreachable host each report themselves', async () => {
  await withStub(async (url) => {
    const ok = await call({ url, route: '/api/dynamic/Shesha/Person/Crud/GetAll' });
    assert.equal(ok.ok, true);
    const denied = await call({ url, route: '/denied' });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.match(denied.reason, /403.*permission denied/);
    const garbage = await call({ url, route: '/garbage' });
    assert.equal(garbage.ok, false);
    assert.match(garbage.reason, /non-JSON/);
  });
  // Port 1 is reserved and refuses; the failure must be a reason, not a throw.
  const dead = await call({ url: 'http://127.0.0.1:1', route: '/whatever' });
  assert.equal(dead.ok, false);
  assert.equal(dead.status, 0);
  assert.match(dead.reason, /did not complete/);
});

test('authenticate: a token, a refusal, and a 200 carrying no token', async () => {
  await withStub(async (url) => {
    const good = await authenticate({ url, user: 'admin', password: 'right' });
    assert.deepEqual([good.ok, good.token], [true, 'stub-token']);
    const bad = await authenticate({ url, user: 'admin', password: 'wrong' });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /401/);
    const tokenless = await authenticate({ url, user: 'admin', password: 'tokenless' });
    assert.equal(tokenless.ok, false);
    assert.match(tokenless.reason, /no accessToken/);
  });
});

test('session: composes url and token, and reports which half is missing', async () => {
  await withCleanEnv(async () => {
    await withStub(async (url) => {
      const ok = await session(mkRoot({ backend: url, auth: { user: 'admin', password: 'right' } }));
      assert.deepEqual([ok.ok, ok.token], [true, 'stub-token']);
      const noCred = await session(mkRoot({ backend: url }));
      assert.equal(noCred.ok, false);
      assert.match(noCred.reason, /no credentials/);
      const noUrl = await session(mkRoot({ auth: { token: 't' } }));
      assert.equal(noUrl.ok, false);
      assert.match(noUrl.reason, /no backend configured/);
      const wrongPw = await session(mkRoot({ backend: url, auth: { user: 'admin', password: 'wrong' } }));
      assert.equal(wrongPw.ok, false);
      assert.match(wrongPw.reason, /401/);
    });
  });
});

// ---- the rule that matters: zero properties is never a success ----------------
test('entityProperties: an entity resolving to 0 properties is a failure, not an empty pass', async () => {
  await withStub(async (url) => {
    const good = await entityProperties({ url, token: 't', entityType: 'Stub.Person' });
    assert.equal(good.ok, true);
    assert.equal(good.properties.length, 3);
    assert.deepEqual(good.properties[0], { path: 'FirstName', dataType: 'string', required: true });
    assert.ok(good.properties[1] && good.properties[2], 'three properties came back');
    assert.equal((good.properties[1] || {}).readonly, true, 'readonly survives the mapping');
    assert.equal((good.properties[2] || {}).referenceListName, 'Gender');

    const empty = await entityProperties({ url, token: 't', entityType: 'Stub.Empty' });
    assert.equal(empty.ok, false, 'a zero-property entity must not be a successful read');
    assert.match(empty.reason, /0 properties/);

    const missing = await entityProperties({ url, token: 't', entityType: 'Stub.Missing' });
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /404/);

    const noArray = await entityProperties({ url, token: 't', entityType: 'Stub.NoArray' });
    assert.equal(noArray.ok, false);
    assert.match(noArray.reason, /no result array/);
  });
});

test('entityRecord and entityList: a null result is a reason, not a record', async () => {
  const { entityRecord } = await import('../src/backend.mjs');
  await withStub(async (url) => {
    const known = await entityRecord({ url, token: 't', module: 'Shesha', entity: 'Person', id: 'known' });
    assert.equal(known.ok, true);
    assert.equal(known.record.firstName, 'Ada');
    const unknown = await entityRecord({ url, token: 't', module: 'Shesha', entity: 'Person', id: 'ghost' });
    assert.equal(unknown.ok, false, 'result:null is not a record');
    assert.match(unknown.reason, /no record/);
    const list = await entityList({ url, token: 't', module: 'Shesha', entity: 'Person' });
    assert.deepEqual([list.ok, list.totalCount, list.items.length], [true, 2, 2]);
    assert.equal((list.items[0] || {}).id, 'a');
  });
});

test('crudRouteFor derives the Shesha.Domain case and refuses to guess otherwise', () => {
  assert.deepEqual(crudRouteFor('Shesha.Domain.Person'), { module: 'Shesha', entity: 'Person' });
  assert.equal(crudRouteFor('boxfusion.test.Domain.Test.Thing'), null);
  assert.equal(crudRouteFor('Person'), null);
});
