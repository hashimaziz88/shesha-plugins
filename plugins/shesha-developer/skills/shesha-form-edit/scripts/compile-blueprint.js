#!/usr/bin/env node
// compile-blueprint.js --blueprint <bp.json|bp.md> --out <form.json>
//                      [--backend http://localhost:21021] [--no-live]
//                      [--theme <name> | --theme-file <tokens.json>] [--no-style] [--token-file <path>]
//
// The blueprint IR is the ONLY build input; the model chooses the adaptation, this command
// types the JSON. A THIN ENTRY over five bounded stages:
//   validate   → shesha-design-comprehension owns the blueprint contract (invalid → exit 2)
//   normalize  → compile/normalize-archetype.mjs: archetype anatomy as ordinary nodes
//   theme      → compile/resolve-theme.mjs: brand tokens, resolved at compile time [R-042]
//   compile    → compile/compile-node.mjs: the one generic node compiler
//   self-gate  → compile/validate-output.mjs: the offline gates, on this very file
// Nothing else lives here: no sidecars, no publish, no browser, and no second capability
// authority — component typing questions belong to validate-schema + the registry.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeArchetype, PAGE_ARCHETYPES } from './compile/normalize-archetype.mjs';
import { loadTheme } from './compile/resolve-theme.mjs';
import { createBindings, fetchMetadata } from './compile/resolve-bindings-offline.mjs';
import { createCompiler, slotErrors } from './compile/compile-node.mjs';
import { runSelfGates, SELF_GATES, GATE_CHAIN } from './compile/validate-output.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const die = (msg) => { console.error(msg); process.exit(2); };

const bpFile = argVal('--blueprint', null);
const outFile = argVal('--out', null);
if (!bpFile || !outFile) die('usage: node compile-blueprint.js --blueprint <bp.json|bp.md> --out <form.json> [--backend url] [--no-live] [--theme name | --theme-file tokens.json] [--no-style] [--token-file path]');

// ---- validate: the blueprint contract is not the compiler's own opinion ------------
// It runs the one validator that OWNS the contract. In-process import over a sibling-skill
// relative path (both ship in the same plugin, so no package resolution is involved); the
// existsSync guard turns a mangled install into a readable error, not a module stack.
const VALIDATOR = path.join(SCRIPT_DIR, '..', '..', 'shesha-design-comprehension', 'scripts', 'validate-blueprint.mjs');
if (!fs.existsSync(VALIDATOR)) die(`blueprint validator missing: ${VALIDATOR} — the shesha-design-comprehension skill must ship alongside shesha-form-edit`);
const { validateBlueprint, loadSchema, readBlueprint } = await import(pathToFileURL(VALIDATOR).href);

let bp;
try { bp = readBlueprint(bpFile); }
catch (err) { die(`cannot read blueprint ${bpFile}: ${err.message}`); }
const findings = validateBlueprint(bp, loadSchema()).findings;
if (findings.length) {
  console.error(`INVALID blueprint ${bpFile} — no spec, no build (${findings.length} finding(s), nothing written):`);
  for (const f of findings) console.error(`  FAIL [${f.rule}] ${f.path || '(root)'} — ${f.message}`);
  die('  gate: node ../shesha-design-comprehension/scripts/validate-blueprint.mjs <blueprint>');
}

// ---- versions are STAMPED from the 0.45 KB [R-003] ---------------------------------
const kb = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', 'assets', 'components-kb', '_index.json'), 'utf8'));
const ver = (type) => {
  const v = kb[type]?.version;
  if (!Number.isInteger(v)) throw new Error(`component type "${type}" not in the 0.45 KB — unusable by definition (L1)`);
  return v;
};

// ---- live metadata (datatype → component, reflist identity) — optional -------------
let meta = null;
if (!args.includes('--no-live')) {
  try { meta = await fetchMetadata(bp, { backend: argVal('--backend', 'http://localhost:21021'), tokenFile: argVal('--token-file', null) }); }
  catch (err) { die(err.message); }
  if (!meta) console.error(`WARN: metadata for ${bp.entity.fullClassName} unavailable — compiling without live binding resolution`);
}

// ---- normalize → theme → compile → write ------------------------------------------
const { layout, notes } = normalizeArchetype(bp);
// A theme the compiler cannot FULLY resolve is a compile error, never a silent neutral
// fallback [R-042]: a misspelled brand must not ship an unbranded form that passes every gate.
// `--theme-file` supplies an externally authored token file, validated identically.
// `--no-style` is the ONE explicit opt-out.
const themeFile = argVal('--theme-file', null);
let theme;
try {
  theme = loadTheme(themeFile ?? argVal('--theme', bp.theme || 'shesha'),
    { noStyle: args.includes('--no-style'), isFile: Boolean(themeFile) });
} catch (err) {
  die(`THEME UNRESOLVED — no theme, no build (nothing written):\n${err.message}`);
}
if (theme.note) console.error(theme.note);
for (const f of theme.findings ?? []) console.error(`  WARN [${f.rule}] ${f.path} — ${f.message}`);
const { compileNode } = createCompiler({ bp, theme, bindings: createBindings(bp, meta), ver });

const rootChildren = [compileNode(layout, bp.form.name)];
for (const c of rootChildren) c.parentId = 'root';
if (notes.length) console.error(`normalized (${bp.archetype}): ${notes.join(' + ')}`);

const slots = slotErrors(rootChildren);
if (slots.length) {
  console.error(`SLOT NESTING ERROR — ${slots.length} misplaced child set(s), nothing written:`);
  for (const e of slots) console.error(`  FAIL ${e}`);
  process.exit(2);
}

const form = {
  components: rootChildren,
  formSettings: {
    // vertical (top) labels: a clean modern layout that stays aligned at any column width —
    // horizontal labelCol/wrapperCol cram in multi-column splits.
    layout: 'vertical',
    colon: false,
    labelCol: { span: 24 },
    wrapperCol: { span: 24 },
    modelType: bp.entity.modelType ?? bp.entity.fullClassName,
  },
};

fs.writeFileSync(outFile, JSON.stringify(form, null, 2) + '\n');
console.log(`compiled ${bp.screen} (${bp.archetype}) → ${outFile}`);

// ---- self-gate + the structured result --------------------------------------------
const gates = runSelfGates(outFile, { archetype: bp.archetype, pageAnatomy: bp.chrome !== false });
for (const r of gates.results.filter((x) => !x.ok)) console.error(`\n--- ${r.gate} FAILED on ${outFile} ---\n${r.output}`);
if (gates.ok) console.log(`self-gated: ${SELF_GATES.join(' → ')} all pass`);
// The two INPUT identities, emitted so downstream evidence can say WHICH blueprint and
// WHICH theme produced the deliverable (references/quality-gates.md, the evidence
// envelope). Hashed over canonical (key-sorted) JSON, so a re-serialization or a
// blueprint carried in a fenced .md block hashes identically to the .json twin.
const canonicalJson = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map((kk) => [kk, val[kk]]))
  : val));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

console.log(JSON.stringify({
  form: outFile, screen: bp.screen, archetype: bp.archetype,
  blueprintHash: sha256(canonicalJson(bp)),
  themeHash: sha256(canonicalJson({ name: theme.name, chain: theme.chain, tokens: theme.tokens ?? null })),
  pageArchetype: PAGE_ARCHETYPES.has(bp.archetype), normalized: notes,
  theme: theme.name, themeChain: theme.chain, styled: Boolean(theme.tokens), liveMetadata: Boolean(meta),
  // artDirection is a JUDGMENT input, never interpreted here — it is PASSED THROUGH so the
  // critic (and the conductor's theme choice) receive it. Authority order lives in exactly one
  // place: the artDirection $comment in blueprint.schema.json.
  ...(bp.artDirection ? { artDirection: bp.artDirection } : {}),
  components: (function tally(n) {   // a component node is a typed node with an id
    if (Array.isArray(n)) return n.reduce((s, x) => s + tally(x), 0);
    if (!n || typeof n !== 'object') return 0;
    return (typeof n.type === 'string' && n.id ? 1 : 0) + Object.values(n).reduce((s, v) => s + tally(v), 0);
  })(form.components),
  rootChildren: rootChildren.length,
  gates: Object.fromEntries(gates.results.map((r) => [r.gate, r.ok ? 'pass' : 'fail'])),
}, null, 2));

if (!gates.ok) {
  console.error(`\nself-gate FAILED: ${gates.results.filter((r) => !r.ok).map((r) => r.gate).join(', ')} — output left at ${outFile} for diagnosis`);
  process.exit(1);
}
// Four gates, not three [R-042/quality-gates.md]: resolve-bindings needs the live backend.
console.log(`gate chain: ${GATE_CHAIN}`);
console.log('next: resolve-bindings (caller-run — needs the live backend), then push');
