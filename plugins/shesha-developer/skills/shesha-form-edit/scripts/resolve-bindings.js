#!/usr/bin/env node
// resolve-bindings.js <form.json> [entity-metadata.json]
//                                 [--metadata <path>] [--offline]
//                                 [--backend http://localhost:21021] [--model-type <fullClassName>]
//                                 [--token-file <path>]
//
// L4 blocking gate for entity-bound forms [R-015, R-016, R-034]:
//  - every bound propertyName exists on its scope's entity
//  - dotted navigation paths resolve segment-by-segment
//  - every referenceListId exists (and has items when the source reports them)
//  - custom endpoints referenced in markup respond (404 = missing)
// Scope = nearest dataContext ancestor's entityType, else formSettings.modelType.
//
// ── SOURCES (exactly one, in this order) ──────────────────────────────────────
//   CACHE  a metadata dump is supplied — as positional arg 2 (the same convention
//          as validate-guardrails.js, which is the canonical form) or via the
//          `--metadata <path>` alias. NO backend is contacted. Accepted shapes:
//          a bare property array, {result:[…]}, {result:{properties:[…]}},
//          {properties:[…]}, ONE backend-probe.mjs entity entry, or a whole
//          backend-probe.mjs summary ({entities:[…]}). Verification is real, but
//          it is verification against a SNAPSHOT: the run prints the cache path,
//          its mtime and its age so cache confidence is never read as live
//          confidence.
//   LIVE   no metadata and no --offline — Metadata/GetProperties + the reflist
//          configuration-item route, exactly as before.
//   NONE   --offline with no metadata — the gate CANNOT verify anything. It says
//          so and exits 3. It never exits 0, because a clean exit here would let
//          an unverified entity-bound form look gate-passed.
//
// ── EXIT CODES ────────────────────────────────────────────────────────────────
//   0  every binding/reflist/endpoint in scope was checked and resolved
//   1  findings — something does not resolve (the form is wrong)
//   2  usage error, OR an infrastructure failure: the backend is unreachable /
//      refuses the connection / times out, or authentication was rejected. ONE
//      actionable line, never a stack trace — these are expected environmental
//      conditions, not defects in this script.
//   3  CANNOT EVALUATE — `--offline` with no metadata, or a cached run where some
//      binding had nothing in the cache to check it against. Prints
//      `BINDINGS UNVERIFIED` naming what is unknown. Precedence: 1 beats 3 beats
//      0 (a real finding is still reported even when other items were unverifiable).
//
// A per-entity metadata fetch that 404s is a FINDING about that entity, and stays
// distinguishable from "the whole backend is down" (which is exit 2).

import fs from 'node:fs';
import { GymApi } from './gym-lib/api.js';

const args = process.argv.slice(2);
// the positional args — never the VALUE of a value-taking flag
const VALUE_FLAGS = new Set(['--backend', '--model-type', '--token-file', '--metadata']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const USAGE = 'usage: node resolve-bindings.js <form.json> [entity-metadata.json] [--metadata path] [--offline]'
  + ' [--backend url] [--model-type fullClassName] [--token-file path]';

const file = positional[0];
const OFFLINE = args.includes('--offline');
const metaFile = argVal('--metadata', null) ?? positional[1] ?? null;
const BACKEND = argVal('--backend', 'http://localhost:21021');
if (!file) { console.error(USAGE); process.exit(2); }

/** One actionable line + exit 2. Used for every expected environmental failure. */
function infraDie(line) {
  console.error(`INFRA  ${line}`);
  process.exit(2);
}

/**
 * Expected-environment classifier. Returns a one-line message for a network/auth
 * condition, or null — and null means "this is a real programming error", which
 * is then re-thrown honestly rather than swallowed.
 */
function infraLine(err) {
  const msg = String(err?.message ?? err);
  const code = err?.cause?.code ?? err?.code ?? null;
  const NET = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET',
    'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']);
  const networkish = (code && NET.has(code)) || /fetch failed|network|socket hang up|timed? ?out/i.test(msg);
  if (networkish) {
    return `backend ${BACKEND} is not reachable (${code ?? 'fetch failed'}) — start the backend, or point --backend at the right origin,`
      + ` or verify offline against a snapshot: node resolve-bindings.js ${file} <entity-metadata.json> (from scripts/backend-probe.mjs)`;
  }
  if (/refusing to authenticate|auth failed: HTTP|no accessToken|did not login|HTTP 401|HTTP 403/i.test(msg)) {
    return `authentication to ${BACKEND} was rejected (${msg.replace(/\s+/g, ' ').slice(0, 120)}) — set SHESHA_USER and SHESHA_PASSWORD,`
      + ' or pass --token-file <path> with a valid bearer token (a cached token is itself a credential)';
  }
  return null;
}

/** Await a backend call; expected environmental failures become exit 2, bugs still throw. */
async function guarded(fn) {
  try { return await fn(); } catch (err) {
    const line = infraLine(err);
    if (line) infraDie(line);
    throw err;
  }
}

let root = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (typeof root.markup === 'string') root = JSON.parse(root.markup);
if (root.result && (root.result.markup || root.result.components)) {
  root = typeof root.result.markup === 'string' ? JSON.parse(root.result.markup) : root.result;
}

// ---- walk markup, collect work ----------------------------------------------
const bindings = []; // {prop, scopeEntity, label}
const reflists = new Map(); // "module/name" -> {label, prop}
const endpoints = new Set();

const INPUTISH = /Field$|^dropdown$|^autocomplete$|^checkbox|^radio$|^switch$|^entityPicker$|^textArea$|^rate$|^slider$|^refListStatus$|^timePicker$|^fileUpload$/;

function walk(nodes, scopeEntity) {
  for (const node of nodes ?? []) {
    if (!node || typeof node !== 'object') continue;
    let scope = scopeEntity;
    if ((node.type === 'dataContext' || node.type === 'datatableContext')) {
      if (typeof node.entityType === 'string' && node.entityType) scope = node.entityType;
      if (typeof node.endpoint === 'string' && node.endpoint.startsWith('/')) endpoints.add(node.endpoint);
    }
    if (node.propertyName && typeof node.propertyName === 'string'
        && (INPUTISH.test(node.type ?? '') || node.columnType === 'data')) {
      bindings.push({ prop: node.propertyName, scopeEntity: scope, label: node.componentName || node.propertyName });
    }
    if (node.referenceListId && typeof node.referenceListId === 'object' && node.referenceListId.name) {
      reflists.set(`${node.referenceListId.module ?? ''}/${node.referenceListId.name}`,
        { label: node.componentName || node.propertyName || node.type, prop: node.propertyName ?? null });
    }
    if (Array.isArray(node.items)) {
      for (const it of node.items) {
        if (it?.columnType === 'data' && it.propertyName) bindings.push({ prop: it.propertyName, scopeEntity: scope, label: `column ${it.propertyName}` });
      }
    }
    walk(node.components, scope);
    if (Array.isArray(node.columns)) for (const c of node.columns) walk(c?.components, scope);
    if (Array.isArray(node.tabs)) for (const t of node.tabs) walk(t?.components, scope);
    if (Array.isArray(node.steps)) for (const s of node.steps) walk(s?.components, scope);
    if (node.content?.components) walk(node.content.components, scope);
    if (node.header?.components) walk(node.header.components, scope);
  }
}

const findings = [];    // the form is wrong → exit 1
const unverified = [];  // nothing to check against → exit 3, never a pass
const notes = [];

const lastSeg = (s) => { const v = String(s ?? ''); const i = v.lastIndexOf('.'); return i >= 0 ? v.slice(i + 1) : v; };

// ============================================================ NONE (--offline)
if (OFFLINE && !metaFile) {
  const declaredModel = root.formSettings?.modelType ?? null;
  walk(root.components, typeof declaredModel === 'string' ? declaredModel : (declaredModel?.name ?? null));
  console.log('resolve-bindings: source NONE — --offline with no metadata dump');
  console.log(`UNVERIFIED  ${bindings.length} bound propertyName(s) — existence on the entity is UNKNOWN`);
  console.log(`UNVERIFIED  ${reflists.size} reference list(s) — existence and item count are UNKNOWN`);
  console.log(`UNVERIFIED  ${endpoints.size} custom endpoint(s) — reachability is UNKNOWN`);
  console.log(`UNVERIFIED  formSettings.modelType ${JSON.stringify(declaredModel)} — not resolved against any entity registry`);
  console.log('\nBINDINGS UNVERIFIED — this gate did NOT run. Resolve it one of two ways:'
    + ' (a) run against a backend: node resolve-bindings.js <form.json> --backend <url> [--token-file <path>];'
    + ' (b) supply a cached metadata dump as arg 2: node scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>'
    + ' then node resolve-bindings.js <form.json> <Entity>.probe.json');
  console.log(`\nresolve-bindings: NOT VERIFIED (exit 3) — ${file}`);
  process.exit(3);
}

// ============================================================ CACHE (metadata)
if (metaFile) {
  let raw, stat;
  try {
    stat = fs.statSync(metaFile);
    raw = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    infraDie(`cached metadata "${metaFile}" is unreadable (${e.message}) — regenerate it with scripts/backend-probe.mjs, or drop the argument to verify against a live backend`);
  }

  // ---- normalise every accepted shape into identified containers -------------
  const propsOf = (o) => {
    if (Array.isArray(o)) return o;
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.properties)) return o.properties;
    if (o.result) {
      if (Array.isArray(o.result)) return o.result;
      if (Array.isArray(o.result.properties)) return o.result.properties;
    }
    return null;
  };
  /** @type {{keys:Set<string>, anonymous:boolean, props:Map<string,object>, reflistProps:object[], display:string}[]} */
  const containers = [];
  const addContainer = (src, identity) => {
    const props = propsOf(src);
    if (!props) return;
    const keys = new Set();
    for (const id of identity) if (id) { keys.add(String(id).toLowerCase()); keys.add(lastSeg(id).toLowerCase()); }
    const map = new Map();
    for (const p of props) { const k = p?.path ?? p?.name; if (k) map.set(String(k).toLowerCase(), p); }
    containers.push({
      keys,
      anonymous: keys.size === 0,
      props: map,
      reflistProps: Array.isArray(src?.reflistProps) ? src.reflistProps : [],
      display: identity.find(Boolean) ?? '(unnamed container)',
    });
  };
  if (Array.isArray(raw?.entities)) {
    for (const e of raw.entities) addContainer(e, [e?.fullClassName, e?.name, e?.modelType?.name]);
  } else {
    addContainer(raw, [raw?.fullClassName, raw?.container, raw?.name, raw?.modelType?.name,
      typeof raw?.modelType === 'string' ? raw.modelType : null]);
  }
  if (!containers.length) {
    infraDie(`cached metadata "${metaFile}" carries no property array (expected a property list, a backend-probe entity entry, or a backend-probe summary) — regenerate it with scripts/backend-probe.mjs`);
  }
  const anonCount = containers.filter((c) => c.anonymous).length;
  if (anonCount) {
    notes.push(`the cache carries ${anonCount} container(s) with no entity identity — used for the form's own model scope only, never for a dotted navigation target`);
  }

  /** Resolve a container name against the cache. isRoot allows the anonymous dump. */
  const lookup = (container, isRoot) => {
    const key = String(container).toLowerCase();
    const short = lastSeg(container).toLowerCase();
    const named = containers.find((c) => c.keys.has(key) || c.keys.has(short));
    if (named) return named;
    if (isRoot && containers.length === 1 && containers[0].anonymous) return containers[0];
    return null;
  };

  // scope: --model-type wins; else the declared modelType (string or {name})
  const declared = root.formSettings?.modelType ?? null;
  const modelType = argVal('--model-type', null)
    ?? (typeof declared === 'string' ? declared : (declared?.name ?? null));
  walk(root.components, modelType);

  if (declared && modelType) {
    const hit = lookup(modelType, true);
    if (!hit) {
      unverified.push(`[R-016] formSettings.modelType ${JSON.stringify(declared)} — no container in the cache matches it; the cache cannot confirm this entity is registered`);
    }
  } else if (declared && !modelType) {
    unverified.push(`[R-016] formSettings.modelType ${JSON.stringify(declared)} — offline resolution to a fullClassName needs the live EntityConfig`);
  }

  for (const b of bindings) {
    if (!b.scopeEntity) continue; // form-data-only property — nothing to verify against
    const segments = b.prop.split('.');
    let container = b.scopeEntity;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const c = lookup(container, i === 0);
      if (!c) {
        unverified.push(`[R-034] ${b.label}: entity "${container}" is not in the cache — "${b.prop}"${segments.length > 1 ? ` (from segment ${i + 1})` : ''} was NOT checked`);
        break;
      }
      const p = c.props.get(seg.toLowerCase());
      if (!p) {
        findings.push(`[R-034] ${b.label}: "${seg}"${segments.length > 1 ? ` (segment ${i + 1} of ${b.prop})` : ''} does not exist on ${c.display}`);
        break;
      }
      if (i < segments.length - 1) {
        const nav = p.entityType ?? p.entityTypeShortAlias ?? null;
        if (!nav) {
          findings.push(`[R-034] ${b.label}: "${seg}" in "${b.prop}" is not a navigation property (no entityType) — cannot dot into it`);
          break;
        }
        container = nav;
      }
    }
  }

  for (const [key, { label, prop }] of reflists) {
    const [module, name] = key.split('/');
    // (a) a backend-probe reflist record is real existence + item-count evidence
    const record = containers.flatMap((c) => c.reflistProps)
      .find((r) => r && lastSeg(r.name) && lastSeg(r.name).toLowerCase() === name.toLowerCase()
        && (!module || !r.module || String(r.module).toLowerCase() === module.toLowerCase()));
    if (record) {
      if (record.exists === false) findings.push(`[R-015] ${label}: reference list ${module}.${name} does not exist (cached probe${record.status ? ` HTTP ${record.status}` : ''}) — the dropdown renders EMPTY`);
      else if (record.itemCount === 0) findings.push(`[R-015] ${label}: reference list ${module}.${name} exists but has 0 items (cached probe)`);
      continue;
    }
    // (b) the bound property's metadata proves IDENTITY but not existence
    const p = prop && containers.map((c) => c.props.get(String(prop).toLowerCase())).find(Boolean);
    if (p?.referenceListName) {
      const expName = lastSeg(p.referenceListName);
      const expMod = p.referenceListModule ?? null;
      if (expName.toLowerCase() !== name.toLowerCase() || (module && expMod && module.toLowerCase() !== String(expMod).toLowerCase())) {
        findings.push(`[R-015] ${label}: authored referenceList {module:${module}, name:${name}} does not match the cached metadata (${expMod}.${expName}) — the dropdown renders EMPTY; copy from metadata verbatim`);
      } else {
        unverified.push(`[R-015] ${label}: reference list ${module}.${name} matches the cached metadata identity, but its existence + item count are NOT in the cache`);
      }
      continue;
    }
    unverified.push(`[R-015] ${label}: reference list ${module}.${name} — the cache carries no evidence for it (no probe record, no referenceListName on the bound property)`);
  }

  for (const ep of endpoints) {
    unverified.push(`[R-026] custom endpoint ${ep} — reachability cannot be checked from a metadata cache`);
  }

  const ageMs = Date.now() - stat.mtimeMs;
  const age = ageMs < 3600e3 ? `${Math.round(ageMs / 60e3)} min` : (ageMs < 86400e3 ? `${(ageMs / 3600e3).toFixed(1)} h` : `${(ageMs / 86400e3).toFixed(1)} days`);
  console.log(`resolve-bindings: source CACHE ${metaFile} — mtime ${new Date(stat.mtimeMs).toISOString()}, age ${age}, ${containers.length} container(s): ${containers.map((c) => c.display).join(', ')}`);
  console.log('NOTE  this is verification against a SNAPSHOT, not against the live backend — a stale cache cannot see a property or reference list that changed after it was taken');
  report();
}

// ============================================================ LIVE
const api = new GymApi(BACKEND, { tokenFile: argVal('--token-file', null) });
await guarded(() => api.authenticate());

// ---- entity metadata cache --------------------------------------------------
const propsCache = new Map(); // container(lower) -> Map(propLower -> prop) | null
async function getProps(container) {
  const key = String(container).toLowerCase();
  if (propsCache.has(key)) return propsCache.get(key);
  // A 404/500 for ONE container is that entity's problem (a finding). Only a
  // transport failure means the backend itself went away → exit 2.
  const { ok, body } = await guarded(() => api.getJson(`/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(container)}`));
  let map = null;
  const arr = Array.isArray(body?.result) ? body.result : (Array.isArray(body) ? body : null);
  if (ok && arr) {
    map = new Map();
    for (const p of arr) if (p?.path) map.set(String(p.path).toLowerCase(), p);
  }
  propsCache.set(key, map);
  return map;
}

async function resolveModelType() {
  const explicit = argVal('--model-type', null);
  if (explicit) return explicit;
  const mt = root.formSettings?.modelType;
  if (!mt) return null;
  if (typeof mt === 'string') return mt;
  // {name, module} object → resolve fullClassName via EntityTypeAutocomplete [R-016]
  const { body } = await guarded(() => api.getJson(`/api/services/app/Metadata/EntityTypeAutocomplete?term=${encodeURIComponent(mt.name)}`));
  const items = body?.result ?? [];
  const hit = items.find((i) => (i.value || i.displayText || '').includes(mt.name));
  return hit?.value ?? null;
}

const modelType = await resolveModelType();
walk(root.components, modelType);

if (root.formSettings?.modelType && !modelType) {
  findings.push(`[R-016] formSettings.modelType ${JSON.stringify(root.formSettings.modelType)} did not resolve to a live entity type`);
}

for (const b of bindings) {
  if (!b.scopeEntity) continue; // unbound scope (form-data-only property) — nothing to verify against
  const segments = b.prop.split('.');
  let container = b.scopeEntity;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const props = await getProps(container);
    if (!props) { findings.push(`[R-034] ${b.label}: metadata for "${container}" unavailable — cannot verify "${b.prop}"`); break; }
    const p = props.get(seg.toLowerCase());
    if (!p) { findings.push(`[R-034] ${b.label}: "${seg}"${segments.length > 1 ? ` (segment ${i + 1} of ${b.prop})` : ''} does not exist on ${container}`); break; }
    if (i < segments.length - 1) {
      if (!p.entityType) { findings.push(`[R-034] ${b.label}: "${seg}" in "${b.prop}" is not a navigation property (no entityType) — cannot dot into it`); break; }
      container = p.entityType;
    }
  }
}

for (const [key, { label }] of reflists) {
  const [module, name] = key.split('/');
  // 0.45 route: reflists are configuration items (this is what the renderer itself fetches)
  let { ok, body } = await guarded(() => api.getJson(
    `/api/services/app/ConfigurationItem/GetCurrent?itemType=reference-list&name=${encodeURIComponent(name)}&module=${encodeURIComponent(module)}`,
  ));
  let items = body?.result?.configuration?.items;
  if (!ok) {
    // legacy fallback
    ({ ok, body } = await guarded(() => api.getJson(`/api/services/app/ReferenceList/GetByName?name=${encodeURIComponent(name)}&module=${encodeURIComponent(module)}`)));
    items = body?.result?.items;
  }
  if (!ok) {
    findings.push(`[R-015] ${label}: reference list ${module}.${name} does not exist — the dropdown renders EMPTY`);
  } else if (Array.isArray(items) && items.length === 0) {
    findings.push(`[R-015] ${label}: reference list ${module}.${name} exists but has 0 items`);
  }
}

for (const ep of endpoints) {
  const { status } = await guarded(() => api.getJson(ep));
  if (status === 404) findings.push(`[R-026] custom endpoint ${ep} → 404 (wrong namespace or missing service)`);
}

console.log(`resolve-bindings: source LIVE ${BACKEND}`);
report();

// ---- shared reporting --------------------------------------------------------
function report() {
  for (const f of findings) console.log(`FAIL  ${f}`);
  for (const u of unverified) console.log(`UNVERIFIED  ${u}`);
  for (const n of notes) console.log(`NOTE  ${n}`);
  console.log(`\nresolve-bindings: ${bindings.length} bindings, ${reflists.size} reflists, ${endpoints.size} endpoints — ${findings.length} unresolved, ${unverified.length} unverifiable — ${file}`);
  if (findings.length) process.exit(1);
  if (unverified.length) {
    console.log('\nBINDINGS UNVERIFIED — the items above were NOT checked. Run against a backend (--backend <url> [--token-file <path>])'
      + ' or supply a fuller cached dump from scripts/backend-probe.mjs.');
    process.exit(3);
  }
  process.exit(0);
}
