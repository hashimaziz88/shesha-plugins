// Shared probe harness (D-008).
//
// Each of the eight empirical decisions is DECIDED NOW with a stated value; the
// probe exists to confirm or supersede it against a live backend. When no backend
// is reachable the probe exits 3 `uninspectable` with a reason — it never exits 0,
// because "we could not look" and "we looked and it was fine" must not share an
// exit code. That shared exit code is the defect this whole rebuild removes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };

/** @returns {string} the probes/ directory */
function probesDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * @returns {{url:string, token:string}|null} backend coordinates, or null when absent
 */
export function backendFromEnv() {
  const url = process.env.SHESHA_BACKEND_URL;
  const tokenFile = process.env.SHESHA_TOKEN_FILE;
  if (!url || !tokenFile) return null;
  let token;
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { return null; }
  if (!token) return null;
  return { url, token };
}

/**
 * @param {string} name
 * @param {{decision:string, decided:string, question:string,
 *          check?: (backend:{url:string,token:string}) => Promise<{confirmed:boolean, observed:string}>}} spec
 * @returns {Promise<number>} process exit code
 */
export async function runProbe(name, spec) {
  const backend = backendFromEnv();
  if (backend === null) {
    console.log(`probe ${name}: UNINSPECTABLE`);
    console.log(`  decision   ${spec.decision} (Status pending-probe)`);
    console.log(`  question   ${spec.question}`);
    console.log(`  decided    ${spec.decided}`);
    console.log('  reason     no backend reachable: set SHESHA_BACKEND_URL and SHESHA_TOKEN_FILE');
    console.log('  A partial verdict is NOT a pass. This decision is unconfirmed, not wrong.');
    return EXIT.partial;
  }
  if (typeof spec.check !== 'function') {
    console.log(`probe ${name}: UNINSPECTABLE — a backend is reachable but this probe ships no check yet (BL-004)`);
    return EXIT.partial;
  }
  const { confirmed, observed } = await spec.check(backend);
  const resultsDir = path.join(probesDir(), 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${name}.json`),
    `${JSON.stringify({ probe: name, decision: spec.decision, confirmed, observed, backend: backend.url }, null, 2)}\n`);
  console.log(`probe ${name}: ${confirmed ? 'CONFIRMED' : 'CONTRADICTED'} — ${observed}`);
  return confirmed ? EXIT.pass : EXIT.fail;
}
