// Seeded id generation (§2.4.2, D-021).
//
// UUIDv5, not v4: v4 needs randomness and would make every compile produce a
// different form. v5 is a hash, so the same input yields the same id forever, and
// that is what makes a markup diff reviewable.
//
// The path is built from NAMES, never indices. The consequence is the reason `name`
// is mandatory: inserting or reordering a sibling changes no other node's id, while
// a rename changes exactly that subtree's ids. Renaming becomes an intentional,
// reviewable act rather than an invisible churn of the whole file.
//
// `compilerVersion` is deliberately excluded from the id input. Including it would
// rewrite every id on every compiler bump, destroying the reviewability that
// seeding exists to provide.

import { createHash } from 'node:crypto';

/** Fixed for the life of the project. Changing it rewrites every id in every form. */
export const SFS_ID_NAMESPACE = '3f2b7c14-9d68-5a41-b0e7-1c6a8f5d2e90';

/** Every compiler-emitted id must match this: note the version nibble is 5. */
export const V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class IdCollisionError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'IdCollisionError'; this.code = 'STM-5101'; }
}

/**
 * @param {string} uuid
 * @returns {Buffer} the 16 raw bytes
 */
function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`not a uuid: ${uuid}`);
  return Buffer.from(hex, 'hex');
}

/**
 * RFC 4122 section 4.3 name-based UUID, SHA-1 variant.
 * @param {string} namespace
 * @param {string} name
 * @returns {string}
 */
export function uuidv5(namespace, name) {
  const hash = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;         // version 5
  b[8] = (b[8] & 0x3f) | 0x80;         // RFC 4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The one id function. `path` is a name path such as
 * `/pageShell/bookings/toolbar/searchCell/quickSearch`; slots are `/pageShell#slot:content`,
 * columns `/bookings/bookingsTable#col:status`, action items `...#item:btnAddBooking`.
 * @param {string} module
 * @param {string} form
 * @param {string} sfsPath
 * @returns {string}
 */
export function nodeId(module, form, sfsPath) {
  return uuidv5(SFS_ID_NAMESPACE, `${module}/${form}|${sfsPath}`);
}

/**
 * Assert every emitted id is unique across the tree before returning it. Two names
 * colliding is a compiler bug that would otherwise ship a form whose parentId graph
 * is quietly wrong.
 * @param {{id:string, sfsPath:string}[]} nodes
 * @returns {void}
 */
export function assertUniqueIds(nodes) {
  /** @type {Map<string, string>} */
  const byId = new Map();
  for (const n of nodes) {
    const prior = byId.get(n.id);
    if (prior !== undefined) {
      throw new IdCollisionError(
        `STM-5101 id collision: "${prior}" and "${n.sfsPath}" both hash to ${n.id}`);
    }
    byId.set(n.id, n.sfsPath);
  }
}
