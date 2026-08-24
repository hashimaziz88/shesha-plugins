// compile — the only writer of *.form.json (INV 1). Wraps the compiler and persists the
// four legal artifacts; writes nothing on an error at stage <= 2 (the pipeline halts).
import fs from 'node:fs';
import path from 'node:path';
import { compile as compileSfs } from '../../../sfs/src/compile/index.mjs';

export const name = 'compile';
export const summary = 'Compile an SFS spec to a form envelope; the only writer of form markup.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sfsPath'],
  properties: {
    runId: { type: 'string' },
    screen: { type: 'string' },
    sfsPath: { type: 'string' },
    brand: { type: 'string' },
    out: { type: 'string' },
  },
};

/** @param {any} input @returns {any} */
export function run(input = {}) {
  const sfsPath = String(input.sfsPath);
  const text = fs.readFileSync(sfsPath, 'utf8');
  const result = /** @type {any} */ (compileSfs(text, { source: sfsPath, brand: input.brand }));
  const form = String(result.envelope.Name);
  const outDir = typeof input.out === 'string' ? input.out : path.dirname(sfsPath);
  fs.mkdirSync(outDir, { recursive: true });
  const formPath = path.join(outDir, `${form}.form.json`);
  const reportPath = path.join(outDir, `${form}.compile.json`);
  fs.writeFileSync(formPath, `${JSON.stringify(result.envelope, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, `${form}.form.meta.json`), `${JSON.stringify(result.meta, null, 2)}\n`);
  const r = result.report;
  return {
    verdict: r.verdict, exit: r.exit ?? (r.verdict === 'partial' ? 3 : 0), formPath, reportPath,
    counts: r.counts, coverage: r.coverage ?? null, escapes: r.escapes ?? [],
    structuralEscapeRate: r.structuralEscapeRate ?? 0, colourSites: r.colourSites ?? [],
    diagnostics: result.diagnostics.map((/** @type {any} */ d) => ({ code: d.code, path: d.path, message: d.message })),
  };
}
