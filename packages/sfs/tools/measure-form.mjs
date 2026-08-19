// Measure a form: bytes, node counts, and the normalisation defect classes it
// carries (§5.2's `--defects`).
//
// Every number this prints is computed from the file in front of it. The defect
// census is the same predicate vocabulary the compiler is held to (N1..N12), run
// in the OPPOSITE direction: over legacy markup, to discover which classes are
// present. The count is discovered and printed, never a literal copied from a
// document — which is what makes the ratchet in golden-defects.test.mjs honest.
//
//   node packages/sfs/tools/measure-form.mjs <file> [--defects] [--json]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/** A `label` no designer wrote (N1). */
const AUTO_LABEL = /^[A-Z][a-z]+\d+$/;
/** Legacy styling props that must never coexist with v7 channels (N5). */
const LEGACY_STYLE_PROPS = ['fontSize', 'fontWeight', 'backgroundColor', 'customStyle', 'style'];
const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
const APPEARANCE = ['font', 'background', 'border', 'shadow'];

/**
 * Every component of a markup tree, flattened.
 * @param {{components?:unknown[]}} markup
 * @returns {Record<string, unknown>[]}
 */
export function allNodes(markup) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  /** @param {unknown} n @returns {void} */
  const walk = (n) => {
    if (!isObj(n)) return;
    out.push(n);
    if (Array.isArray(n.components)) n.components.forEach(walk);
    for (const slot of ['content', 'header']) {
      const w = n[slot];
      if (isObj(w) && Array.isArray(w.components)) w.components.forEach(walk);
    }
  };
  (markup.components || []).forEach(walk);
  return out;
}

/**
 * The defect census. One entry per class, each `present` decided by a predicate
 * over this file's own bytes.
 * @param {{components?:unknown[], formSettings?:Record<string, unknown>}} markup
 * @returns {{id:string, rule:string, present:boolean, evidence:string}[]}
 */
export function defectsOf(markup) {
  const nodes = allNodes(markup);
  const fs_ = markup.formSettings || {};
  /** @param {Record<string, unknown>} n @param {string} bp @returns {Record<string, unknown>} */
  const block = (n, bp) => (isObj(n[bp]) ? /** @type {Record<string, unknown>} */ (n[bp]) : {});

  /** @type {{id:string, rule:string, present:boolean, evidence:string}[]} */
  const out = [];
  /** @param {string} id @param {string} rule @param {Record<string, unknown>[]} hits @param {(n:Record<string, unknown>) => string} [say] */
  const record = (id, rule, hits, say) => {
    let evidence = '';
    const first = hits[0];
    if (first !== undefined) {
      evidence = `${hits.length} node(s), e.g. ${
        say ? say(first) : String(first.componentName ?? first.propertyName ?? first.type)}`;
    }
    out.push({ id, rule, present: hits.length > 0, evidence });
  };

  record('N1', 'label defaults', nodes.filter((n) =>
    (typeof n.label === 'string' && AUTO_LABEL.test(n.label))
    || (n.labelAlign !== undefined && n.label === undefined)
    || (n.label !== undefined && n.hideLabel === undefined)));

  record('N2', 'appearance declared once', nodes.filter((n) => {
    if (!isObj(n.desktop)) return false;
    return APPEARANCE.some((c) => {
      const d = JSON.stringify(block(n, 'desktop')[c]);
      return d !== JSON.stringify(block(n, 'tablet')[c]) || d !== JSON.stringify(block(n, 'mobile')[c]);
    });
  }));

  record('N3', 'class parity', nodes.filter((n) => {
    const values = BREAKPOINTS.map((bp) => block(n, bp).className);
    return values.some((v) => v !== undefined) && new Set(values.map((v) => JSON.stringify(v))).size > 1;
  }));

  record('N4', 'page-shell geometry', nodes.filter((n) => BREAKPOINTS.some((bp) => {
    const dims = block(n, bp).dimensions;
    return isObj(dims) && typeof dims.height === 'string' && /^\d+px$/.test(dims.height);
  })));

  record('N5', 'single styling channel', nodes.filter((n) =>
    LEGACY_STYLE_PROPS.some((p) => n[p] !== undefined) && isObj(n.desktop)));

  record('N6', 'stylingBox placement', nodes.filter((n) =>
    typeof n.stylingBox === 'string' && n.stylingBox !== '{}'));

  record('N7', 'one wiring per event', nodes.filter((n) =>
    (n.rowClickActionConfiguration !== undefined && n.onRowClick !== undefined)
    || n.dblClickActionConfiguration !== undefined));

  const listLike = nodes.some((n) => n.type === 'datatable' || n.type === 'datalist');
  const submitterOnRead = listLike && (fs_.dataSubmitterType === 'gql' || fs_.dataSubmittersSettings !== undefined);
  const illegalHook = typeof fs_.onBeforeDataLoad === 'string' && fs_.onBeforeDataLoad !== '';
  out.push({
    id: 'N8',
    rule: 'formSettings by kind',
    present: submitterOnRead || illegalHook,
    evidence: [submitterOnRead ? 'submitter on a read-only list' : '', illegalHook ? 'onBeforeDataLoad set' : '']
      .filter(Boolean).join(', '),
  });

  record('N9', 'stack coherence', nodes.filter((n) => BREAKPOINTS.some((bp) => {
    const b = block(n, bp);
    if (b.flexDirection !== 'row' || !Array.isArray(n.components)) return false;
    return /** @type {unknown[]} */ (n.components).some((kid) => {
      const kb = isObj(kid) ? block(/** @type {Record<string, unknown>} */ (kid), bp) : {};
      return isObj(kb.dimensions) && kb.dimensions.width === '100%';
    });
  })));

  // N10: a data region nested inside the title band, which is the first child of
  // the shell card's content.
  const roots = /** @type {Record<string, unknown>[]} */ (markup.components || []);
  let n10 = false;
  const root0 = roots[0];
  if (roots.length === 1 && root0 !== undefined && root0.type === 'card' && isObj(root0.content)
    && Array.isArray(root0.content.components)) {
    const band = /** @type {Record<string, unknown>[]} */ (root0.content.components)[0];
    if (isObj(band) && band.type === 'container' && Array.isArray(band.components)) {
      n10 = allNodes({ components: band.components })
        .some((n) => n.type === 'dataContext' || n.type === 'datatable' || n.type === 'datalist');
    }
  }
  out.push({ id: 'N10', rule: 'page-shell topology', present: n10, evidence: n10 ? 'a data region is inside titleBand' : '' });

  /** @param {unknown} v @returns {boolean} */
  const pascal = (v) => typeof v === 'string' && /^[A-Z]/.test(v);
  const n11 = nodes.filter((n) => pascal(n.propertyName)
    || (Array.isArray(n.items) && /** @type {unknown[]} */ (n.items).some((it) => isObj(it) && pascal(it.propertyName))));
  record('N11', 'camelCase bindings', n11);

  record('N12', 'action-item editMode', nodes.filter((n) => n.type === 'buttonGroup'
    && Array.isArray(n.items)
    && /** @type {unknown[]} */ (n.items).some((it) => isObj(it) && it.editMode !== 'editable')));

  return out;
}

/**
 * @param {string} file
 * @returns {{file:string, bytes:number, markupBytes:number, components:number, depth:number,
 *            types:string[], defects:{id:string, rule:string, present:boolean, evidence:string}[],
 *            defectClassesPresent:number}}
 */
export function measure(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw.replace(/^﻿/, ''));
  const markup = typeof parsed.Markup === 'string' ? JSON.parse(parsed.Markup)
    : Array.isArray(parsed) ? { components: parsed } : parsed;
  const compact = JSON.stringify({ components: markup.components || [], formSettings: markup.formSettings || {} });

  /** @param {unknown} n @param {number} d @returns {number} */
  const depthOf = (n, d) => {
    if (!isObj(n)) return d;
    /** @type {unknown[]} */
    const kids = [];
    if (Array.isArray(n.components)) kids.push(...n.components);
    for (const slot of ['content', 'header']) {
      const w = n[slot];
      if (isObj(w) && Array.isArray(w.components)) kids.push(...w.components);
    }
    return kids.length === 0 ? d : Math.max(...kids.map((k) => depthOf(k, d + 1)));
  };

  const nodes = allNodes(markup);
  const defects = defectsOf(markup);
  return {
    file: path.relative(process.cwd(), file).split(path.sep).join('/'),
    bytes: Buffer.byteLength(raw, 'utf8'),
    markupBytes: Buffer.byteLength(compact, 'utf8'),
    components: nodes.length,
    depth: Math.max(0, ...(markup.components || []).map((/** @type {unknown} */ r) => depthOf(r, 1))),
    types: [...new Set(nodes.map((n) => String(n.type)))].sort(),
    defects,
    defectClassesPresent: defects.filter((d) => d.present).length,
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (file === undefined) {
    console.error('usage: measure-form.mjs <file> [--defects] [--json]');
    process.exit(2);
  }
  const m = measure(file);
  const wantDefects = args.includes('--defects');
  if (args.includes('--json')) {
    console.log(JSON.stringify(wantDefects ? m : { ...m, defects: undefined, defectClassesPresent: undefined }, null, 2));
  } else {
    console.log(`${m.file} · ${m.bytes} B file · ${m.markupBytes} B compact markup · ${m.components} components · depth ${m.depth}`);
    console.log(`types: ${m.types.join(', ')}`);
    if (wantDefects) {
      for (const d of m.defects) console.log(`  ${d.id} ${d.present ? 'PRESENT' : 'absent '} ${d.rule}${d.evidence ? ` — ${d.evidence}` : ''}`);
      console.log(`defect classes present: ${m.defectClassesPresent} of ${m.defects.length}`);
    }
  }
  process.exit(0);
}
