// resolve-bindings.js — the L4 binding gate's CONTRACT when there is no live
// backend. Every test drives the real CLI by spawning it; NOTHING here contacts a
// Shesha backend, and no stub server is started either — the two infra branches are
// reached by a refused connect (port 1) and by a credential-less non-localhost
// origin, which GymApi rejects before any packet leaves the process.
//
// What is pinned:
//   exit 2  usage, or an infrastructure failure — ONE actionable line, no stack
//   exit 3  cannot evaluate (`--offline` with no metadata) — never a silent pass
//   exit 1  a finding against the cached metadata
//   exit 0  clean against cached metadata, with the cache named as the source
//
// The live-backend paths (real Metadata/GetProperties, the reflist
// configuration-item route, endpoint 404s) are NOT exercised here — they need a
// backend, which these tests deliberately never have.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'resolve-bindings.js');

/** A scratch dir OUTSIDE the repo — tests/fixtures is owned by the fixture corpus. */
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-bindings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const write = (dir, name, obj) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
};

/** cwd = the scratch dir so no repo `access-token` is ever picked up. */
function run(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, SHESHA_TOKEN_FILE: '', SHESHA_USER: '', SHESHA_PASSWORD: '' },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const NO_STACK = (out) => {
  assert.doesNotMatch(out, /at Module/, 'an expected environmental failure must not print a stack frame');
  assert.doesNotMatch(out, /node:internal/, 'an expected environmental failure must not print Node internals');
  assert.doesNotMatch(out, /^\s+at /m, 'an expected environmental failure must not print a stack trace');
};

// A form bound to Person: one flat property, one dotted navigation path.
const FORM = {
  formSettings: { modelType: { name: 'Person', module: 'Shesha' } },
  components: [
    { id: 'aaaaaaaaaaaa', type: 'textField', propertyName: 'firstName', componentName: 'First name' },
    { id: 'bbbbbbbbbbbb', type: 'textField', propertyName: 'organisation.name', componentName: 'Org name' },
  ],
};

// backend-probe.mjs summary shape — both entities present, so the dotted path resolves.
const META = {
  baseUrl: 'http://localhost:21021',
  entities: [
    {
      name: 'Person',
      fullClassName: 'Shesha.Domain.Person',
      properties: [
        { path: 'firstName', dataType: 'string' },
        { path: 'organisation', dataType: 'entity', entityType: 'Shesha.Domain.Organisation' },
      ],
      reflistProps: [],
    },
    {
      name: 'Organisation',
      fullClassName: 'Shesha.Domain.Organisation',
      properties: [{ path: 'name', dataType: 'string' }],
      reflistProps: [],
    },
  ],
};

// ---------------------------------------------------------------- exit 2 (infra)

test('an unreachable backend exits 2 with ONE actionable line and no stack trace', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  // port 1 is never listening: connect() is refused before any request is made
  const { code, out } = run(dir, [form, '--backend', 'http://127.0.0.1:1']);

  assert.equal(code, 2, `expected exit 2 (infra), got ${code}\n${out}`);
  NO_STACK(out);
  const infra = out.split('\n').filter((l) => l.startsWith('INFRA'));
  assert.equal(infra.length, 1, `expected exactly one INFRA line, got ${infra.length}\n${out}`);
  assert.match(infra[0], /http:\/\/127\.0\.0\.1:1/, 'the message must name the backend URL it could not reach');
  assert.match(infra[0], /not reachable/);
  assert.match(infra[0], /entity-metadata\.json|backend-probe/, 'the message must say how to proceed offline');
  assert.doesNotMatch(out, /Node\.js v/, 'a raw Node crash footer means the rejection was never handled');
});

test('a backend that cannot be authenticated against exits 2 naming the credential levers', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  // A non-localhost origin with no cached token and no credentials: GymApi refuses
  // before any request leaves the process, so this reaches the credentials branch
  // without a single packet — and certainly without a backend.
  const url = 'http://shesha.invalid';

  const { code, out } = run(dir, [form, '--backend', url]);
  assert.equal(code, 2, `expected exit 2 (infra), got ${code}\n${out}`);
  NO_STACK(out);
  assert.match(out, /INFRA/);
  assert.match(out, new RegExp(url.replace(/[.]/g, '\\.')), 'the message must name the backend URL');
  assert.match(out, /SHESHA_USER/, 'a credentials failure must name SHESHA_USER');
  assert.match(out, /SHESHA_PASSWORD/, 'a credentials failure must name SHESHA_PASSWORD');
  assert.match(out, /--token-file/, 'a credentials failure must name --token-file');
});

test('no form argument is a usage error (exit 2)', (t) => {
  const dir = scratch(t);
  const { code, out } = run(dir, []);
  assert.equal(code, 2);
  assert.match(out, /^usage: node resolve-bindings\.js/m);
  assert.match(out, /\[entity-metadata\.json\]/, 'usage must advertise the cached-metadata positional');
  assert.match(out, /--offline/, 'usage must advertise --offline');
});

// -------------------------------------------------------- exit 3 (cannot verify)

test('--offline with no metadata exits 3 with BINDINGS UNVERIFIED — never 0', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  const { code, out } = run(dir, [form, '--offline']);

  assert.equal(code, 3, `--offline with nothing to verify against must exit 3, got ${code}\n${out}`);
  assert.notEqual(code, 0, 'exit 0 here would let an unverified entity-bound form look gate-passed');
  assert.match(out, /BINDINGS UNVERIFIED/, 'the run must say plainly that it did not verify');
  assert.match(out, /2 bound propertyName\(s\)/, 'it must name how many bindings are unknown');
  assert.match(out, /modelType/, 'it must name the unresolved modelType');
  assert.match(out, /--backend/, 'it must say how to resolve: run against a backend');
  assert.match(out, /backend-probe/, 'it must say how to resolve: supply a cached dump');
  NO_STACK(out);
});

test('a cached dump that cannot answer a dotted path reports it UNVERIFIED, not clean', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  // Person only — the navigation target Organisation is absent from the snapshot.
  const meta = write(dir, 'person.probe.json', META.entities[0]);
  const { code, out } = run(dir, [form, meta]);

  assert.equal(code, 3, `an unanswerable segment must not pass, got ${code}\n${out}`);
  assert.match(out, /UNVERIFIED\s+\[R-034\].*Organisation.*not in the cache/);
  assert.match(out, /BINDINGS UNVERIFIED/);
});

// ------------------------------------------------------------ exit 0 / exit 1

test('cached metadata with all bindings valid exits 0 and names the cache as its source', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  const meta = write(dir, 'probe.json', META);
  const { code, out } = run(dir, [form, meta]);

  assert.equal(code, 0, `expected a clean cached run, got ${code}\n${out}`);
  assert.match(out, /source CACHE/, 'the output must state the source was a cache');
  assert.match(out, new RegExp(path.basename(meta)), 'the output must name the cache file');
  assert.match(out, /mtime \d{4}-\d{2}-\d{2}T/, 'the output must state the cache mtime');
  assert.match(out, /age \d/, 'the output must state the cache age');
  assert.match(out, /SNAPSHOT/, 'a cached pass must not read as live confidence');
  assert.doesNotMatch(out, /^FAIL/m);
  assert.doesNotMatch(out, /BINDINGS UNVERIFIED/);
});

test('--metadata <path> is accepted as an alias for the positional dump', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  const meta = write(dir, 'probe.json', META);
  const { code, out } = run(dir, [form, '--metadata', meta]);
  assert.equal(code, 0, out);
  assert.match(out, /source CACHE/);
});

test('cached metadata with a bad propertyName exits 1 with a finding naming that property', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', {
    formSettings: { modelType: { name: 'Person', module: 'Shesha' } },
    components: [{ id: 'cccccccccccc', type: 'textField', propertyName: 'surnameTypo', componentName: 'Surname' }],
  });
  const meta = write(dir, 'probe.json', META);
  const { code, out } = run(dir, [form, meta]);

  assert.equal(code, 1, `a bad binding must exit 1, got ${code}\n${out}`);
  assert.match(out, /^FAIL\s+\[R-034\].*surnameTypo.*does not exist on Shesha\.Domain\.Person/m);
  assert.match(out, /source CACHE/, 'even a failing cached run must state that the source was a cache');
});

test('a reference list the cached probe says is empty is a finding, not a pass', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', {
    formSettings: { modelType: { name: 'Person', module: 'Shesha' } },
    components: [{
      id: 'dddddddddddd', type: 'dropdown', propertyName: 'status', componentName: 'Status',
      dataSourceType: 'referenceList', referenceListId: { module: 'Shesha', name: 'PersonStatus' },
    }],
  });
  const meta = write(dir, 'probe.json', {
    name: 'Person',
    fullClassName: 'Shesha.Domain.Person',
    properties: [{ path: 'status', dataType: 'refList', referenceListName: 'Shesha.PersonStatus', referenceListModule: 'Shesha' }],
    reflistProps: [{ prop: 'status', name: 'Shesha.PersonStatus', module: 'Shesha', exists: true, itemCount: 0 }],
  });
  const { code, out } = run(dir, [form, meta]);

  assert.equal(code, 1, out);
  assert.match(out, /FAIL\s+\[R-015\].*PersonStatus.*0 items/);
});

test('an unreadable / shapeless cached dump is an infra error (exit 2), never a pass', (t) => {
  const dir = scratch(t);
  const form = write(dir, 'form.json', FORM);
  const meta = write(dir, 'probe.json', {});
  const { code, out } = run(dir, [form, meta]);
  assert.equal(code, 2, out);
  assert.match(out, /INFRA.*carries no property array/);
  NO_STACK(out);
});

test('the script header documents the exit-code table', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const header = src.slice(0, src.indexOf("import fs"));
  for (const code of ['0', '1', '2', '3']) {
    assert.match(header, new RegExp(`^//\\s+${code}\\s`, 'm'), `exit ${code} must be documented in the header`);
  }
  assert.match(header, /BINDINGS UNVERIFIED/);
});
