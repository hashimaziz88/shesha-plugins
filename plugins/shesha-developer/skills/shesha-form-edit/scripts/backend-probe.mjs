#!/usr/bin/env node
/**
 * backend-probe.mjs <baseUrl> <tokenFile> <spec.json>
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
 * A single 404 (or any non-2xx / network error) never throws — the status is recorded and
 * the run continues.
 */

import fs from 'fs';
import path from 'path';

// ---------- args ----------

const [baseUrlArg, tokenFile, specFile] = process.argv.slice(2);
if (!baseUrlArg || !tokenFile || !specFile) {
  console.error('usage: node backend-probe.mjs <baseUrl> <tokenFile> <spec.json>');
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
      // 0.45 route: reflists are CONFIGURATION ITEMS — this is what the renderer itself
      // fetches, and the same order resolve-bindings.js uses. app/ReferenceList/GetByName
      // 404s on this backend generation, so probing it alone reported every reflist-bound
      // property as a missing blocker.
      let rl = await getJson(`/api/services/app/ConfigurationItem/GetCurrent?${qs({ itemType: 'reference-list', name: rlName, module: rlModule })}`);
      let items = rl.json?.result?.configuration?.items;
      let route = 'app/ConfigurationItem/GetCurrent';
      if (rl.status !== 200 || !rl.json?.result) {
        // legacy fallback for older builds
        const legacy = await getJson(`/api/services/app/ReferenceList/GetByName?${qs({ name: rlName, module: rlModule })}`);
        if (legacy.status === 200 && legacy.json?.result) {
          rl = legacy;
          items = legacy.json.result.items;
          route = 'app/ReferenceList/GetByName';
        }
      }
      const exists = rl.status === 200 && !!rl.json?.result;
      const itemCount = Array.isArray(items) ? items.length : 0;
      const record = { prop: rp, name: rlName, module: rlModule, exists, itemCount };
      if (exists) record.route = route; else record.status = rl.status;
      entry.reflistProps.push(record);
    }

    // Step 7 — dynamic CRUD reachability + permissions, per entity.
    // A form bound to an entity whose CRUD endpoint is down renders and then fails
    // silently on submit, so this is a prerequisite, not a nicety.
    if (entry.fullClassName && !entry.entityMissing) {
      // The dynamic CRUD route is keyed on the ENTITY's own module, not the module the
      // form will live in. Using the form's module 404s for any entity defined
      // elsewhere — e.g. a form in "boxfusion.test" bound to Shesha.Domain.Site.
      const entityModule = entry.modelType?.module || moduleSummary.name;
      const crudPath = `/api/dynamic/${entityModule}/${entry.name}/Crud/GetAll?${qs({ maxResultCount: 1 })}`;
      const crud = await getJson(crudPath);
      const c = { route: crudPath, status: crud.status, reachable: crud.status === 200 };
      if (crud.status === 400) {
        c.note = 'HTTP 400 — dynamic CRUD (GraphQL) not enabled on this entity';
        c.fixSkill = 'shesha-developer:domain-model';
      } else if (crud.status === 401 || crud.status === 403) {
        c.note = `HTTP ${crud.status} — the supplied identity cannot read this entity`;
        c.fixSkill = 'shesha-utils:harden-permissions';
        c.permissionDenied = true;
      } else if (crud.status === 500) {
        const body = JSON.stringify(crud.json ?? '').slice(0, 300);
        c.note = /invalid object name/i.test(body)
          ? 'HTTP 500 "Invalid object name" — migrations have not been run'
          : `HTTP 500 from dynamic CRUD: ${body}`;
        c.fixSkill = 'shesha-developer:domain-model';
      } else if (crud.status !== 200) {
        c.note = `unexpected HTTP ${crud.status}`;
      }
      entry.dynamicCrud = c;

      // Guid FKs surfacing as numbers/booleans mean the junction extends Entity<Guid>
      // rather than FullAuditedEntity<Guid> — the M:M typing trap.
      const rows = c.reachable ? itemsOf(crud.json) : [];
      if (rows.length) {
        const suspect = Object.entries(rows[0])
          .filter(([k, v]) => /id$/i.test(k) && v != null && typeof v !== 'string' && typeof v !== 'object')
          .map(([k, v]) => `${k}=${typeof v}`);
        if (suspect.length) {
          entry.dtoTyping = {
            pass: false,
            suspect,
            note: 'FK field(s) are not string/object — junction likely extends Entity<Guid> instead of FullAuditedEntity<Guid>',
            fixSkill: 'shesha-developer:domain-model',
          };
        } else {
          entry.dtoTyping = { pass: true };
        }
      }
    }

    results.push(entry);
  }

  // Step 8 — readiness verdict. `ready` is true only when every check that ran passed;
  // a check that could not run is a failure with evidence "not verified", never a pass.
  const checks = [];
  for (const e of results) {
    const at = e.name;
    checks.push(e.entityMissing
      ? { check: 'entity-registered', target: at, pass: false, evidence: e.note ?? 'not in EntityConfig', fixSkill: 'shesha-developer:domain-model' }
      : { check: 'entity-registered', target: at, pass: true, evidence: `fullClassName ${e.fullClassName}` });

    // A missing entity has nothing to read, so metadata cannot pass — reporting
    // "0 properties" as a pass is exactly the kind of green-on-nothing this avoids.
    const propCount = (e.properties ?? []).length;
    checks.push(e.metadataUnavailable || e.entityMissing || propCount === 0
      ? {
        check: 'metadata-readable', target: at, pass: false,
        evidence: e.entityMissing ? 'entity not registered — no metadata to read'
          : (e.note ?? `no metadata route returned properties (${propCount} found)`),
        fixSkill: 'shesha-developer:domain-model',
      }
      : { check: 'metadata-readable', target: at, pass: true, evidence: `${propCount} properties via ${e.metadataRoute ?? 'metadata'}` });

    for (const r of e.reflistProps ?? []) {
      const ok = r.exists && r.itemCount > 0;
      checks.push({
        check: 'reference-list', target: `${at}.${r.prop}`, pass: ok,
        evidence: ok ? `${r.name} (${r.itemCount} items)`
          : (r.note ?? (r.exists ? `${r.name} exists but has no items` : `${r.name ?? '?'} not found (HTTP ${r.status ?? '?'})`)),
        ...(ok ? {} : { fixSkill: 'shesha-developer:domain-model' }),
      });
    }

    if (e.dynamicCrud) {
      checks.push({
        check: e.dynamicCrud.permissionDenied ? 'permissions' : 'dynamic-crud',
        target: at, pass: e.dynamicCrud.reachable,
        evidence: e.dynamicCrud.note ?? `HTTP ${e.dynamicCrud.status}`,
        ...(e.dynamicCrud.fixSkill ? { fixSkill: e.dynamicCrud.fixSkill } : {}),
      });
    } else if (!e.entityMissing) {
      checks.push({ check: 'dynamic-crud', target: at, pass: false, evidence: 'not verified' });
    }

    if (e.dtoTyping && !e.dtoTyping.pass) {
      checks.push({ check: 'dto-typing', target: at, pass: false, evidence: e.dtoTyping.note, fixSkill: e.dtoTyping.fixSkill });
    }
  }

  const failed = checks.filter((c) => !c.pass);
  const summary = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    module: moduleSummary,
    entities: results,
    ready: failed.length === 0,
    checks,
    blockers: failed.map((c) => `${c.check}@${c.target}: ${c.evidence}${c.fixSkill ? ` → ${c.fixSkill}` : ''}`),
  };

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

  // Exit 1 when the backend cannot support the planned form work, so a caller can
  // gate on the exit code instead of parsing prose. This replaced the
  // fullstack-prereq-checker agent: the checks are deterministic, so they are a script.
  if (!summary.ready) {
    console.error(`\nNOT READY — ${summary.blockers.length} blocker(s):`);
    for (const b of summary.blockers) console.error(`  - ${b}`);
    // Set exitCode rather than calling process.exit(): fetch keeps its sockets alive
    // briefly, and exiting while those handles are open trips a libuv assertion on
    // Windows and reports 127 instead of 1 — which defeats gating on the exit code.
    process.exitCode = 1;
  }
}

main().catch(err => {
  // Only truly unexpected failures land here — a single 404 is handled inline above.
  console.error(`backend-probe failed: ${(err && err.stack) || err}`);
  process.exit(1);
});
