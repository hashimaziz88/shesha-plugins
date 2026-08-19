// The registry read API the verifier ladder stands on (§3.2.2/§3.2.3: `load(ref)`).
//
// Section 2's compiler has its OWN reader at packages/sfs/src/lib/registry.mjs (L1),
// shaped for stamping markup. This is the L0 view the tiers (L3) read: the same
// data/<ref>/*.json files, exposed as the shapes T1/T2 assert against. The DATA is
// single-source (packages/registry/data/**); two readers of one data set is not two
// sources of truth. registry has zero external dependencies, so node:fs only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pinned data directory. Sibling refs are added, never guessed. */
export const DEFAULT_REF = '0.45.1';

export class RegistryLoadError extends Error {
  /** @param {string} code @param {string} m */
  constructor(code, m) { super(m); this.name = 'RegistryLoadError'; this.code = code; }
}

/** @returns {string} repo root, resolved from this file (packages/registry/src/load.mjs) */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * @param {string} ref
 * @param {string} rel path under packages/registry/data/<ref>/
 * @returns {any}
 */
function readData(ref, rel) {
  const file = path.join(repoRoot(), 'packages/registry/data', ref, rel);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch {
    throw new RegistryLoadError('REG-2001', `REG-2001 registry file missing: packages/registry/data/${ref}/${rel}`);
  }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    throw new RegistryLoadError('REG-2002', `REG-2002 registry file is not valid JSON: ${rel} — ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * @param {string} rel path under packages/registry/config/
 * @returns {any}
 */
function readConfig(rel) {
  const file = path.join(repoRoot(), 'packages/registry/config', rel);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch {
    throw new RegistryLoadError('REG-2001', `REG-2001 registry config missing: packages/registry/config/${rel}`);
  }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    throw new RegistryLoadError('REG-2002', `REG-2002 registry config is not valid JSON: ${rel} — ${/** @type {Error} */ (e).message}`);
  }
}

/** The keys every component carries regardless of type; legal everywhere (T2.04). */
export const STRUCTURAL_KEYS = ['id', 'type', 'parentId', 'version', 'componentName'];

/**
 * @typedef {{key:string, shape:'array'|'single', note?:string}} SlotChannel
 * @typedef {{key:string, scope:string, decision?:string, reason?:string}} DenyProp
 * @typedef {{ref:string, components:Record<string, any>, slots:SlotChannel[],
 *            priorityTypes:string[], requiredProps:Record<string, string[]>,
 *            deny:{props:DenyProp[], conditional:any[]}, formSettings:any, actions:any,
 *            itemSchemas:Record<string, any>}} LoadedRegistry
 */

/**
 * Load the registry read-view for one ref. Additive: the tiers extend the returned
 * shape as their checks need it; every field is a projection of the committed data.
 * @param {string} [ref]
 * @returns {LoadedRegistry}
 */
export function load(ref = DEFAULT_REF) {
  const comps = readData(ref, 'components.json');
  const slotsFile = readData(ref, 'slots.json');
  const channels = /** @type {SlotChannel[]} */ (slotsFile.channels || []);
  if (channels.length === 0) {
    throw new RegistryLoadError('REG-2003', `REG-2003 slots.json for ${ref} declares no channels; the tree walker would reach only top-level components`);
  }
  const ratchet = readConfig('registry-ratchet.json');
  const priorityTypes = /** @type {string[]} */ (ratchet.priority || []);
  const requiredProps = /** @type {Record<string, string[]>} */ (readData(ref, 'required-props.json').byType || {});
  const deny = readData(ref, 'deny.json');
  return {
    ref,
    components: comps.components || {},
    slots: channels,
    priorityTypes,
    requiredProps,
    deny: { props: deny.props || [], conditional: deny.conditional || [] },
    formSettings: readData(ref, 'form-settings.json'),
    actions: readData(ref, 'actions.json'),
    itemSchemas: comps._itemSchemas || {},
  };
}
