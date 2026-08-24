// The one reader for packages/registry/data/**. Loaded once per compile and passed
// through `ctx`, so a stage can never reach for the filesystem mid-tree and no
// module imports a .json file directly (a .json import is a hard gate failure).
//
// Every lookup that misses throws a domain error with the registry path that would
// have to be extended. A silent default here would be the compiler inventing a
// version integer, which is exactly what the registry exists to prevent.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** The pinned data directory. WP-2 adds sibling versions; the ref is never guessed. */
export const REGISTRY_REF = '0.45.1';

/** The five data files a compile's bytes depend on, for a given brand. @param {string} brand */
function fingerprintFiles(brand) {
  return ['actions.json', 'components.json', 'form-settings.json', 'tokens/roles.json', `tokens/${brand}.json`].sort();
}

/**
 * A content fingerprint of the registry a compile depends on (§4.3.8). CRLF/BOM are
 * normalised so it never drifts on a Windows checkout (the autocrlf gotcha). Both the
 * markup-provenance fixture generator and g-markup-provenance call this, against their
 * own root, so a staged copy and the real tree agree.
 * @param {string} [root] @param {string} [brand] @returns {string}
 */
export function registryFingerprint(root, brand = 'shesha') {
  const base = path.join(root ?? repoRoot(), 'packages/registry/data', REGISTRY_REF);
  const h = createHash('sha256');
  for (const rel of fingerprintFiles(brand)) {
    h.update(`${rel}\0`);
    h.update(fs.readFileSync(path.join(base, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex');
}

export class RegistryError extends Error {
  /** @param {string} code @param {string} m */
  constructor(code, m) { super(m); this.name = 'RegistryError'; this.code = code; }
}

/** @returns {string} the repo root, resolved from this file */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

/**
 * @param {string} rel path under packages/registry/data/<ref>/
 * @returns {unknown}
 */
function readData(rel) {
  const file = path.join(repoRoot(), 'packages/registry/data', REGISTRY_REF, rel);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch {
    throw new RegistryError('REG-2001', `REG-2001 registry file missing: packages/registry/data/${REGISTRY_REF}/${rel}`);
  }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    throw new RegistryError('REG-2002', `REG-2002 registry file is not valid JSON: ${rel} — ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * @typedef {{version:number, sfsNode:string|null, sfsNodeAlso?:string[], authorable:boolean,
 *            isInput:boolean, childrenKey:string|null, itemsKey?:string, slots?:string[],
 *            breakpointBlocks:boolean, breakpointChannels:string[], legacyStyleProps:string[],
 *            defaults:Record<string, unknown>, dimensionDefaults?:Record<string, string>,
 *            editModeChannel?:string|null,
 *            reason?:string, decision?:string}} ComponentRecord
 * @typedef {{ref:string, components:Record<string, ComponentRecord>, datatypeMap:Record<string, {component:string, props:Record<string, unknown>}>,
 *            nodeToType:Map<string, string>, formSettings:any, actions:any, tokens:any, roles:any,
 *            contentHash:string}} Registry
 */

/**
 * Load the whole registry for one brand.
 * @param {string} [brand]
 * @returns {Registry}
 */
export function loadRegistry(brand = 'shesha') {
  const comps = /** @type {{components:Record<string, ComponentRecord>, _datatypeMap:Record<string, {component:string, props:Record<string, unknown>}>}} */ (readData('components.json'));
  const formSettings = readData('form-settings.json');
  const actions = readData('actions.json');
  const tokens = readData(`tokens/${brand}.json`);
  const roles = readData('tokens/roles.json');

  // The reverse map is GENERATED, never a second hand-written table (D-083): a
  // hand-written reverse map is the standard way two directions drift apart.
  /** @type {Map<string, string>} */
  const nodeToType = new Map();
  for (const [type, rec] of Object.entries(comps.components)) {
    for (const node of [rec.sfsNode, ...(rec.sfsNodeAlso || [])]) {
      if (node === null || node === undefined) continue;
      if (!nodeToType.has(node)) nodeToType.set(node, type);
    }
  }

  return {
    ref: REGISTRY_REF,
    components: comps.components,
    datatypeMap: comps._datatypeMap,
    nodeToType,
    formSettings,
    actions,
    tokens,
    roles,
    contentHash: '',
  };
}

/**
 * The component record for one SFS node kind. `row` and `col` share `container`
 * and are told apart by `flexDirection`, which s4 sets — not by two records.
 * @param {Registry} reg
 * @param {string} node
 * @returns {{type:string, record:ComponentRecord}}
 */
export function recordForNode(reg, node) {
  const type = reg.nodeToType.get(node);
  if (type === undefined) {
    throw new RegistryError('REG-2101',
      `REG-2101 no component type is mapped to SFS node "${node}". `
      + `Add an sfsNode to a record in packages/registry/data/${REGISTRY_REF}/components.json`);
  }
  // `type` came from nodeToType, which only maps to types that have a record; the cast
  // preserves the original runtime behaviour (a missing record would still throw below).
  const record = /** @type {ComponentRecord} */ (reg.components[type]);
  if (record.authorable === false) {
    throw new RegistryError('SFS-1004',
      `SFS-1004 "${type}" is authorable:false — ${record.reason || 'no reason recorded'} (${record.decision || 'no decision'}). `
      + 'Use node:"row" with responsive.fixed');
  }
  return { type, record };
}

/**
 * @param {Registry} reg
 * @param {string} type
 * @returns {number}
 */
export function versionFor(reg, type) {
  const rec = reg.components[type];
  if (rec === undefined || typeof rec.version !== 'number') {
    throw new RegistryError('STM-5201',
      `STM-5201 no registry version for authorable type "${type}"; the compiler never invents a version integer`);
  }
  return rec.version;
}
