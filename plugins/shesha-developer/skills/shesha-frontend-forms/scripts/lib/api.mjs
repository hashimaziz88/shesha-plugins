/**
 * The backend half of ground truth.
 *
 * ONE token idiom, defined once. The old stack rewrote its token read seven times,
 * escalating to `.Trim([char]0xFEFF,' ',"`r","`n")`, because a UTF-8 BOM in the cache
 * file yields "Current user did not login" and nobody fixed the write side. Node's
 * writeFileSync never emits a BOM; readCacheJson strips one defensively in case the
 * file was touched by a PowerShell redirect, which is how the BOM got there.
 *
 * Exit-code contract (raised as tagged errors, applied by shesha.mjs):
 *   3  backend unreachable / auth refused
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_BACKEND = 'http://localhost:21021';

export class BackendError extends Error {
  constructor(message, exitCode = 3, cause) {
    super(message);
    this.name = 'BackendError';
    this.exitCode = exitCode;
    if (cause) this.cause = cause;
  }
}

/** Strip a UTF-8 BOM if some other tool wrote one. The single place this is handled. */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function readCacheJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(path, 'utf8')));
  } catch {
    return null; // a corrupt cache is a cache miss, not a failure
  }
}

function writeCacheJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  // utf8, no BOM, LF-terminated.
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * Single fetch wrapper. Distinguishes three outcomes the old stack conflated:
 *   - transport failure      -> BackendError (exit 3)
 *   - HTTP error status      -> { ok:false, status } for the caller to decide
 *   - HTTP 200 with a null payload -> { ok:true, result:null, filtered:true }
 *
 * That last case is real: a permission-filtered read returns 200 with a null body,
 * not 403, so treating "200" as success silently yields empty ground truth.
 */
async function call(backend, path, { method = 'GET', token, body, timeoutMs = 30000 } = {}) {
  const url = `${backend.replace(/\/+$/, '')}${path}`;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (e && e.message) || String(e);
    throw new BackendError(
      `Cannot reach the Shesha backend at ${backend} (${method} ${path}): ${reason}\n` +
        `  Start the backend, or pass --backend <url>, or omit it to skip the live half.`,
      3,
      e
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(stripBom(text));
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: (payload && payload.error) || text.slice(0, 400) || null, path };
  }

  // ABP envelope: { success, result, error }
  const result = payload && Object.prototype.hasOwnProperty.call(payload, 'result') ? payload.result : payload;
  const abpFailed = payload && payload.success === false;
  if (abpFailed) {
    return { ok: false, status: res.status, error: (payload.error && payload.error.message) || 'ABP reported success:false', path };
  }

  return {
    ok: true,
    status: res.status,
    result,
    // 200 + null body is how a permission filter presents itself.
    filtered: result === null || result === undefined,
    path,
  };
}

/**
 * Authenticate and cache the bearer token, BOM-free, in the target app's .shesha dir.
 * Credentials come from flags or env; the Shesha dev seed is the documented default.
 * The token is never logged and the password is never written to disk.
 */
export async function getToken(backend, { cacheDir, user, password, force = false } = {}) {
  const username = user || process.env.SHESHA_USER || 'admin';
  const pass = password || process.env.SHESHA_PASSWORD || '123qwe';
  const cachePath = cacheDir ? join(cacheDir, 'token.json') : null;

  if (!force && cachePath) {
    const cached = readCacheJson(cachePath);
    if (cached && cached.token && cached.backend === backend && cached.expiresAt > Date.now() + 60000) {
      return cached.token;
    }
  }

  // NOTE the path. TokenAuth is NOT under /api/services/app/ — it is mounted at
  // /api/TokenAuth/Authenticate. Verified against this app's own per-service swagger
  // (swagger/service:TokenAuth/swagger.json). Every other service used here IS under
  // /api/services/app/. The brief had this wrong and it returns 404, which reads as
  // "backend down" rather than "wrong route" unless you check.
  const res = await call(backend, '/api/TokenAuth/Authenticate', {
    method: 'POST',
    body: { userNameOrEmailAddress: username, password: pass, rememberClient: true },
  });

  if (!res.ok) {
    throw new BackendError(
      `Authentication failed at ${backend} as "${username}" (HTTP ${res.status}). ` +
        `${res.error || ''}\n  Set SHESHA_USER / SHESHA_PASSWORD, or pass --user / --password.`,
      3
    );
  }
  const token = res.result && (res.result.accessToken || res.result.access_token);
  if (!token) {
    throw new BackendError(`Authenticate returned 200 but no accessToken. Payload keys: ${Object.keys(res.result || {}).join(', ') || '(none)'}`, 3);
  }

  if (cachePath) {
    const ttlSec = Number(res.result.expireInSeconds) || 3600;
    writeCacheJson(cachePath, {
      backend,
      username,
      token,
      expiresAt: Date.now() + ttlSec * 1000,
      // Deliberately no password field.
    });
  }
  return token;
}

/**
 * Reference-list items.
 *
 * There is NO ReferenceList service in a 0.45 backend — checked against all 148
 * services this app publishes. Reference lists are configuration items, and their items
 * are ordinary entities, so they come through the generic dynamic CRUD endpoint
 * (Entities/GetAll over Shesha.Domain.ReferenceListItem).
 *
 * The candidate list is ordered by likelihood and the winner is RECORDED in ground truth
 * so later phases stop probing. Legacy routes are kept last so an older backend still
 * resolves rather than silently returning no items.
 */
const REFLIST_ITEM_PROPS = 'id,item,itemValue,description,color,icon,orderIndex';

const REFLIST_ENDPOINTS = [
  // Primary: generic dynamic CRUD, filtered by the parent list's name/module.
  (m, n) => {
    const filter = {
      and: [
        { '==': [{ var: 'referenceList.name' }, n] },
        ...(m ? [{ '==': [{ var: 'referenceList.module.name' }, m] }] : []),
      ],
    };
    const q = new URLSearchParams({
      entityType: 'Shesha.Domain.ReferenceListItem',
      properties: REFLIST_ITEM_PROPS,
      maxResultCount: '1000',
      sorting: 'orderIndex asc',
      filter: JSON.stringify(filter),
    });
    return `/api/services/app/Entities/GetAll?${q}`;
  },
  // Same, without the module predicate — some lists have no module set.
  (m, n) => {
    const q = new URLSearchParams({
      entityType: 'Shesha.Domain.ReferenceListItem',
      properties: REFLIST_ITEM_PROPS,
      maxResultCount: '1000',
      sorting: 'orderIndex asc',
      filter: JSON.stringify({ '==': [{ var: 'referenceList.name' }, n] }),
    });
    return `/api/services/app/Entities/GetAll?${q}`;
  },
  // Legacy 0.43-era routes, last.
  (m, n) => `/api/services/app/ReferenceList/GetItems?module=${encodeURIComponent(m || '')}&name=${encodeURIComponent(n)}`,
];

async function fetchRefList(backend, token, module, name, state) {
  const tryOrder = state.endpointIndex === null ? REFLIST_ENDPOINTS.map((_, i) => i) : [state.endpointIndex];
  for (const i of tryOrder) {
    const res = await call(backend, REFLIST_ENDPOINTS[i](module || '', name), { token });
    if (res.ok && !res.filtered) {
      const items = Array.isArray(res.result) ? res.result : res.result && res.result.items;
      // An endpoint that answers 200 with an empty set has not proven itself — a wrong
      // filter shape returns exactly that. Only lock in a candidate that returned rows.
      if (!Array.isArray(items) || items.length === 0) {
        if (state.endpointIndex === null) continue;
        return { items: [], error: null };
      }
      state.endpointIndex = i;
      state.endpointUsed = `[candidate ${i}] ${REFLIST_ENDPOINTS[i]('<module>', '<name>').split('?')[0]}`;
      return { items, error: null };
    }
  }
  return { items: [], error: 'no reference-list endpoint answered' };
}

/**
 * Collect the live half: modules, entities, per-entity property metadata, the reference
 * lists those properties point at, and the app theme setting.
 *
 * Nothing here is fatal except a total failure to reach the backend. Individual reads
 * that come back filtered or erroring are recorded with their status so the gaps are
 * visible rather than looking like an empty app.
 */
export async function deriveBackendTruth(backend, { cacheDir, user, password, maxEntities = 0, onProgress } = {}) {
  const notes = [];
  const token = await getToken(backend, { cacheDir, user, password });
  const say = (m) => onProgress && onProgress(m);

  say('reading modules');
  const modulesRes = await call(backend, '/api/services/app/ConfigurationStudio/GetModules', { token });
  if (!modulesRes.ok) notes.push(`GetModules failed: HTTP ${modulesRes.status} ${modulesRes.error || ''}`.trim());
  else if (modulesRes.filtered) notes.push('GetModules returned 200 with a null payload (permission-filtered)');
  // GetModules answers { modules: [{name, description, alias, isEditable}] } — an object,
  // not an array, and the entries carry NO id. So it cannot map a moduleId to a name.
  const moduleList = Array.isArray(modulesRes.result)
    ? modulesRes.result
    : modulesRes.result?.modules || modulesRes.result?.items || [];

  /**
   * The moduleId -> name map has to come from the CONFIGURATION TREE, not from GetModules.
   * A form node in the flat tree carries moduleId (a GUID) and its parent module appears in
   * the same tree as its own node, so fetching the tree unfiltered yields both. Without
   * this, GetItem answers HTTP 500 "Value cannot be null. (Parameter 'moduleName')" —
   * which reads like a server fault rather than a missing lookup.
   */
  say('reading the configuration tree for module ids');
  const treeRes = await call(backend, '/api/services/app/ConfigurationStudio/GetFlatTree', { token });
  const treeNodes = treeRes.ok ? treeRes.result?.nodes || treeRes.result || [] : [];
  const moduleIdToName = {};
  for (const n of Array.isArray(treeNodes) ? treeNodes : []) {
    // A module node names itself and is the parent of its items.
    if (n && n.id && n.name && (n.itemType === 'module' || n.nodeType === 1 || n.discriminator === 'module')) {
      moduleIdToName[n.id] = n.name;
    }
  }
  if (!treeRes.ok) notes.push(`GetFlatTree failed: HTTP ${treeRes.status} — moduleId lookups will be unavailable`);
  else if (Object.keys(moduleIdToName).length === 0) {
    notes.push('the configuration tree returned no module nodes, so moduleId cannot be resolved to a name');
  }

  say('reading entities');
  const entitiesRes = await call(backend, '/api/services/app/EntityConfig/GetMainDataList', { token });
  if (!entitiesRes.ok) notes.push(`GetMainDataList failed: HTTP ${entitiesRes.status} ${entitiesRes.error || ''}`.trim());
  else if (entitiesRes.filtered) notes.push('GetMainDataList returned 200 with a null payload (permission-filtered)');

  const rawEntities = (entitiesRes.ok && (entitiesRes.result?.items || entitiesRes.result)) || [];
  const entities = (Array.isArray(rawEntities) ? rawEntities : [])
    .map((e) => ({
      fullClassName: e.fullClassName || e.className || null,
      className: e.className || null,
      name: e.name || null,
      module: e.module || e.moduleName || null,
      label: e.label || e.friendlyName || null,
      source: e.source ?? null,
      entityConfigType: e.entityConfigType ?? null,
    }))
    .filter((e) => e.fullClassName);

  const targets = maxEntities > 0 ? entities.slice(0, maxEntities) : entities;

  const metadata = {};
  const refListState = { endpointIndex: null, endpointUsed: null };
  const referenceLists = {};
  // {dataType, dataFormat} pairs actually present in THIS app. This is the grid the
  // harness samples dataTypeSupported against, so the matcher is never probed with
  // combinations that do not occur here.
  const pairSet = new Set();

  let i = 0;
  for (const ent of targets) {
    i += 1;
    say(`metadata ${i}/${targets.length}: ${ent.fullClassName}`);
    const res = await call(
      backend,
      `/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(ent.fullClassName)}`,
      { token }
    );
    if (!res.ok) {
      metadata[ent.fullClassName] = { error: `HTTP ${res.status} ${res.error || ''}`.trim(), properties: [] };
      continue;
    }
    if (res.filtered) {
      metadata[ent.fullClassName] = { error: 'permission-filtered (200 with null payload)', properties: [] };
      continue;
    }
    const props = (Array.isArray(res.result) ? res.result : res.result?.items || []).map((p) => ({
      path: p.path ?? null,
      label: p.label ?? null,
      dataType: p.dataType ?? null,
      dataFormat: p.dataFormat ?? null,
      entityType: p.entityType ?? null,
      referenceListName: p.referenceListName ?? null,
      referenceListModule: p.referenceListModule ?? null,
      required: p.required ?? null,
      readonly: p.readonly ?? null,
      min: p.min ?? null,
      max: p.max ?? null,
      regExp: p.regExp ?? null,
      isVisible: p.isVisible ?? null,
    }));
    metadata[ent.fullClassName] = { error: null, properties: props };

    for (const p of props) {
      if (p.dataType) pairSet.add(JSON.stringify({ dataType: p.dataType, dataFormat: p.dataFormat ?? null }));
      if (p.referenceListName) {
        const key = `${p.referenceListModule || ''}/${p.referenceListName}`;
        if (!(key in referenceLists)) {
          const rl = await fetchRefList(backend, token, p.referenceListModule, p.referenceListName, refListState);
          referenceLists[key] = {
            module: p.referenceListModule || null,
            name: p.referenceListName,
            error: rl.error,
            items: rl.items.map((it) => ({
              itemValue: it.itemValue ?? it.value ?? null,
              item: it.item ?? it.text ?? null,
              description: it.description ?? null,
              // R-036: refListStatus fill comes ONLY from the item's own colour.
              color: it.color ?? null,
              icon: it.icon ?? null,
              orderIndex: it.orderIndex ?? null,
            })),
          };
        }
      }
    }
  }

  say('reading theme setting');
  const themeRes = await call(
    backend,
    `/api/services/app/Settings/GetValue?module=${encodeURIComponent('Shesha')}&name=${encodeURIComponent('Shesha.ThemeSettings')}`,
    { token }
  );
  let theme = null;
  if (!themeRes.ok) {
    notes.push(`Settings/GetValue for Shesha.ThemeSettings failed: HTTP ${themeRes.status} ${themeRes.error || ''}`.trim());
  } else {
    // The setting value arrives as a JSON string more often than as an object.
    theme = typeof themeRes.result === 'string' ? safeParse(themeRes.result) : themeRes.result;
  }

  const grid = Array.from(pairSet).map((s) => JSON.parse(s));

  return {
    backend,
    reachable: true,
    modules: moduleList,
    moduleIdToName,
    editableModules: moduleList.filter((m) => m && m.isEditable).map((m) => m.name),
    entities,
    entitiesProbed: targets.length,
    entitiesTotal: entities.length,
    metadata,
    referenceLists,
    referenceListEndpoint: refListState.endpointUsed,
    theme,
    // §3.4: IConfigurableTheme has no antd `token` channel. Recording what the live
    // setting actually carries is how a later phase can prove that boundary instead of
    // asserting it in prose.
    themeTopLevelKeys: theme && typeof theme === 'object' ? Object.keys(theme) : null,
    dataTypeGrid: grid,
    notes,
  };
}

function safeParse(s) {
  try {
    return JSON.parse(stripBom(s));
  } catch {
    return null;
  }
}

export { call as backendCall };
