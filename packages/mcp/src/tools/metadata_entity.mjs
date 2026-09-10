// metadata_entity — entity metadata from the live backend or a cache. With no backend in
// the session, source is "none" and every consumer marks the binding uninspectable; it
// NEVER returns empty properties[] with source:"live" (that would be a silent false pass).
//
// WP-13 gave "the live backend" an implementation. The order is: a recorded snapshot is
// authoritative unless `refresh` is asked for, because a compile that changes answer
// between runs is not reproducible; `refresh: true` reads the backend, records the
// snapshot it read, and reports source "live". One rule covers every failure: fall back to
// the recorded snapshot when there is one and NAME the failure in `reason`, otherwise
// report source "none" with the reason. A stale answer is legitimate; silence about its
// staleness is not, and an empty success is never produced at all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, entityProperties } from '@shesha/registry/backend';
import { record } from '@shesha/registry/record-metadata';

export const name = 'metadata_entity';
export const summary = 'Resolve entity metadata (properties, reflists) from the live backend or the recorded cache.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entity'],
  properties: {
    entity: { type: 'string' },
    refresh: { type: 'boolean' },
  },
};

function repoRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); }

/**
 * The recorded snapshot for an entity, or null. A snapshot keyed by model type (the shape
 * record-metadata writes) is read by key; the older per-screen fixtures carry one entity
 * each, so a single-entity document answers for its own entity too.
 * @param {string} root @param {string} entity
 * @returns {{modelType:string, properties:any[], refLists:any[], cachedAt:string|null}|null}
 */
function fromSnapshot(root, entity) {
  const base = entity.split('.').pop() || entity;
  const dir = path.join(root, 'packages/sfs/test/fixtures/metadata');
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.metadata.json')); } catch { return null; }
  for (const n of [`${base}.metadata.json`, ...names]) {
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8').replace(/^﻿/, '')); } catch { continue; }
    const entities = doc && doc.entities;
    if (entities && typeof entities === 'object' && entities[entity] && Array.isArray(entities[entity].properties)) {
      return { modelType: entity, properties: entities[entity].properties, refLists: doc.referenceLists ? Object.values(doc.referenceLists) : [], cachedAt: doc.recordedAt ?? null };
    }
    // The pre-WP-13 fixture shape: properties at the top level for one screen's entity.
    if (doc && Array.isArray(doc.properties) && (doc.modelType === entity || n === `${base}.metadata.json`)) {
      return { modelType: doc.modelType ?? entity, properties: doc.properties, refLists: doc.refLists ?? [], cachedAt: doc.cachedAt ?? doc.recordedAt ?? null };
    }
  }
  return null;
}

/** @param {any} input @returns {Promise<any>} */
export async function run(input = {}) {
  const entity = String(input.entity);
  const root = repoRoot();
  const wantLive = input.refresh === true;

  if (!wantLive) {
    const snap = fromSnapshot(root, entity);
    if (snap) return { entity, modelType: snap.modelType, source: 'cache', properties: snap.properties, refLists: snap.refLists, cachedAt: snap.cachedAt, reason: '' };
  }

  const s = await session(root);
  if (!s.ok || !s.url) {
    // No backend: fall back to whatever was recorded, and say so. An absent backend is
    // never an empty success - source "none" is what makes the binding uninspectable.
    const snap = wantLive ? fromSnapshot(root, entity) : null;
    if (snap) return { entity, modelType: snap.modelType, source: 'cache', properties: snap.properties, refLists: snap.refLists, cachedAt: snap.cachedAt, reason: `live read unavailable, answered from the recorded snapshot: ${s.reason}` };
    return { entity, modelType: entity, source: 'none', properties: [], refLists: [], cachedAt: null, reason: s.reason };
  }

  const live = await entityProperties({ url: s.url, token: s.token, entityType: entity });
  if (!live.ok) {
    const snap = fromSnapshot(root, entity);
    if (snap) return { entity, modelType: snap.modelType, source: 'cache', properties: snap.properties, refLists: snap.refLists, cachedAt: snap.cachedAt, reason: `live read failed, answered from the recorded snapshot: ${live.reason}` };
    return { entity, modelType: entity, source: 'none', properties: [], refLists: [], cachedAt: null, reason: live.reason };
  }

  // Record what was read, so the next offline run has the same substrate.
  const rec = await record({ root, screen: (entity.split('.').pop() || entity), entities: [entity] });
  return {
    entity,
    modelType: entity,
    source: 'live',
    properties: live.properties,
    refLists: [],
    cachedAt: rec.ok ? new Date().toISOString().slice(0, 10) : null,
    reason: rec.ok ? '' : `read live but could not record the snapshot: ${rec.reason}`,
  };
}
