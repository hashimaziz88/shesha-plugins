// resolve-bindings-offline.mjs — property → binding facts, at COMPILE time.
//
// The offline half of binding resolution: it answers "what component does this property
// want" and "what reference list is it" from the blueprint's own bindings plus, when a
// backend is reachable, live Metadata/GetProperties. It never GUESSES an identity
// [R-015] — an unresolved reference list is left for the caller-run resolve-bindings.js
// gate, which has the live backend the compiler may not.

import { GymApi } from '../gym-lib/api.js';

/** a property name that reads as a reference-list lifecycle (status / state / stage,
 *  plain or suffixed). The same expression validate-styledness uses, so the compiler
 *  and that gate agree by construction. */
export const STATUS_PROP = /(^|[a-z])(status|state|stage)$/;

export function titleCase(prop) {
  return String(prop).split('.').pop()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

const BY_DATATYPE = {
  string: 'textField', guid: 'textField', 'string-multiline': 'textArea', text: 'textArea',
  number: 'numberField', float: 'numberField', int64: 'numberField',
  date: 'dateField', 'date-time': 'dateField', time: 'timePicker', boolean: 'checkbox',
  'reference-list-item': 'dropdown', entity: 'autocomplete',
};

/**
 * Live entity metadata, or null. A credentials/config failure is the caller's to fix, so
 * it throws with one readable line instead of a stack.
 * @returns {Promise<Map<string, object>|null>} lower-cased property path → metadata row
 */
export async function fetchMetadata(bp, { backend, tokenFile } = {}) {
  const api = new GymApi(backend, { tokenFile });
  try { await api.authenticate(); }
  catch (err) { throw new Error(`auth against ${api.baseUrl} failed: ${err.message}`); }
  const { ok, body } = await api.getJson(
    `/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(bp.entity.fullClassName)}`);
  const rows = Array.isArray(body?.result) ? body.result : null;
  if (!ok || !rows) return null;
  const map = new Map();
  for (const p of rows) if (p?.path) map.set(String(p.path).toLowerCase(), p);
  return map;
}

/** The binding facts the emitters ask for. `meta` may be null (offline compile). */
export function createBindings(bp, meta = null) {
  const index = new Map((bp.bindings ?? []).map((b) => [b.property, b]));
  const live = (prop) => (prop ? meta?.get(String(prop).toLowerCase()) : undefined);

  return {
    hasMetadata: Boolean(meta),
    get: (prop) => index.get(prop) ?? {},
    live,

    /** the component type for a field node: authored > binding > datatype > heuristic */
    componentFor(node) {
      const b = index.get(node.property) ?? {};
      const explicit = node.component ?? b.component;
      if (explicit) return explicit;
      const dt = b.datatype ?? live(String(node.property).split('.')[0])?.dataType;
      if (dt) return BY_DATATYPE[dt] ?? 'textField';
      // A status/state/stage property is a LIFECYCLE, never free text: without live
      // metadata the plain 'string' default used to compile it to a textField, throwing
      // the lifecycle away — exactly what validate-styledness' status-as-text check FAILs.
      return STATUS_PROP.test(String(node.property)) ? 'dropdown' : 'textField';
    },

    label: (node) => index.get(node.property)?.label ?? node.title ?? titleCase(node.property),

    /** a reference-list identity: live metadata first, else the blueprint binding [R-015] */
    reflistIdentity(prop) {
      if (!prop) return null;
      const p = live(prop);
      if (p?.referenceListName) {
        return { property: prop, module: p.referenceListModule ?? null, name: p.referenceListName.split('.').pop() };
      }
      const b = index.get(prop);
      if (b?.referenceList?.name) {
        return { property: prop, module: b.referenceList.module ?? null, name: b.referenceList.name.split('.').pop() };
      }
      return null;
    },

    entityIdentity(prop) {
      const p = live(prop);
      return p?.entityType ? { entityType: p.entityType } : null;
    },

    /** the first bound property that reads as a lifecycle — the page's status, if any */
    statusProperty() {
      for (const b of bp.bindings ?? []) {
        if (b.property && STATUS_PROP.test(String(b.property))) return b.property;
      }
      return null;
    },
  };
}
