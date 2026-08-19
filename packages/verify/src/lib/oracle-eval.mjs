// The measurement half of g-oracle-independence, run as a SUBPROCESS.
//
// The mutation harness stages a gate's inputs, runs the gate, applies the
// mutation to the same staged tree and runs the gate again — in one process. An
// in-process dynamic import of the staged compiler would be served from the ESM
// cache on the second run, so a compiler-side mutation would be invisible and
// the gate's flip theatre by accident. A subprocess loads the module graph
// fresh every time; this file prints raw comparison rows as JSON and asserts
// nothing, because the verdict belongs to the gate's coverage families.
//
// argv: <repoRoot> <subjectRelPath>...

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , rootArg, ...subjects] = process.argv;
if (rootArg === undefined) throw new Error('oracle-eval: missing <repoRoot> argv');
const root = rootArg;

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/**
 * @param {Record<string, unknown>[]} components
 * @param {(n:Record<string, unknown>) => void} visit
 * @returns {void}
 */
function walkNodesOf(components, visit) {
  for (const n of components) {
    if (!isObj(n)) continue;
    visit(n);
    if (Array.isArray(n.components)) walkNodesOf(/** @type {Record<string, unknown>[]} */ (n.components), visit);
    for (const slot of ['content', 'header']) {
      const w = n[slot];
      if (isObj(w) && Array.isArray(w.components)) walkNodesOf(/** @type {Record<string, unknown>[]} */ (w.components), visit);
    }
  }
}

async function main() {
  const compileMod = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const decompileMod = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const registryMod = await import(pathToFileURL(path.join(root, 'packages/sfs/src/lib/registry.mjs')).href);
  const registry = registryMod.loadRegistry('shesha');
  const excluded = /** @type {Set<string>} */ (decompileMod.EXCLUDED);

  /** @type {unknown[]} */
  const out = [];
  for (const subject of subjects) {
    const abs = path.join(root, subject);
    const name = path.basename(subject);
    if (!fs.existsSync(abs)) { out.push({ subject: name, missing: true }); continue; }

    const envelope = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const source = /** @type {{components:Record<string, unknown>[]}} */ (
      JSON.parse(typeof envelope.Markup === 'string' ? envelope.Markup : JSON.stringify(envelope)));
    const lifted = decompileMod.decompile(fs.readFileSync(abs, 'utf8'), { registry });
    const emittedMarkup = /** @type {{components:Record<string, unknown>[]}} */ (
      JSON.parse(compileMod.compile(JSON.stringify(lifted.sfs), { registry }).markup));

    // The page-shell subtree is normalisation-owned wholesale; it is excluded by
    // its detected shape, never by a hand-kept name list.
    /** @type {Set<Record<string, unknown>>} */
    const shellNodes = new Set();
    const rootNode = source.components.length === 1 ? source.components[0] : undefined;
    if (rootNode !== undefined && rootNode.type === 'card' && isObj(rootNode.content)
      && Array.isArray(rootNode.content.components)) {
      const band = /** @type {Record<string, unknown>[]} */ (rootNode.content.components)[0];
      if (isObj(band) && band.type === 'container' && Array.isArray(band.components)
        && isObj(band.components[0]) && /** @type {Record<string, unknown>} */ (band.components[0]).type === 'text') {
        shellNodes.add(rootNode);
        shellNodes.add(band);
        for (const kid of /** @type {Record<string, unknown>[]} */ (band.components)) {
          if (kid.type === 'text') shellNodes.add(kid); else break;
        }
      }
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const emittedByName = new Map();
    walkNodesOf(emittedMarkup.components, (n) => {
      if (typeof n.propertyName === 'string') emittedByName.set(n.propertyName, n);
    });

    /** @type {{name:string, key:string, source:unknown, emitted:unknown, equal:boolean}[]} */
    const props = [];
    /** @type {string[]} */
    const missingNodes = [];
    walkNodesOf(source.components, (src) => {
      if (shellNodes.has(src)) return;
      const nodeName = typeof src.propertyName === 'string'
        ? src.propertyName.split('.').map((s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)).join('.')
        : null;
      if (nodeName === null) return;
      const emitted = emittedByName.get(nodeName);
      if (emitted === undefined) { missingNodes.push(nodeName); return; }
      const rec = registry.components[String(src.type)];
      const legacy = new Set(rec !== undefined ? rec.legacyStyleProps : []);
      for (const [key, value] of Object.entries(src)) {
        if (excluded.has(key) || key === 'type' || legacy.has(key)) continue;
        props.push({
          name: nodeName,
          key,
          source: value,
          emitted: emitted[key],
          equal: Object.hasOwn(emitted, key) && JSON.stringify(emitted[key]) === JSON.stringify(value),
        });
      }
    });

    // editMode (D-077 / N12): stamped from the kind profile, never carried.
    const kind = /** @type {{kind:string}} */ (lifted.sfs).kind;
    const profile = registry.formSettings.kinds[kind];
    /** @type {{name:string, unit:string, actual:unknown, expected:unknown}[]} */
    const editmode = [];
    walkNodesOf(emittedMarkup.components, (n) => {
      const rec = registry.components[String(n.type)];
      if (rec === undefined) return;
      if (typeof rec.editModeChannel === 'string') {
        editmode.push({
          name: String(n.propertyName), unit: String(n.type),
          actual: n.editMode, expected: profile.editMode[rec.editModeChannel],
        });
      }
      if (n.type === 'buttonGroup' && Array.isArray(n.items)) {
        for (const raw of /** @type {Record<string, unknown>[]} */ (n.items)) {
          editmode.push({
            name: String(raw.name), unit: 'buttonGroup.item',
            actual: raw.editMode, expected: profile.editMode.actionsItem,
          });
        }
      }
    });

    out.push({ subject: name, missing: false, missingNodes, props, editmode });
  }
  process.stdout.write(JSON.stringify(out));
}

await main();
