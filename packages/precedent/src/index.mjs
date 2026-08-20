// @shesha/precedent — Index A: shape-indexed precedent retrieval (§4.7, BL-009).
//
// The Planner asks "what past form is shaped like the one I am about to build?" and
// adapts the nearest known-good spec rather than inventing one — that is what makes a
// 768-byte spec reliable, and it compounds as every accepted screen enlarges the index.
//
// RAG lives here and ONLY here (§4.7.1): retrieval is never a correctness lookup — a
// props/versions/enums question gets an EXACT answer from the registry, never a nearest
// neighbour. g-rag-isolation enforces that the compiler and verifier never import this
// package. Index A is deterministic shape similarity (shape.mjs); the embedding index
// (Index B, Float32Array .bin) is BL-H1 and ships no behaviour here — a request for
// `method:"embedding"` degrades to shape and sets `degraded`, never a silent empty.
//
// Storage is one gitignored JSONL file (no database): node:sqlite is rejected because
// on the pinned Node 22 it needs --experimental-sqlite and an unflagged import throws
// ERR_UNKNOWN_BUILTIN_MODULE, so a store built on it would not load.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeOf, similarityCached, topoTrigrams } from './shape.mjs';

export const PRECEDENT_API_VERSION = '1.0.0';
export { shapeOf, similarity } from './shape.mjs';

/**
 * The cached topology trigram set of an index entry. Attached non-enumerably so it is
 * invisible to JSON.stringify (writeIndex) and assert.deepEqual (round-trip), and
 * computed at most once per entry — a read-back index computes it lazily on first scan.
 * @param {IndexEntry} e @returns {Set<string>}
 */
function entryTrigrams(e) {
  const cached = /** @type {any} */ (e).__trg;
  if (cached) return cached;
  const trg = topoTrigrams(e.shape);
  Object.defineProperty(e, '__trg', { value: trg, enumerable: false, configurable: true });
  return trg;
}

/** Retrieval over an empty index is a defect, not a valid empty answer (§4.7.2). */
export class EmptyIndexError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'EmptyIndexError'; this.code = 'E_EMPTY_INDEX'; }
}

/**
 * @typedef {import('./shape.mjs').Shape} Shape
 * @typedef {{sfsPath:string, shape:Shape}} IndexEntry
 */

/**
 * Build an in-memory index from `{sfsPath, form}` entries by shaping each form.
 * @param {{sfsPath:string, form:any}[]} entries
 * @returns {IndexEntry[]}
 */
export function buildIndex(entries) {
  return entries.map((e) => {
    const entry = { sfsPath: e.sfsPath, shape: shapeOf(e.form) };
    entryTrigrams(entry); // precompute now, outside any later scan's timed path
    return entry;
  });
}

/**
 * Index every *.json form file under a directory (the corpus is compiled markup).
 * @param {string} dir absolute or cwd-relative
 * @returns {IndexEntry[]}
 */
export function indexDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  /** @type {IndexEntry[]} */
  const out = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '');
    /** @type {any} */
    let form;
    try { form = JSON.parse(raw); } catch { continue; }
    // A corpus record may be an ABP envelope carrying stringified Markup, or bare markup.
    if (form && typeof form.Markup === 'string') { try { form = JSON.parse(form.Markup); } catch { /* keep envelope */ } }
    out.push({ sfsPath: `${path.basename(dir)}/${f}`, shape: shapeOf(form) });
  }
  return out;
}

/**
 * Serialise an index to JSONL (one entry per line) and return the byte count.
 * @param {IndexEntry[]} index @param {string} file
 * @returns {number}
 */
export function writeIndex(index, file) {
  const body = `${index.map((e) => JSON.stringify(e)).join('\n')}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return Buffer.byteLength(body, 'utf8');
}

/**
 * Read a JSONL index. A blank file yields an empty index (the caller decides whether
 * that is a defect — search() refuses to run over one).
 * @param {string} file
 * @returns {IndexEntry[]}
 */
export function readIndex(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

/**
 * The shape a query descriptor resolves to: a full `form`, a precomputed `shape`, or a
 * partial descriptor ({kind, componentTypes, regions, hasTabs}).
 * @param {any} query
 * @returns {Shape}
 */
function queryShape(query) {
  if (query && query.shape) return query.shape;
  if (query && query.form) return shapeOf(query.form);
  /** @type {Record<string, number>} */
  const nodeMultiset = {};
  for (const t of (query && query.componentTypes) || []) nodeMultiset[t] = (nodeMultiset[t] || 0) + 1;
  return {
    kind: (query && query.kind) || 'list',
    archetype: (query && query.archetype) || '',
    entityDepth: 0,
    nodeMultiset,
    regionTopology: ((query && query.regions) || []).join(','),
    columnCount: 0,
    actionIntents: [],
    hasTabs: !!(query && query.hasTabs),
    responsiveShape: '',
    escapeCount: 0,
  };
}

/**
 * Rank the index by shape similarity to the query and return the top `k`.
 * @param {any} query `{form}` | `{shape}` | `{kind?, componentTypes?, regions?, ...}`, optional `k`, `method`
 * @param {IndexEntry[]} index
 * @returns {{method:string, results:{sfsPath:string, score:number, method:string}[], corpusSize:number, indexedAt:string|null, degraded?:boolean}}
 */
export function search(query, index) {
  if (!Array.isArray(index) || index.length === 0) {
    throw new EmptyIndexError('E_EMPTY_INDEX: precedent search over an empty index is a defect, not an empty answer (§4.7.2)');
  }
  const k = query && Number.isInteger(query.k) && query.k > 0 ? query.k : 3;
  // Index A only answers shape; a request for embedding degrades to shape, never empty.
  const degraded = query && query.method === 'embedding';
  const qs = queryShape(query);
  const qTrg = topoTrigrams(qs); // once per scan, not once per corpus row
  const ranked = index
    .map((e) => ({ sfsPath: e.sfsPath, score: Number(similarityCached(qs, qTrg, e.shape, entryTrigrams(e)).toFixed(6)), method: 'shape' }))
    .sort((a, b) => (b.score - a.score) || a.sfsPath.localeCompare(b.sfsPath))
    .slice(0, k);
  return { method: 'shape', results: ranked, corpusSize: index.length, indexedAt: null, ...(degraded ? { degraded: true } : {}) };
}

/**
 * The scaffold's `retrieve` export, now backed by the shape index: build from the
 * corpus dir and search in one call. `opts.corpus` defaults to packages/sfs/corpus.
 * @param {any} query
 * @param {{corpus?:string}} [opts]
 * @returns {ReturnType<typeof search>}
 */
export function retrieve(query, opts = {}) {
  const corpus = opts.corpus || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'sfs', 'corpus');
  return search(query, indexDir(corpus));
}
