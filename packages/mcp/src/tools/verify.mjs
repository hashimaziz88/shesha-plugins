// verify — the only writer of *.verdict.json. Runs the T1–T4 ladder and seals the verdict;
// `result` is computed by resultFor, never authored (D-015). No backend needed for T1–T3.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLadder } from '../../../verify/src/verify.mjs';

export const name = 'verify';
export const summary = 'Run the T1-T4 verification ladder over a compiled screen and seal the verdict.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['screen'],
  properties: {
    runId: { type: 'string' },
    screen: { type: 'string' },
    tiers: { type: 'array', items: { type: 'string' } },
    contractPath: { type: 'string' },
    metadata: { type: 'string' },
    legacy: { type: 'boolean' },
  },
};

function repoRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); }

/** @param {any} input @returns {Promise<any>} */
export async function run(input = {}) {
  const root = repoRoot();
  const runId = typeof input.runId === 'string' ? input.runId : '';
  const runDir = runId ? path.join(root, 'runs', runId) : path.join(root, '.build/mcp-verify');
  const r = /** @type {any} */ (await runLadder({
    root, runDir, screen: String(input.screen),
    tiers: Array.isArray(input.tiers) && input.tiers.length ? input.tiers : ['T1', 'T2', 'T3'],
    legacy: !!input.legacy, metadata: typeof input.metadata === 'string' ? input.metadata : null,
  }));
  const v = r.verdict || {};
  return {
    verdictPath: path.join(runDir, 'screens', `${input.screen}.verdict.json`),
    result: v.result, tiers: v.tiers, predicates: v.predicates ?? [],
    findings: v.findings ?? [], route: v.route ?? {}, advisory: v.advisory ?? {},
  };
}
