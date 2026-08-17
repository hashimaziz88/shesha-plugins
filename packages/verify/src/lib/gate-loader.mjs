// Gate discovery and loading.
//
// This lives apart from run-gates.mjs on purpose. g-gate-contract has to load
// every gate in order to check its exports, and run-gates.mjs ends in a
// top-level `await`. Importing the loader from run-gates.mjs therefore created an
// ESM cycle in which the gate module waited for run-gates to finish evaluating
// while run-gates waited on the gate import — an unsettled top-level await that
// exits 13 with no verdict rather than failing loudly.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles, normalisedByteSize } from './fsx.mjs';

/**
 * @typedef {{name:string, kind:string, apply:(tmp:string)=>Promise<void>|void, expect:'fail'|'partial'}} Mutation
 * @typedef {{id:string, describe:string, inputPaths:string[],
 *            run:(ctx:{repoRoot:string})=>Promise<import('@shesha/registry/coverage').Family[]>,
 *            mutations:Mutation[]}} Gate
 */

/**
 * Every gate module, sorted. A `.mutation.` file is a test, not a gate.
 * @param {string} root
 * @returns {string[]} absolute paths
 */
export function gateFiles(root) {
  const dir = path.join(root, 'packages', 'verify', 'src', 'gates');
  return listFiles(dir, { ext: ['.mjs'] })
    .filter((f) => path.basename(f).startsWith('g-') && !f.includes('.mutation.'));
}

/**
 * @param {string} file
 * @returns {Promise<Gate>}
 */
export async function loadGate(file) {
  const mod = await import(pathToFileURL(file).href);
  return /** @type {Gate} */ ({
    id: mod.id,
    describe: mod.describe,
    inputPaths: mod.inputPaths || [],
    run: mod.run,
    mutations: mod.mutations || [],
  });
}

/**
 * A gate counts toward the ratchet only when every declared input exists and is
 * non-empty and it declares at least one mutation, so a gate cannot be created
 * early to inflate the count and a gate that cannot fail was never in it.
 * @param {string} root
 * @param {Gate} gate
 * @returns {boolean}
 */
export function countsTowardRatchet(root, gate) {
  if (!Array.isArray(gate.mutations) || gate.mutations.length < 1) return false;
  for (const p of gate.inputPaths) {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) return false;
    if (fs.statSync(abs).isDirectory()) {
      if (listFiles(abs).length === 0) return false;
    } else if (normalisedByteSize(abs) <= 0) return false;
  }
  return true;
}
