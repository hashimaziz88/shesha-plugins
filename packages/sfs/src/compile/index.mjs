// The compiler. ONE exported entry point, and it is the only function in this
// repository that produces Shesha form markup.
//
// The "one push path" invariant is true because there is exactly one function, not
// because a convention says so. Stages are composed left to right and each is pure; a
// stage that raises halts the pipeline, so no later stage runs and nothing is written.

import { createHash } from 'node:crypto';
import { loadRegistry } from '../lib/registry.mjs';
import { parse, SfsError } from './s1-parse.mjs';
import { resolve } from './s2-resolve.mjs';
import { normalise } from './s3-normalise.mjs';
import { expand } from './s4-expand.mjs';
import { stamp } from './s5-stamp.mjs';
import { serialise } from './s6-serialise.mjs';

export { SfsError };

/** The compiler's own version. Deliberately NOT part of the id input (section 2.4.2). */
export const COMPILER_VERSION = '1.0.0';

/** The six stages, named so the report can say which one raised. */
export const STAGES = ['s1-parse', 's2-resolve', 's3-normalise', 's4-expand', 's5-stamp', 's6-serialise'];

/**
 * @typedef {{markup:string, envelope:Record<string, unknown>, report:Record<string, unknown>,
 *            meta:Record<string, unknown>, diagnostics:import('./s2-resolve.mjs').Diagnostic[]}} CompileResult
 */

/**
 * Compile SFS source text to form markup and a 23-field envelope.
 *
 * Pure in `(sfs bytes, registry content, tokens content, compilerVersion)`: same inputs
 * give byte-identical output, forever. There is no clock and no randomness anywhere in
 * the path, which is what `test/determinism.test.mjs` asserts by compiling repeatedly.
 * @param {string} sfsText
 * @param {{brand?:string, source?:string, registry?:import('../lib/registry.mjs').Registry}} [options]
 * @returns {CompileResult}
 */
export function compile(sfsText, options = {}) {
  const source = options.source ?? '<input>';
  const normalisedText = sfsText.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const sfsSha256 = createHash('sha256').update(normalisedText, 'utf8').digest('hex');

  const { doc } = parse(normalisedText, source);
  const registry = options.registry ?? loadRegistry(options.brand ?? doc.brand ?? 'shesha');
  const ctx = { registry };

  /** @type {import('./s2-resolve.mjs').Diagnostic[]} */
  const diagnostics = [];

  const resolved = resolve(doc, ctx);
  diagnostics.push(...resolved.diagnostics);

  const canonical = normalise(resolved.tree, ctx);
  diagnostics.push(...canonical.diagnostics);

  const expanded = expand(canonical.tree, ctx);
  diagnostics.push(...expanded.diagnostics);

  const stamped = stamp(expanded.tree, ctx);
  diagnostics.push(...stamped.diagnostics);

  const out = serialise(stamped.tree, {
    registry,
    sfsSha256,
    escapes: expanded.escapes,
    diagnostics,
  });

  // A binding the compiler could not verify against entity metadata degrades the
  // COMPILE verdict to partial. It never degrades to pass, and it never blocks the
  // markup: determinism and oracle agreement are properties of the bytes, and those
  // are provable with no backend in the room.
  const unverified = diagnostics.filter((d) => d.code === 'MET-2200').length;
  if (unverified > 0) {
    out.report.verdict = 'partial';
    out.report.exit = 3;
    out.report.coverage = {
      bindings: { walked: unverified, checked: 0, uninspectable: unverified, reason: 'no backend in this session' },
    };
  }
  out.report.compilerVersion = COMPILER_VERSION;

  return { ...out, diagnostics };
}
