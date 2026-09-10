// The live Shesha backend, as a program rather than as an operator note.
//
// Everything above this file treated "a live backend" as somebody else's problem:
// metadata_entity read a recorded snapshot and said `source: "none"` otherwise, push ran
// admission and returned "a live backend is required to publish (WP-11)", and T4 recorded
// a page without touching one. WP-11 was the gate holding all three back, so this is the
// one place that speaks HTTP to Shesha and every caller shares it.
//
// Three rules the callers depend on:
//   1. No fabrication. Every function returns `{ok:false, reason}` on failure; none of
//      them returns an empty success. An empty properties[] with `ok:true` would be a
//      silent false pass in T3, which is the defect the snapshot design existed to avoid.
//   2. No credential ever reaches a committed file. The URL comes from .build/backend and
//      the secret from the environment or .build/backend-auth, both gitignored, and
//      neither is echoed into a return value, a log line or a snapshot.
//   3. No dependency. Node 22's global fetch, an AbortSignal timeout, and nothing else,
//      because packages/registry is L0 and may not grow a dependency for this.

import fs from 'node:fs';
import path from 'node:path';

/** Every request gets the same ceiling; a hung backend must not hang a gate. */
const TIMEOUT_MS = 20000;

/**
 * The backend URL this repository is pointed at, or null with the reason.
 * `.build/backend` is written by the operator (and by the session-start banner's probe);
 * it is deliberately not a committed file, because the URL is a property of the machine.
 * @param {string} root repo root
 * @returns {{url:string|null, reason:string}}
 */
export function resolveBackend(root) {
  const envUrl = process.env.SHESHA_BACKEND;
  if (envUrl && /^https?:\/\//.test(envUrl)) return { url: envUrl.replace(/\/$/, ''), reason: '' };
  const p = path.join(root, '.build/backend');
  let text = '';
  try { text = fs.readFileSync(p, 'utf8').trim(); } catch {
    return { url: null, reason: 'no backend configured: set SHESHA_BACKEND or write the URL to .build/backend' };
  }
  if (!/^https?:\/\//.test(text)) return { url: null, reason: `.build/backend does not hold an http(s) URL: ${text.slice(0, 40)}` };
  return { url: text.replace(/\/$/, ''), reason: '' };
}

/**
 * Credentials, from the environment first and then .build/backend-auth. A token is used
 * as-is; a user/password pair is exchanged for one by authenticate().
 * @param {string} root
 * @returns {{token:string|null, user:string|null, password:string|null, reason:string}}
 */
export function resolveCredentials(root) {
  const none = { token: null, user: null, password: null };
  if (process.env.SHESHA_TOKEN) return { ...none, token: process.env.SHESHA_TOKEN, reason: '' };
  if (process.env.SHESHA_USER && process.env.SHESHA_PASSWORD) {
    return { ...none, user: process.env.SHESHA_USER, password: process.env.SHESHA_PASSWORD, reason: '' };
  }
  let raw = '';
  try { raw = fs.readFileSync(path.join(root, '.build/backend-auth'), 'utf8'); } catch {
    return { ...none, reason: 'no credentials: set SHESHA_TOKEN, or SHESHA_USER + SHESHA_PASSWORD, or write {"user","password"} to .build/backend-auth' };
  }
  let j = null;
  try { j = JSON.parse(raw); } catch { return { ...none, reason: '.build/backend-auth is not JSON' }; }
  if (typeof j.token === 'string' && j.token) return { ...none, token: j.token, reason: '' };
  if (typeof j.user === 'string' && typeof j.password === 'string') return { ...none, user: j.user, password: j.password, reason: '' };
  return { ...none, reason: '.build/backend-auth has neither a token nor a user/password pair' };
}

/**
 * One HTTP call. Returns the status and the parsed body, or ok:false with a reason; it
 * never throws, because a caller that has to try/catch a transport ends up treating a
 * network error as an empty result.
 * @param {{url:string, route:string, token?:string|null, method?:string, body?:any}} a
 * @returns {Promise<{ok:boolean, status:number, body:any, reason:string}>}
 */
export async function call(a) {
  const method = a.method || 'GET';
  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  if (a.token) headers.Authorization = `Bearer ${a.token}`;
  if (a.body !== undefined) headers['Content-Type'] = 'application/json';
  let res = null;
  try {
    res = await fetch(`${a.url}${a.route}`, {
      method,
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e).split('\n')[0];
    return { ok: false, status: 0, body: null, reason: `${method} ${a.route} did not complete: ${msg}` };
  }
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {
    // A Shesha instance answers HTML for an unauthenticated route; saying so beats
    // reporting a parse error against a body the caller never sees.
    return { ok: false, status: res.status, body: null, reason: `${method} ${a.route} answered ${res.status} with non-JSON (${text.slice(0, 60).replace(/\s+/g, ' ')})` };
  }
  if (!res.ok) {
    const detail = body && body.error && body.error.message ? `: ${body.error.message}` : '';
    return { ok: false, status: res.status, body, reason: `${method} ${a.route} answered ${res.status}${detail}` };
  }
  return { ok: true, status: res.status, body, reason: '' };
}

/**
 * Exchange credentials for a bearer token.
 * @param {{url:string, user:string, password:string}} a
 * @returns {Promise<{ok:boolean, token:string|null, reason:string}>}
 */
export async function authenticate(a) {
  const r = await call({
    url: a.url,
    route: '/api/TokenAuth/Authenticate',
    method: 'POST',
    body: { userNameOrEmailAddress: a.user, password: a.password, rememberClient: true },
  });
  if (!r.ok) return { ok: false, token: null, reason: r.reason };
  const token = r.body && r.body.result && r.body.result.accessToken;
  if (typeof token !== 'string' || !token) return { ok: false, token: null, reason: 'Authenticate answered 200 with no accessToken' };
  return { ok: true, token, reason: '' };
}

/**
 * A ready-to-use session: URL plus token, resolved from configuration. Callers that get
 * `ok:false` degrade to uninspectable and print the reason; none of them may treat it as
 * an absent problem.
 * @param {string} root
 * @returns {Promise<{ok:boolean, url:string|null, token:string|null, reason:string}>}
 */
export async function session(root) {
  const { url, reason } = resolveBackend(root);
  if (!url) return { ok: false, url: null, token: null, reason };
  const cred = resolveCredentials(root);
  if (cred.token) return { ok: true, url, token: cred.token, reason: '' };
  if (!cred.user || !cred.password) return { ok: false, url, token: null, reason: cred.reason };
  const auth = await authenticate({ url, user: cred.user, password: cred.password });
  if (!auth.ok) return { ok: false, url, token: null, reason: auth.reason };
  return { ok: true, url, token: auth.token, reason: '' };
}

/**
 * Entity properties as the backend spells them (PascalCase paths). The shape returned is
 * the shape the recorded snapshots already use, so T3 cannot tell a live read from a
 * replayed one - which is the point: the tier has one code path, not two.
 * @param {{url:string, token:string|null, entityType:string}} a
 * @returns {Promise<{ok:boolean, properties:{path:string, dataType:string, required:boolean, readonly?:boolean, referenceListName?:string, referenceListModule?:string}[], reason:string}>}
 */
export async function entityProperties(a) {
  const r = await call({ url: a.url, token: a.token, route: `/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(a.entityType)}` });
  if (!r.ok) return { ok: false, properties: [], reason: r.reason };
  const raw = r.body && Array.isArray(r.body.result) ? r.body.result : null;
  if (!raw) return { ok: false, properties: [], reason: `GetProperties answered ${r.status} with no result array for ${a.entityType}` };
  if (raw.length === 0) {
    // An entity with zero properties is not a readable entity; reporting it as a
    // successful empty read is the false pass this module refuses to produce.
    return { ok: false, properties: [], reason: `${a.entityType} resolved with 0 properties - it is not a registered entity on this backend` };
  }
  const properties = raw.map((/** @type {any} */ p) => {
    /** @type {any} */
    const out = { path: String(p.path), dataType: String(p.dataType), required: p.required === true };
    if (p.readonly === true) out.readonly = true;
    if (typeof p.referenceListName === 'string' && p.referenceListName) out.referenceListName = p.referenceListName;
    if (typeof p.referenceListModule === 'string' && p.referenceListModule) out.referenceListModule = p.referenceListModule;
    return out;
  });
  return { ok: true, properties, reason: '' };
}

/**
 * The dynamic CRUD route for an entity. Shesha mounts it at
 * /api/dynamic/<module>/<entity>/Crud/<op> - the MODULE name and the entity's SHORT name,
 * which is not derivable from the class name in general (boxfusion.test.Domain.Test.Thing
 * lives under a module named in its registration, not under "boxfusion"). Callers pass
 * both; the derivation below is a documented convenience for the Shesha.Domain.* case
 * and returns null rather than guessing for anything else.
 * @param {string} entityType a full class name
 * @returns {{module:string, entity:string}|null}
 */
export function crudRouteFor(entityType) {
  const m = /^Shesha\.Domain\.([A-Za-z0-9_]+)$/.exec(String(entityType));
  return m && m[1] ? { module: 'Shesha', entity: m[1] } : null;
}

/**
 * One record by id, through the dynamic CRUD surface. T4 asserts a consequence against
 * this, never against a toast.
 * @param {{url:string, token:string|null, module:string, entity:string, id:string, properties?:string}} a
 * @returns {Promise<{ok:boolean, record:any, reason:string}>}
 */
export async function entityRecord(a) {
  const qs = new URLSearchParams({ id: a.id });
  if (a.properties) qs.set('properties', a.properties);
  const route = `/api/dynamic/${a.module}/${a.entity}/Crud/Get?${qs.toString()}`;
  const r = await call({ url: a.url, token: a.token, route });
  if (!r.ok) return { ok: false, record: null, reason: r.reason };
  const rec = r.body && 'result' in r.body ? r.body.result : r.body;
  if (rec === null || rec === undefined) return { ok: false, record: null, reason: `no record at ${route}` };
  return { ok: true, record: rec, reason: '' };
}

/**
 * A page of records. Used to verify a consequence when the action did not hand back an
 * id, and by the envelope work that needs a real backend export.
 * @param {{url:string, token:string|null, module:string, entity:string, properties?:string, max?:number}} a
 * @returns {Promise<{ok:boolean, items:any[], totalCount:number, reason:string}>}
 */
export async function entityList(a) {
  const qs = new URLSearchParams({ maxResultCount: String(a.max ?? 10) });
  if (a.properties) qs.set('properties', a.properties);
  const route = `/api/dynamic/${a.module}/${a.entity}/Crud/GetAll?${qs.toString()}`;
  const r = await call({ url: a.url, token: a.token, route });
  if (!r.ok) return { ok: false, items: [], totalCount: 0, reason: r.reason };
  const result = r.body && r.body.result;
  const items = result && Array.isArray(result.items) ? result.items : (Array.isArray(result) ? result : null);
  if (!items) return { ok: false, items: [], totalCount: 0, reason: `${route} answered with no items array` };
  return { ok: true, items, totalCount: typeof result.totalCount === 'number' ? result.totalCount : items.length, reason: '' };
}
