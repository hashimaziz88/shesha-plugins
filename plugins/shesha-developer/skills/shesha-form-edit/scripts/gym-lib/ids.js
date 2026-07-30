// Deterministic ids for gym artifacts. Same inputs → same uuid, so regenerated
// gym forms diff cleanly across reruns.
import { createHash } from 'node:crypto';

export function gymUuid(...parts) {
  const digest = createHash('sha1').update(['gym', ...parts].join('|')).digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function shortHash(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 8);
}

export function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

// Stable stringify: sorted keys at every level so file output is deterministic.
export function stableStringify(value, indent = 2) {
  return JSON.stringify(sortValue(value), null, indent);
}

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}
