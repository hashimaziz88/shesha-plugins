// validate-output.mjs — the compiler gates its OWN output.
//
// Writing --out unconditionally made "compiled" a claim about effort, not about the
// artifact. The three gates that need nothing but the file itself run here, so exit 0 is a
// claim about the MARKUP. A failing gate leaves the output on disk — self-gating fails the
// command, it does not make the evidence vanish. resolve-bindings is the fourth gate and
// stays CALLER-RUN: it needs the live backend, which the compiler may not have.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SELF_GATES = ['validate-schema.js', 'validate-guardrails.js', 'validate-styledness.js'];
export const GATE_CHAIN = 'validate-schema → validate-guardrails → resolve-bindings → validate-styledness';

/**
 * validate-styledness cannot read the archetype off the markup (an archetype is a blueprint
 * fact, not a component) and its page-anatomy floor only applies to page archetypes — so the
 * compiler, which DOES know, passes it through; without the flag that gate degrades to a
 * WARN, never to a false pass. validate-guardrails' optional entity-metadata arg is not
 * available at compile time, so it runs metadata-free exactly as the offline eval suite
 * invokes it — its identity checks WARN instead of FAIL.
 * @returns {{ok: boolean, results: Array<{gate, ok, output}>}}
 */
export function runSelfGates(outFile, { archetype, pageAnatomy = true } = {}) {
  const extra = {
    'validate-styledness.js': ['--archetype', archetype, ...(pageAnatomy ? [] : ['--no-page-anatomy'])],
  };
  const results = SELF_GATES.map((gate) => {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, gate), outFile, ...(extra[gate] ?? [])], { encoding: 'utf8' });
    return { gate, ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd() };
  });
  return { ok: results.every((r) => r.ok), results };
}
