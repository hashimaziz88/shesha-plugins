// push — the only path that publishes markup to a backend. push-admissible.mjs runs P0–P9
// inside the tool (the hook is a fast pre-check; the tool is the authority). confirm:true is
// required. With no backend in the session the tool refuses rather than pretending to publish.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admit } from '../../../verify/src/bin/push-admissible.mjs';

export const name = 'push';
export const summary = 'Publish a verified screen to the backend after re-running P0-P9 admission. Requires confirm:true.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['runId', 'screen', 'confirm'],
  properties: {
    runId: { type: 'string' },
    screen: { type: 'string' },
    confirm: { const: true },
    allowPartial: { type: 'boolean' },
    target: { type: 'string' },
  },
};

function repoRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); }

/** @param {any} input @returns {any} */
export function run(input = {}) {
  if (input.confirm !== true) return { published: false, code: 'HOOK-0301', reason: 'push requires confirm:true' };
  const now = Date.parse('2026-08-24T00:00:00Z'); // deterministic for the admission clock; live push stamps its own
  const verdict = admit({
    root: repoRoot(), runId: input.runId, screen: input.screen,
    allowPartial: input.allowPartial === true, target: typeof input.target === 'string' ? input.target : null, now,
  });
  if (!verdict.admissible) return { published: false, code: verdict.code, reason: verdict.reason };
  // Admissible, but a real publish needs a live backend, which is a WP-11 operator concern.
  return { published: false, admissible: true, code: '', reason: 'admissible; a live backend is required to publish (WP-11)', receiptPath: null };
}
