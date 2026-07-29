/**
 * Deterministic id minting for compile-spec's own tree-shaped-but-not-walked
 * structures: buttonGroup `items[]` and datatable/childTable column
 * definitions. `walk.mjs`'s `flatten()` never visits these (they carry no
 * top-level `type` key — see tier1.mjs's ITEMS_PATH_RE comment), so
 * `normalize-form.mjs`'s Phase B id-minting never reaches them either;
 * compile-spec must mint their ids itself.
 *
 * Same construction as normalize-form.mjs's own deterministicUuid (sha256 of
 * a stable seed string, version/variant nibbles patched in) so a re-compile
 * of the SAME blueprint always mints the SAME ids (determinism) and ids never
 * collide across a single compile (seed always includes the full path).
 * Not exported from normalize-form.mjs, so reimplemented here rather than
 * imported — see the task brief's "do not modify normalize-form.mjs" rule.
 */
import { createHash } from 'node:crypto';

export function deterministicId(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  const variants = '89ab';
  hex[16] = variants[parseInt(hex[16], 16) % 4];
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
