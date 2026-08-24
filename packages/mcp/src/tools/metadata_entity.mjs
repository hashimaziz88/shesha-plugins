// metadata_entity — entity metadata from the live backend or a cache. With no backend in
// the session, source is "none" and every consumer marks the binding uninspectable; it
// NEVER returns empty properties[] with source:"live" (that would be a silent false pass).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** @param {any} input @returns {any} */
export function run(input = {}) {
  const entity = String(input.entity);
  // A recorded snapshot under packages/sfs/test/fixtures/metadata is the cache; no live
  // backend is contacted here (that is a WP-11 operator concern), so absent a snapshot the
  // source is "none" and the binding is uninspectable downstream.
  const base = entity.split('.').pop() || entity;
  const cachePath = path.join(repoRoot(), 'packages/sfs/test/fixtures/metadata', `${base}.metadata.json`);
  let snapshot = null;
  try { snapshot = JSON.parse(fs.readFileSync(cachePath, 'utf8').replace(/^﻿/, '')); } catch { snapshot = null; }
  if (!snapshot) return { entity, modelType: entity, source: 'none', properties: [], refLists: [], cachedAt: null };
  const properties = Array.isArray(snapshot.properties) ? snapshot.properties : (snapshot.result?.properties ?? []);
  return { entity, modelType: snapshot.modelType ?? entity, source: 'cache', properties, refLists: snapshot.refLists ?? [], cachedAt: snapshot.cachedAt ?? null };
}
