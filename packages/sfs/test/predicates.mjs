// The golden-defect predicates and the count identities, as ONE implementation with
// two callers (section 2.6): `golden-defects.test.mjs` runs them under `npm test`, and
// `g-sfs-invariants` will run the identical functions. Two copies would let the test
// and the gate disagree about what a defect is, which is the drift this file prevents.
//
// Every predicate takes the PARSED markup and returns {ok, detail}. None of them takes
// a number from the brief: the count rules are arithmetic identities over the tree, so
// they hold for any form rather than for one measured artifact.
//
// The predicates are KIND-AWARE (D-091): the golden is a list, but the same rules hold
// for create/detail/datalist forms. N1 exempts labelled INPUT types (the registry's
// editModeChannel:"input" records), and N8 checks the emitted formSettings against the
// kind profile inferred from its own loader/submitter signature, rather than hardcoding
// the list's dataSubmitterType:"none".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'registry', 'data', '0.45.1');
/** @param {string} f @returns {any} */
const readData = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^﻿/, ''));
const REG = readData('components.json');
const FORM_SETTINGS = readData('form-settings.json');
/** Component types whose emitted `hideLabel` is legitimately false — labelled inputs. */
const INPUT_LABEL_TYPES = new Set(
  Object.entries(REG.components).filter(([, r]) => /** @type {any} */ (r).editModeChannel === 'input').map(([t]) => t));

/** A `label` no designer wrote: the framework's auto-name shape (N1). */
export const AUTO_LABEL = /^[A-Z][a-z]+\d+$/;

/** Legacy styling props that must never be emitted alongside v7 channels (N5). */
export const LEGACY_STYLE_PROPS = new Set([
  'fontSize', 'fontWeight', 'backgroundColor', 'customStyle', 'style',
  'borderRadius', 'boxShadow', 'color',
]);

/** The four appearance channels that must be identical across breakpoints (N2). */
export const APPEARANCE_CHANNELS = ['font', 'background', 'border', 'shadow'];

/** @typedef {{ok:boolean, detail:string}} Verdict */
/** @typedef {{components:Record<string, unknown>[], formSettings:Record<string, unknown>}} Markup */

/**
 * Every component in the tree, slots included.
 * @param {Markup} markup
 * @returns {Record<string, unknown>[]}
 */
export function allNodes(markup) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  /** @param {unknown[]} arr @returns {void} */
  const walk = (arr) => {
    for (const raw of arr || []) {
      const n = /** @type {Record<string, unknown>} */ (raw);
      out.push(n);
      if (Array.isArray(n.components)) walk(n.components);
      for (const slot of ['content', 'header']) {
        const w = /** @type {Record<string, unknown>|undefined} */ (n[slot]);
        if (w !== undefined && w !== null && typeof w === 'object' && Array.isArray(w.components)) walk(w.components);
      }
    }
  };
  walk(markup.components);
  return out;
}

/** @param {boolean} ok @param {string} detail @returns {Verdict} */
const v = (ok, detail) => ({ ok, detail });

/** @param {unknown} x @returns {string} */
const j = (x) => JSON.stringify(x);

// ---- N1..N11, one function each -------------------------------------------------

/** @param {Markup} m @returns {Verdict} */
export function n1LabelDefaults(m) {
  const nodes = allNodes(m);
  const auto = nodes.filter((n) => typeof n.label === 'string' && AUTO_LABEL.test(n.label));
  if (auto.length > 0) return v(false, `${auto.length} node(s) carry an auto-shaped label, e.g. "${String(/** @type {Record<string, unknown>} */ (auto[0]).label)}"`);
  // A labelled input (registry editModeChannel:"input") legitimately shows its label;
  // every other node hides it. `field`/`select` compile to those input types.
  const shown = nodes.filter((n) => !INPUT_LABEL_TYPES.has(String(n.type)) && n.hideLabel !== true);
  if (shown.length > 0) return v(false, `${shown.length} non-input node(s) do not set hideLabel:true, e.g. ${String(/** @type {Record<string, unknown>} */ (shown[0]).componentName)}`);
  const orphanAlign = nodes.filter((n) => n.labelAlign !== undefined && n.label === undefined);
  if (orphanAlign.length > 0) return v(false, `${orphanAlign.length} node(s) carry labelAlign with no label`);
  return v(true, `${nodes.length} node(s): no auto-label, every non-field hides its label, no orphan labelAlign`);
}

/** @param {Markup} m @returns {Verdict} */
export function n2AppearanceOncePerNode(m) {
  for (const n of allNodes(m)) {
    if (n.desktop === undefined) continue;
    for (const ch of APPEARANCE_CHANNELS) {
      const d = j(/** @type {Record<string, unknown>} */ (n.desktop)[ch]);
      const t = j(/** @type {Record<string, unknown>} */ (n.tablet)[ch]);
      const mo = j(/** @type {Record<string, unknown>} */ (n.mobile)[ch]);
      if (d !== t || t !== mo) {
        return v(false, `${String(n.componentName)}.${ch} differs across breakpoints: desktop ${d} tablet ${t} mobile ${mo}`);
      }
    }
  }
  return v(true, `all four appearance channels identical across the three blocks on every styled node`);
}

/** @param {Markup} m @returns {Verdict} */
export function n3ClassParity(m) {
  for (const n of allNodes(m)) {
    if (n.desktop === undefined) continue;
    const seen = ['desktop', 'tablet', 'mobile'].map((b) => /** @type {Record<string, unknown>} */ (n[b]).className);
    if (!seen.every((c) => c === seen[0])) return v(false, `${String(n.componentName)} className differs: ${j(seen)}`);
  }
  return v(true, 'className identical in all three blocks wherever present');
}

/** @param {Markup} m @returns {Verdict} */
export function n4PageShellGeometry(m) {
  const shell = /** @type {Record<string, unknown>} */ (m.components[0]);
  if (shell === undefined || shell.type !== 'card') return v(true, 'no page shell in this form (modal kind)');
  for (const b of ['desktop', 'tablet', 'mobile']) {
    const dims = /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (shell[b]).dimensions);
    if (dims.height !== 'auto') return v(false, `page shell ${b}.dimensions.height is ${j(dims.height)}, not "auto"`);
  }
  // No ancestor of a datatable may pin a px height, which is the defect's real harm.
  const pinned = allNodes(m).filter((n) => {
    const d = /** @type {Record<string, unknown>|undefined} */ (n.desktop);
    const dims = d === undefined ? undefined : /** @type {Record<string, unknown>|undefined} */ (d.dimensions);
    return dims !== undefined && typeof dims.height === 'string' && /^\d+px$/.test(dims.height);
  });
  if (pinned.length > 0) return v(false, `${pinned.length} node(s) pin a px height, e.g. ${String(/** @type {Record<string, unknown>} */ (pinned[0]).componentName)}`);
  return v(true, 'page shell height auto at all three breakpoints; no node pins a px height');
}

/** @param {Markup} m @returns {Verdict} */
export function n5SingleStylingChannel(m) {
  const nodes = allNodes(m);
  for (const n of nodes) {
    const leaked = Object.keys(n).filter((k) => LEGACY_STYLE_PROPS.has(k));
    if (leaked.length > 0) return v(false, `${String(n.componentName)} emitted legacy styling prop(s) ${leaked.join(', ')}`);
  }
  const texts = nodes.filter((n) => n.type === 'text');
  for (const t of texts) {
    const d = /** @type {Record<string, unknown>|undefined} */ (t.desktop);
    const font = d === undefined ? undefined : /** @type {Record<string, unknown>|undefined} */ (d.font);
    if (font === undefined || font.size === undefined) return v(false, `text node ${String(t.componentName)} has no desktop.font.size`);
  }
  return v(true, `no legacy styling prop on ${nodes.length} node(s); all ${texts.length} text node(s) carry desktop.font.size`);
}

/** @param {Markup} m @returns {Verdict} */
export function n6StylingBoxPlacement(m) {
  let inBlocks = 0;
  for (const n of allNodes(m)) {
    if (n.stylingBox !== undefined && n.stylingBox !== '{}') {
      return v(false, `${String(n.componentName)} base stylingBox is ${j(n.stylingBox)}, not "{}"`);
    }
    for (const b of ['desktop', 'tablet', 'mobile']) {
      const block = /** @type {Record<string, unknown>|undefined} */ (n[b]);
      if (block === undefined || block.stylingBox === undefined) continue;
      try { JSON.parse(String(block.stylingBox)); } catch {
        return v(false, `${String(n.componentName)}.${b}.stylingBox is not parseable JSON: ${j(block.stylingBox)}`);
      }
      inBlocks += 1;
    }
  }
  return v(true, `every base stylingBox is "{}"; ${inBlocks} block-level stylingBox value(s) parse`);
}

/** @param {Markup} m @returns {Verdict} */
export function n7OneWiringPerEvent(m) {
  const tables = allNodes(m).filter((n) => n.type === 'datatable' || n.type === 'childTable');
  for (const t of tables) {
    if (t.onRowClick !== undefined) return v(false, `${String(t.componentName)} still carries a code-mode onRowClick`);
    if (t.rowClickActionConfiguration !== undefined && t.dblClickActionConfiguration !== undefined) {
      return v(false, `${String(t.componentName)} wires both row click and double click; SFS declared one`);
    }
  }
  const wired = tables.filter((t) => t.rowClickActionConfiguration !== undefined);
  return v(true, `${wired.length} of ${tables.length} table(s) wire row click, each through exactly one channel`);
}

/** @param {Markup} m @returns {Verdict} */
export function n8FormSettingsByKind(m) {
  const f = m.formSettings;
  if (f.version !== FORM_SETTINGS.base.version) return v(false, `formSettings.version is ${j(f.version)}, not ${FORM_SETTINGS.base.version}`);

  // Infer the kind from the emitted loader/submitter signature (§2.1.3), the same
  // inversion the decompiler uses — a table wins over the submitter (a list with a
  // submitter is the N8 defect, not an edit form).
  let hasTable = false;
  for (const n of allNodes(m)) if (n.type === 'datatable' || n.type === 'datalist') hasTable = true;
  const loader = f.dataLoaderType;
  const submitter = f.dataSubmitterType;
  const kind = hasTable && loader === 'gql' ? 'list'
    : loader === 'gql' && submitter === 'none' ? 'detail'
      : loader === 'none' && submitter === 'gql' ? 'create'
        : loader === 'gql' && submitter === 'gql' ? 'edit' : 'custom';
  const profile = FORM_SETTINGS.kinds[kind];
  if (profile === undefined) return v(false, `no kind profile for inferred kind ${j(kind)}`);

  // Every hook key must be PRESENT (D-104: present-and-null is legal); a NON-null
  // hook must be legal for this kind. onBeforeDataLoad is legal for no kind (D-102).
  for (const key of FORM_SETTINGS._hookKeys) {
    if (!(key in f)) return v(false, `hook "${key}" is absent; present-and-null is the legal shape (D-104)`);
    if (f[key] !== null && !profile.hooks.includes(key)) {
      return v(false, `${key} is ${j(f[key])} but not legal for kind ${j(kind)} (D-102/N8)`);
    }
  }
  // A read-only kind (no submitter) never carries submitter settings — the golden's defect.
  if (submitter === 'none' && f.dataSubmittersSettings !== undefined) {
    return v(false, `dataSubmittersSettings present with dataSubmitterType none (kind ${j(kind)})`);
  }
  return v(true, `formSettings consistent with inferred kind ${kind}: version ${f.version}, hooks gated, submitter ${j(submitter)}`);
}

/** @param {Markup} m @returns {Verdict} */
export function n9StackCoherence(m) {
  for (const n of allNodes(m)) {
    if (!Array.isArray(n.components)) continue;
    for (const b of ['desktop', 'tablet', 'mobile']) {
      const block = /** @type {Record<string, unknown>|undefined} */ (n[b]);
      if (block === undefined) continue;
      const wide = /** @type {Record<string, unknown>[]} */ (n.components).some((k) => {
        const kb = /** @type {Record<string, unknown>|undefined} */ (k[b]);
        const dims = kb === undefined ? undefined : /** @type {Record<string, unknown>|undefined} */ (kb.dimensions);
        return dims !== undefined && dims.width === '100%';
      });
      if (wide && block.flexDirection !== 'column') {
        return v(false, `${String(n.componentName)}.${b} is flexDirection ${j(block.flexDirection)} with a 100%-wide child`);
      }
    }
  }
  return v(true, 'no breakpoint block mixes row direction with a 100%-wide child');
}

/** @param {Markup} m @returns {Verdict} */
export function n10PageShellTopology(m) {
  const shell = /** @type {Record<string, unknown>} */ (m.components[0]);
  if (shell === undefined || shell.type !== 'card') return v(true, 'no page shell in this form (modal kind)');
  const content = /** @type {Record<string, unknown>} */ (shell.content);
  const kids = /** @type {Record<string, unknown>[]} */ (content.components);
  if (kids[0] === undefined || kids[0].componentName !== 'titleBand') {
    return v(false, `the page shell's first slot child is ${j(kids[0]?.componentName)}, not "titleBand"`);
  }
  const DATA_BEARING = new Set(['dataContext', 'datatable', 'datalist', 'datatable.pager', 'datatable.quickSearch']);
  /** @param {Record<string, unknown>} n @returns {boolean} */
  const bearsData = (n) => {
    if (DATA_BEARING.has(String(n.type))) return true;
    return /** @type {Record<string, unknown>[]} */ (n.components || []).some(bearsData);
  };
  if (bearsData(kids[0])) return v(false, 'a data-bearing node is a DESCENDANT of titleBand; the body must be its sibling');
  if (kids.length < 2) return v(false, 'the page shell has a title band and no body sibling');
  return v(true, `titleBand first, ${kids.length - 1} body sibling(s) after it, no data node inside the band`);
}

/** @param {Markup} m @returns {Verdict} */
export function n11CamelCaseBindings(m) {
  const CAMEL = /^[a-z][A-Za-z0-9.]*$/;
  for (const n of allNodes(m)) {
    if (typeof n.propertyName === 'string' && !CAMEL.test(n.propertyName)) {
      return v(false, `propertyName ${j(n.propertyName)} on ${String(n.type)} is not camelCase`);
    }
    for (const raw of /** @type {Record<string, unknown>[]} */ (n.items || [])) {
      const p = raw.propertyName;
      if (typeof p === 'string' && !CAMEL.test(p)) return v(false, `column propertyName ${j(p)} is not camelCase`);
    }
  }
  return v(true, 'every propertyName and every column propertyName is camelCase');
}

/** @param {Markup} m @returns {Verdict} */
export function notEditableTriplet(m) {
  let checked = 0;
  for (const n of allNodes(m)) {
    if (n.type !== 'datatable' && n.type !== 'childTable') continue;
    const inline = n.canEditInline === 'yes';
    for (const raw of /** @type {Record<string, unknown>[]} */ (n.items || [])) {
      if (raw.columnType !== 'data') continue;
      const display = /** @type {Record<string, unknown>|undefined} */ (raw.displayComponent);
      if (display === undefined) return v(false, `column ${j(raw.caption)} has no displayComponent`);
      if (display.type === '[not-editable]') return v(false, `column ${j(raw.caption)} uses [not-editable] to DISPLAY`);
      if (inline) { checked += 1; continue; }
      const edit = /** @type {Record<string, unknown>|undefined} */ (raw.editComponent);
      const create = /** @type {Record<string, unknown>|undefined} */ (raw.createComponent);
      if (edit?.type !== '[not-editable]' || create?.type !== '[not-editable]') {
        return v(false, `column ${j(raw.caption)} is non-inline but its edit/create pair is ${j([edit?.type, create?.type])}`);
      }
      // EXP-4302 ([default] on edit/create) needs no separate branch: the guard above
      // already requires both to be exactly [not-editable], so any other value —
      // [default] included — has already returned false.
      checked += 1;
    }
  }
  return v(true, `${checked} data column(s) carry a legal display/edit/create triplet`);
}

/**
 * A1..A5, as arithmetic identities over the counts the compiler derived.
 * @param {Record<string, number>} counts
 * @param {number} sfsBytes compact SFS bytes
 * @param {number} markupBytes
 * @returns {Record<string, Verdict>}
 */
export function identities(counts, sfsBytes, markupBytes) {
  // The compiler's report populates every count key; treat them as definite numbers.
  const c = /** @type {{ids:number, components:number, slots:number, items:number, styledComponents:number, breakpointBlocks:number, distinctTypeVersions:number, distinctTypes:number}} */ (counts);
  const ratio = markupBytes / sfsBytes;
  return {
    // The identity itself is total. The per-fixture non-vacuity guard is on
    // `components` alone — every form has components. `slots` exists only where a
    // slotted type does, and `items` only where a table/action group does; demanding
    // either per fixture would silently require every fixture to be a page-shell list.
    // Non-vacuity of `slots` AND `items` is asserted across the fixture SET by
    // golden-defects.test.mjs (D-080, D-091).
    A1: c.ids === c.components + c.slots + c.items && c.components > 0
      ? v(true, `ids ${c.ids} = components ${c.components} + slots ${c.slots} + items ${c.items}`)
      : v(false, `ids ${c.ids} != components ${c.components} + slots ${c.slots} + items ${c.items} (components must be > 0)`),
    A2: c.breakpointBlocks === 3 * c.styledComponents
      ? v(true, `breakpointBlocks ${c.breakpointBlocks} = 3 x ${c.styledComponents}`)
      : v(false, `breakpointBlocks ${c.breakpointBlocks} != 3 x ${c.styledComponents}`),
    A3: c.components >= 8
      ? v(true, `components ${c.components} >= 8`)
      : v(false, `components ${c.components} < 8`),
    A4: c.distinctTypeVersions === c.distinctTypes
      ? v(true, `${c.distinctTypeVersions} type/version pair(s) over ${c.distinctTypes} type(s): one version per type`)
      : v(false, `${c.distinctTypeVersions} type/version pair(s) but only ${c.distinctTypes} type(s): a type carries two versions`),
    A5: ratio >= 8
      ? v(true, `markup/sfs ratio ${ratio.toFixed(2)} >= 8`)
      : v(false, `markup/sfs ratio ${ratio.toFixed(2)} < 8 (markup ${markupBytes} B, sfs ${sfsBytes} B)`),
  };
}

/** Every defect predicate, by the rule id it enforces. One registry, both callers. */
export const PREDICATES = {
  N1: n1LabelDefaults,
  N2: n2AppearanceOncePerNode,
  N3: n3ClassParity,
  N4: n4PageShellGeometry,
  N5: n5SingleStylingChannel,
  N6: n6StylingBoxPlacement,
  N7: n7OneWiringPerEvent,
  N8: n8FormSettingsByKind,
  N9: n9StackCoherence,
  N10: n10PageShellTopology,
  N11: n11CamelCaseBindings,
  TRIPLET: notEditableTriplet,
};
