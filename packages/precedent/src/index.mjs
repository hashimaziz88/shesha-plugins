// @shesha/precedent — scaffold only. Shape-indexed precedent retrieval is BL-009.
//
// It throws rather than returning an empty result, because a retrieval surface
// that silently returns nothing reads as "no precedent exists" at every call
// site and is indistinguishable from a working store with an empty corpus.

export const PRECEDENT_API_VERSION = '0.0.0';

export class NotImplementedError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'NotImplementedError'; this.code = 'E_NOT_IMPLEMENTED'; }
}

/**
 * @param {unknown} _query
 * @returns {never}
 */
export function retrieve(_query) {
  throw new NotImplementedError('E_NOT_IMPLEMENTED: precedent retrieval is BL-009 and ships no behaviour in Scope A');
}
