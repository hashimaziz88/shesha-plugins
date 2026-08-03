#!/usr/bin/env node
/**
 * backend-probe.mjs <baseUrl> <tokenFile> <spec.json> [--versions]
 *
 * ONE run that collapses the ~10 small backend round-trips a form build otherwise
 * makes (auth reload, module id, entity resolve, metadata, reflist existence) —
 * often with 404 retries — into a single combined probe. Node 20, global `fetch`,
 * NO external deps.
 *
 * <spec.json>:
 *   { "module": "<Mod>",
 *     "entities": [ { "name": "ShortlistResult", "reflistProps": ["outcome","status"] } ] }
 *
 * In one run it:
 *   1. Reads the bearer token from <tokenFile> (strips a leading BOM + trims — a BOM
 *      poisons the `Authorization: Bearer` header → "Current user did not login").
 *   2. GET app/Module/GetAll?MaxResultCount=200 → resolves the id of spec.module.
 *   3. GET app/EntityConfig/GetMainDataList?maxResultCount=1000 ONCE → per spec entity
 *      resolves its { name, module, fullClassName }.
 *   4. Per entity, fetches metadata trying routes IN ORDER until a 200 property array:
 *        app/Metadata/GetProperties?container=<fqn>   (direct array)
 *        app/Metadata/Get?container=<fqn>             (result.properties[])
 *        Shesha/Metadata/Get?container=<fqn>          (result.properties[])
 *      Records which route worked. A 404 on all three when EntityConfig HAS the class is
 *      wrong-route/namespace, NOT a missing entity → flagged `metadataUnavailable`, never
 *      `entityMissing`.
 *   5. Per named reflistProp, reads its referenceListName/referenceListModule from the
 *      metadata, then GET app/ReferenceList/GetByName?name=<name>&module=<module> and records
 *      { exists, itemCount }. (There is NO ReferenceList/GetItems route.)
 *   6. Emits ONE compact JSON summary to stdout AND writes each entity's slice to
 *      <tokenFile dir>/<Entity>.probe.json for reuse.
 *
 * With --versions it ALSO harvests the target backend's LIVE component versions [R-049]:
 *   GET Shesha/FormConfiguration/GetAll (filtered to spec.module) → newest 1–2 forms →
 *   GetJson each → walk the markup for every {type, version} pair → write
 *   <tokenFile dir>/live-versions.json as { baseUrl, harvestedFrom, versions:{type:ver} }.
 *   Feed that file to `validate-guardrails.js --live-versions <file>`: drift against a LIVE
 *   backend is a FAIL, whereas the bundled 0.45 KB can only WARN. Versions drift across
 *   point releases (a container is v7 in the KB and v9 on a newer backend), so this is the
 *   only way to be exact about the machine you are pushing to.
 *
 * A single 404 (or any non-2xx / network error) never throws — the status is recorded and
 * the run continues.
 */

import fs from 'fs';
import path from 'path';

// ---------- args ----------

const rawArgs = process.argv.slice(2);
const WANT_VERSIONS = rawArgs.includes('--versions');
const [baseUrlArg, tokenFile, specFile] = rawArgs.filter((a) => !a.startsWith('--'));
if (!baseUrlArg || !tokenFile || !specFile) {
  console.error('usage: node backend-probe.mjs <baseUrl> <tokenFile> <spec.json> [--versions]');
  process.exit(2);
}

const baseUrl = String(baseUrlArg).replace(/\/+$/, ''); // strip trailing slash

// ---------- token (strip BOM + trim; a BOM breaks Bearer auth) ----------

let token;
try {
  token = fs.readFileSync(tokenFile, 'utf8');
  if (token.charCodeAt(0) === 0xFEFF) token = token.slice(1);
  token = token.trim();
} catch (e) {
  console.error(`Cannot read token file "${tokenFile}": ${e.message}`);
  process.exit(2);
}
if (!token) { console.error(`Token file "${tokenFile}" is empty.`); process.exit(2); }

// ---------- spec ----------

let spec;
try {
  let raw = fs.readFileSync(specFile, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  spec = JSON.parse(raw);
} catch (e) {
  console.error(`Cannot read/parse spec "${specFile}": ${e.message}`);
  process.exit(2);
}
const specModule = spec.module || null;
const entities = Array.isArray(spec.entities) ? spec.entities : [];
if (!entities.length) { console.error('spec.entities is empty — nothing to probe.'); process.exit(2); }

const outDir = path.dirname(path.resolve(tokenFile));

// ---------- fetch helper — never throws; records status + parsed json ----------

async function getJson(pathAndQuery) {
  const url = `${baseUrl}${pathAndQuery}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const raw = await res.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* leave null on non-JSON */ }
    return { url, status: res.status, ok: res.ok, json };
  } catch (err) {
    return { url, status: 0, ok: false, json: null, error: String((err && err.message) || err) };
  }
}

const qs = (obj) => Object.entries(obj)
  .map(([k, v]) => `${k}=${encodeURIComponent(v == null ? '' : v)}`).join('&');

// ---------- shape helpers ----------

// A GetAll/GetMainDataList payload can be an ABP envelope { result: { items:[] } },
// { result: [] }, or a bare array — normalise to a flat list.
function itemsOf(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (json.result) {
    if (Array.isArray(json.result)) return json.result;
    if (Array.isArray(json.result.items)) return json.result.items;
  }
  if (Array.isArray(json.items)) return json.items;
  return [];
}

// Extract a property array across the three metadata route shapes:
// bare array | { result: [] } | { result: { properties: [] } } | { properties: [] }.
function propsOf(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json;
  if (json.result) {
    if (Array.isArray(json.result)) return json.result;
    if (Array.isArray(json.result.properties)) return json.result.properties;
  }
  if (Array.isArray(json.properties)) return json.properties;
  return null;
}

const moduleName = (m) => (m && typeof m === 'object') ? (m.name || null) : (m || null);

// Distil a metadata property to just what the form build needs.
function distil(p) {
  const o = { path: p.path ?? p.name ?? null, dataType: p.dataType ?? p.type ?? null };
  if (p.referenceListName) {
    o.referenceListName = p.referenceListName;
    if (p.referenceListModule) o.referenceListModule = p.referenceListModule;
  }
  return o;
}

// ---------- live component versions (--versions) ----------

// Harvest {componentType: version} off real markup on THIS backend. The newest
// forms are used because they were saved by the running designer, so their
// version stamps are exactly what this release migrates to.
async function harvestLiveVersions() {
  const filter = JSON.stringify({ and: [{ '==': [{ var: 'module.name' }, specModule] }] });
  const list = await getJson(`/api/services/Shesha/FormConfiguration/GetAll?${qs({ MaxResultCount: 200, Filter: filter })}`);
  let forms = itemsOf(list.json);
  if (!forms.length) {
    // no module match (or no Filter support) — fall back to the unfiltered list
    const all = await getJson(`/api/services/Shesha/FormConfiguration/GetAll?${qs({ MaxResultCount: 200 })}`);
    forms = itemsOf(all.json);
  }
  const stamp = (f) => Date.parse(f.lastModificationTime || f.creationTime || '') || 0;
  forms = forms.filter((f) => f && f.id).sort((a, b) => stamp(b) - stamp(a)).slice(0, 2);

  const versions = {};
  const conflicts = {};
  const harvestedFrom = [];
  for (const f of forms) {
    const r = await getJson(`/api/services/Shesha/FormConfiguration/GetJson?${qs({ id: f.id })}`);
    if (r.status !== 200 || !r.json) { harvestedFrom.push({ id: f.id, name: f.name, status: r.status, note: 'GetJson returned no markup' }); continue; }
    let markup = r.json;
    if (typeof markup.markup === 'string') { try { markup = JSON.parse(markup.markup); } catch { /* leave as-is */ } }
    if (markup.result) markup = typeof markup.result.markup === 'string' ? JSON.parse(markup.result.markup) : markup.result;
    let seen = 0;
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      if (typeof v.type === 'string' && Number.isInteger(v.version)) {
        seen++;
        if (versions[v.type] === undefined) versions[v.type] = v.version;
        else if (versions[v.type] !== v.version) (conflicts[v.type] ??= new Set()).add(v.version);
      }
      for (const x of Object.values(v)) walk(x);
    })(markup.components ?? markup);
    harvestedFrom.push({ id: f.id, name: f.name, components: seen });
  }

  const out = {
    baseUrl,
    module: specModule,
    harvestedAt: new Date().toISOString(),
    harvestedFrom,
    // a type stamped at two different versions in the same corpus is ambiguous —
    // record it rather than picking a winner, so the gate can be trusted.
    ambiguous: Object.fromEntries(Object.entries(conflicts).map(([t, s]) => [t, [versions[t], ...s]])),
    versions,
  };
  const file = path.join(outDir, 'live-versions.json');
  try {
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  } catch (err) {
    console.error(`WARN: could not write ${file}: ${err.message}`);
  }
  return { file, typeCount: Object.keys(versions).length, formCount: harvestedFrom.length, ambiguous: Object.keys(out.ambiguous).length };
}

// ---------- main ----------

async function main() {
  // Step 2 — module id
  const modRes = await getJson(`/api/services/app/Module/GetAll?${qs({ MaxResultCount: 200 })}`);
  const modules = itemsOf(modRes.json);
  const modMatch = modules.find(m => moduleName(m.name ?? m) === specModule)
    || modules.find(m => (moduleName(m.name ?? m) || '').toLowerCase() === String(specModule || '').toLowerCase());
  const moduleSummary = {
    name: specModule,
    id: modMatch ? (modMatch.id ?? null) : null,
    status: modRes.status,
  };
  if (!modMatch) moduleSummary.note = 'module not found in Module/GetAll';

  // Step 3 — entity configs (ONE call)
  const ecRes = await getJson(`/api/services/app/EntityConfig/GetMainDataList?${qs({ maxResultCount: 1000 })}`);
  const configs = itemsOf(ecRes.json);
  const findConfig = (name) =>
    configs.find(c => c.name === name)
    || configs.find(c => (c.name || '').toLowerCase() === String(name || '').toLowerCase());

  const METADATA_ROUTES = [
    { label: 'app/Metadata/GetProperties', path: (fqn) => `/api/services/app/Metadata/GetProperties?${qs({ container: fqn })}` },
    { label: 'app/Metadata/Get',          path: (fqn) => `/api/services/app/Metadata/Get?${qs({ container: fqn })}` },
    { label: 'Shesha/Metadata/Get',       path: (fqn) => `/api/services/Shesha/Metadata/Get?${qs({ container: fqn })}` },
  ];

  const results = [];

  for (const ent of entities) {
    const name = ent.name;
    const wantReflist = Array.isArray(ent.reflistProps) ? ent.reflistProps : [];
    const cfg = findConfig(name);

    const entry = {
      name,
      modelType: null,
      fullClassName: null,
      entityMissing: false,
      metadataUnavailable: false,
      metadataRoute: null,
      propertyCount: 0,
      properties: [],
      reflistProps: [],
    };

    if (!cfg) {
      // EntityConfig genuinely does not carry this class.
      entry.entityMissing = true;
      entry.note = `"${name}" not found in EntityConfig/GetMainDataList (HTTP ${ecRes.status}) — entity is not registered`;
      results.push(entry);
      continue;
    }

    const fqn = cfg.fullClassName || cfg.className || null;
    entry.fullClassName = fqn;
    entry.modelType = { name: cfg.name || name, module: moduleName(cfg.module) };

    // Step 4 — metadata routes in order until a 200 property array.
    let props = null;
    const attempts = [];
    for (const route of METADATA_ROUTES) {
      if (!fqn) break;
      const r = await getJson(route.path(fqn));
      attempts.push({ route: route.label, status: r.status });
      if (r.status === 200) {
        const p = propsOf(r.json);
        if (p && p.length) { props = p; entry.metadataRoute = route.label; break; }
      }
    }

    if (!props) {
      // EntityConfig HAS the class but no route yielded a usable 200 property array →
      // wrong-route/namespace, NOT a missing entity.
      entry.metadataUnavailable = true;
      entry.metadataAttempts = attempts;
      entry.note = 'EntityConfig has this class but no metadata route returned a 200 property array — wrong route/namespace, not a missing entity';
      results.push(entry);
      continue;
    }

    entry.propertyCount = props.length;
    entry.properties = props.map(distil);

    // Index by lower-cased path for reflist lookups.
    const byPath = {};
    for (const p of props) {
      const key = String(p.path ?? p.name ?? '').toLowerCase();
      if (key) byPath[key] = p;
    }

    // Step 5 — reflist existence + item count per named reflistProp.
    for (const rp of wantReflist) {
      const p = byPath[String(rp).toLowerCase()];
      if (!p) {
        entry.reflistProps.push({ prop: rp, found: false, note: 'property not in metadata' });
        continue;
      }
      const rlName = p.referenceListName || null;
      const rlModule = p.referenceListModule || null;
      if (!rlName) {
        entry.reflistProps.push({ prop: rp, name: null, module: null, exists: false, note: 'property has no referenceListName in metadata' });
        continue;
      }
      const rl = await getJson(`/api/services/app/ReferenceList/GetByName?${qs({ name: rlName, module: rlModule })}`);
      const result = rl.json && rl.json.result;
      const exists = rl.status === 200 && !!result;
      const itemCount = exists && Array.isArray(result.items) ? result.items.length : 0;
      const record = { prop: rp, name: rlName, module: rlModule, exists, itemCount };
      if (!exists) record.status = rl.status;
      entry.reflistProps.push(record);
    }

    results.push(entry);
  }

  const summary = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    module: moduleSummary,
    entities: results,
  };

  // Step 7 (--versions) — live component versions for the R-049 gate.
  if (WANT_VERSIONS) summary.liveVersions = await harvestLiveVersions();

  // Step 6 — per-entity probe files for reuse.
  for (const e of results) {
    const file = path.join(outDir, `${e.name}.probe.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(e, null, 2));
    } catch (err) {
      console.error(`WARN: could not write ${file}: ${err.message}`);
    }
  }

  // Step 6 — ONE compact summary to stdout.
  process.stdout.write(JSON.stringify(summary) + '\n');
}

main().catch(err => {
  // Only truly unexpected failures land here — a single 404 is handled inline above.
  console.error(`backend-probe failed: ${(err && err.stack) || err}`);
  process.exit(1);
});
