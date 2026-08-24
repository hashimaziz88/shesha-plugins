// decompile — recover SFS from an envelope. A corpus/migration operation; absent from the
// Specwriter's tool list (the IR is the interface).
import fs from 'node:fs';
import path from 'node:path';
import { decompile as decompileEnvelope } from '../../../sfs/src/decompile/index.mjs';

export const name = 'decompile';
export const summary = 'Recover an SFS spec from a compiled form envelope.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['form'],
  properties: {
    form: { type: 'string' },
    out: { type: 'string' },
  },
};

/** @param {any} input @returns {any} */
export function run(input = {}) {
  const formPath = String(input.form);
  const envelope = JSON.parse(fs.readFileSync(formPath, 'utf8').replace(/^﻿/, ''));
  const result = /** @type {any} */ (decompileEnvelope(envelope));
  const sfs = result.sfs ?? result;
  const outDir = typeof input.out === 'string' ? input.out : path.dirname(formPath);
  fs.mkdirSync(outDir, { recursive: true });
  const sfsPath = path.join(outDir, `${sfs.form || 'decompiled'}.sfs.json`);
  fs.writeFileSync(sfsPath, `${JSON.stringify(sfs, null, 2)}\n`);
  return { sfsPath, diagnostics: result.diagnostics ?? [], unlifted: result.unlifted ?? [] };
}
