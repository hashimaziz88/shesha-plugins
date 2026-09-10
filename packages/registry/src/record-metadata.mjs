// Record an entity-metadata snapshot from the live backend (WP-13).
//
// The snapshot is the substrate T3's backend checks read, and until now every one of them
// was hand-written: packages/sfs/test/fixtures/metadata/*.metadata.json carried the note
// "the offline stand-in for the Get endpoint's result.properties[]". Hand-written ground
// truth is the thing this repository exists to eliminate, so the file is now produced by
// this program from the running backend, in the same shape, and `backend` records the URL
// it came from instead of the word "snapshot".
//
// It writes nothing on failure. A snapshot recorded from a backend that answered 403, or
// that resolved an entity to zero properties, would make T3 assert against fiction - so
// the exit is 1 with the reason on stderr and no file is touched.
//
// usage:
//   node packages/registry/src/record-metadata.mjs --screen <name> --entity <Type> [--entity <Type>...]
//                                                  [--out <path>] [--reflist <module>/<name>] [--json]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { session, entityProperties } from './backend.mjs';

const EXIT = { pass: 0, fail: 1, usage: 2 };

/** @param {string[]} args @param {string} flag @returns {string[]} every value given for a repeatable flag */
function allValues(args, flag) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === flag && args[i + 1]) out.push(/** @type {string} */ (args[i + 1]));
  return out;
}

/** @param {string[]} args @param {string} flag @returns {string|undefined} */
function value(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * The snapshot document. Shape-compatible with the recorded fixtures by construction:
 * entities keyed by model type, each with properties[] of {path, dataType, required}.
 * @param {{backend:string, entities:Record<string, {properties:any[]}>, registryRef:string}} a
 * @returns {any}
 */
export function snapshotDocument(a) {
  return {
    _comment: 'Entity-metadata snapshot recorded from a live backend by packages/registry/src/record-metadata.mjs. PascalCase paths as the backend spells them; the compiler emits the camelCased binding. Never edit by hand - re-record it.',
    recordedAt: new Date().toISOString().slice(0, 10),
    backend: a.backend,
    registryRef: a.registryRef,
    entities: a.entities,
    referenceLists: {},
    forms: {},
  };
}

/**
 * @param {{root:string, screen:string, entities:string[], out?:string}} a
 * @returns {Promise<{ok:boolean, wrote:string|null, entities:number, properties:number, reason:string}>}
 */
export async function record(a) {
  const s = await session(a.root);
  if (!s.ok || !s.url) return { ok: false, wrote: null, entities: 0, properties: 0, reason: s.reason };

  /** @type {Record<string, {properties:any[]}>} */
  const entities = {};
  let properties = 0;
  for (const entityType of a.entities) {
    const r = await entityProperties({ url: s.url, token: s.token, entityType });
    if (!r.ok) return { ok: false, wrote: null, entities: 0, properties: 0, reason: r.reason };
    entities[entityType] = { properties: r.properties };
    properties += r.properties.length;
  }

  let registryRef = '0.45.1';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(a.root, 'packages/registry/data/0.45.1/_meta.json'), 'utf8'));
    registryRef = String(meta.registryRef || meta.version || registryRef);
  } catch { /* the default is the pinned directory name */ }

  const out = a.out || path.join(a.root, 'packages/sfs/test/fixtures/metadata', `${a.screen}.metadata.json`);
  const doc = snapshotDocument({ backend: s.url, entities, registryRef });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  return { ok: true, wrote: path.relative(a.root, out).replace(/\\/g, '/'), entities: Object.keys(entities).length, properties, reason: '' };
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  const args = argv.slice(2);
  const screen = value(args, '--screen');
  const entities = allValues(args, '--entity');
  const asJson = args.includes('--json');
  if (!screen || entities.length === 0) {
    process.stderr.write('record-metadata: --screen <name> and at least one --entity <Type> required\n');
    return EXIT.usage;
  }
  const root = process.cwd();
  const r = await record({ root, screen, entities, out: value(args, '--out') });
  if (asJson) process.stdout.write(`${JSON.stringify(r)}\n`);
  else if (r.ok) process.stdout.write(`record-metadata: wrote ${r.wrote} - ${r.entities} entity(ies), ${r.properties} propert(ies)\n`);
  else process.stderr.write(`record-metadata: recorded nothing - ${r.reason}\n`);
  return r.ok ? EXIT.pass : EXIT.fail;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv));
}
