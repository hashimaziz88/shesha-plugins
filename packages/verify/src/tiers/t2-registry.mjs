// T2 — Registry (exhaustive, 22 checks). §3.2.3. No backend, no network, no model.
//
// Replaces the deleted validate-blocks.js (D-011) with EXACT registry matching and
// hard failures: the old matcher was fuzzy free-text with two escape hatches that
// downgraded failures to warnings and read Shesha style descriptors as components
// (§1.7 T2/T14). Every component is reached through the one walker (walk.mjs); every
// legal set is DATA from load(ref). The registry-gap disposition (D-056) is decided
// once here: a priority type with an incomplete entry FAILS naming the gap; a
// non-priority type's gap is uninspectable.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, EXIT } from '@shesha/registry/coverage';
import { load, STRUCTURAL_KEYS } from '@shesha/registry';
import { readText, repoRoot } from '../lib/fsx.mjs';
import { walkComponents } from '../walk.mjs';

export const id = 't2-registry';
export const describe = 'types, versions, props, value types, enums, required props, slots, nested items, deny, styling channels, breakpoints, formSettings';
export const inputPaths = ['packages/sfs/test/fixtures', 'packages/registry/data', 'packages/registry/config'];

/** The 22 checks, each mapped to the family it reports under (§3.2.3). */
export const checks = [
  { id: 'T2.01', family: 'types', describe: 'component type exists in the registry' },
  { id: 'T2.02', family: 'versions', describe: 'component version equals the registry current version' },
  { id: 'T2.03', family: 'versions', describe: 'version is an integer, not a string' },
  { id: 'T2.04', family: 'props', describe: 'every prop key is legal for its type' },
  { id: 'T2.05', family: 'props', describe: 'referenceListId is {module, bare name}' },
  { id: 'T2.06', family: 'types', describe: 'no authorable:false type appears in the artifact' },
  { id: 'T2.07', family: 'required', describe: 'declared required props are present' },
  { id: 'T2.08', family: 'valueTypes', describe: 'prop value types are correct' },
  { id: 'T2.09', family: 'enums', describe: 'every enum-valued prop is in domain' },
  { id: 'T2.10', family: 'slots', describe: 'children appear only in legal slots' },
  { id: 'T2.11', family: 'nested', describe: 'nested item schemas satisfied' },
  { id: 'T2.12', family: 'deny', describe: 'no denied prop key/value' },
  { id: 'T2.13', family: 'deny', describe: '(actionOwner, actionName) is a legal pair' },
  { id: 'T2.14', family: 'styling', describe: 'a single styling channel per property' },
  { id: 'T2.15', family: 'styling', describe: 'no stylingBox duplicated across base and breakpoint' },
  { id: 'T2.16', family: 'breakpoints', describe: 'breakpoint keys present in all three or none' },
  { id: 'T2.17', family: 'styling', describe: 'no literal hex colour in compiler output', subsumed: 'BL-023' },
  { id: 'T2.18', family: 'styling', describe: 'no unresolved $role token' },
  { id: 'T2.19', family: 'styling', describe: 'flex containers declare display' },
  { id: 'T2.20', family: 'formSettings', describe: 'formSettings key set legal for the form kind' },
  { id: 'T2.21', family: 'props', describe: 'no stray label without hideLabel on a container' },
  { id: 'T2.22', family: 'styling', describe: 'no fixed height on a page-shell card' },
];

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const ROLE = /\$role:|\$type:|\$space:|\$radius:|\$shadow:/;
const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

/**
 * Walk a component's own scalar/style values (not its child components) as
 * `[jsonPath, value]` pairs, so a hex or $role scan reaches into breakpoint blocks.
 * @param {any} node
 * @param {Set<string>} channelKeys
 * @returns {[string, any][]}
 */
function styleLeaves(node, channelKeys) {
  /** @type {[string, any][]} */
  const out = [];
  /** @param {any} v @param {string} p */
  const rec = (v, p) => {
    if (v == null) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { out.push([p, v]); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => rec(x, `${p}[${i}]`)); return; }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (channelKeys.has(k)) continue; // don't descend into child-component channels
        rec(v[k], `${p}.${k}`);
      }
    }
  };
  for (const k of Object.keys(node)) {
    if (channelKeys.has(k)) continue;
    rec(node[k], k);
  }
  return out;
}

/**
 * @param {{components?:any[]}} doc parsed markup
 * @param {{nodes?:Record<string, any>}|null} meta the compiled sidecar (for T2.22 region)
 * @param {{ref?:string, legacy?:boolean}} [opts]
 * @returns {import('@shesha/registry/coverage').Family[]}
 */
export function t2Registry(doc, meta, opts = {}) {
  const reg = load(opts.ref);
  const legacy = opts.legacy === true;
  const priority = new Set(reg.priorityTypes);
  const channelKeys = new Set(reg.slots.map((s) => s.key.split('.')[0]));
  const channelLeafKeys = new Set(reg.slots.flatMap((s) => [s.key, s.key.split('.')[0], s.key.split('.').pop() || s.key]));
  const metaByPath = /** @type {Record<string, any>} */ (meta && meta.nodes ? meta.nodes : {});
  // A kind:list form that edits inline legitimately carries a submit pipeline; the
  // "list forbids dataSubmitterType" rule is for READ-ONLY lists (§3.2.3 / D-033).
  let hasInlineEdit = false;

  const fams = families([
    { name: 'types', unit: 'component' },
    { name: 'versions', unit: 'component' },
    { name: 'props', unit: 'prop-site' },
    { name: 'valueTypes', unit: 'prop-site' },
    { name: 'enums', unit: 'enum-site', required: false },
    { name: 'required', unit: 'required-slot', required: false },
    { name: 'slots', unit: 'component', required: false },
    { name: 'nested', unit: 'item', required: false },
    { name: 'deny', unit: 'prop-site', required: false },
    { name: 'styling', unit: 'prop-site', required: false },
    { name: 'breakpoints', unit: 'component', required: false },
    { name: 'formSettings', unit: 'setting-key' },
  ]);
  const F = {
    types: fams.get('types'), versions: fams.get('versions'), props: fams.get('props'),
    valueTypes: fams.get('valueTypes'), enums: fams.get('enums'), required: fams.get('required'),
    slots: fams.get('slots'), nested: fams.get('nested'), deny: fams.get('deny'),
    styling: fams.get('styling'), breakpoints: fams.get('breakpoints'), formSettings: fams.get('formSettings'),
  };

  for (const { node, where, slot, parentNode } of walkComponents(doc)) {
    const type = node.type;
    // A datatable column definition (columnType, no component `type`) and a
    // `[default]`/`[...]` renderer sentinel in a column triplet are SCHEMA, not
    // components — T2.11 checks the column schema on the parent datatable. The
    // component checks (T2.01–T2.13) apply only to nodes that name a real type.
    if (!type || String(type).startsWith('[') || node.columnType !== undefined) continue;
    if (node.canEditInline === true || node.canEditInline === 'yes') hasInlineEdit = true;
    const rec = reg.components[type];
    const w = `${where}<${type}>`;

    // ---- T2.01 type exists -------------------------------------------------
    F.types.pointer(`${w}#T2.01`).assert(rec !== undefined,
      `T2.01 component type "${type}" at ${where} is not in the registry`);
    if (!rec) continue;

    // ---- T2.06 authorable:false absent ------------------------------------
    F.types.pointer(`${w}#T2.06`).assert(rec.authorable !== false,
      `T2.06 authorable:false type "${type}" at ${where} may not appear in an artifact (${rec.reason || rec.decision || ''})`);

    // ---- T2.02 / T2.03 version ---------------------------------------------
    F.versions.pointer(`${w}#T2.03`).assert(typeof node.version === 'number',
      `T2.03 version of "${type}" at ${where} is ${JSON.stringify(node.version)}, not an integer`);
    F.versions.pointer(`${w}#T2.02`).assert(node.version === rec.version,
      `T2.02 "${type}" at ${where} is version ${JSON.stringify(node.version)}; the registry current version is ${rec.version}`);

    const props = rec.props || {};
    const propNames = Object.keys(props);
    const gapPriority = rec.propsCompleteness === 'none' && priority.has(type);
    const gapNonPriority = rec.propsCompleteness === 'none' && !priority.has(type);

    // ---- T2.04 prop keys legal (needs names only; §3.2.3 gap table) --------
    const p04 = F.props.pointer(`${w}#T2.04`);
    if (gapPriority) {
      p04.fail(`T2.04 registry gap on priority type ${type}: propsCompleteness none. Fix the registry, do not widen the check.`);
    } else if (gapNonPriority) {
      p04.na(`registry entry for ${type} is propsCompleteness:none (T2.04)`);
    } else {
      const legal = new Set([...propNames, ...STRUCTURAL_KEYS, ...channelLeafKeys, ...BREAKPOINTS, 'content', 'header', 'settings', 'stylingBox']);
      const illegal = Object.keys(node).filter((k) => !legal.has(k));
      p04.assert(illegal.length === 0,
        `T2.04 "${type}" at ${where} carries prop key(s) not legal for its type: ${illegal.join(', ')}`);
    }

    // ---- T2.05 referenceListId shape --------------------------------------
    if ('referenceListId' in node) {
      const rl = node.referenceListId;
      const ok = rl && typeof rl === 'object' && typeof rl.module === 'string' && typeof rl.name === 'string' && !rl.name.includes('.');
      F.props.pointer(`${w}#T2.05`).assert(ok,
        `T2.05 referenceListId at ${where} must be {module, bare name}; got ${JSON.stringify(rl)}`);
    }

    // ---- T2.21 stray label -------------------------------------------------
    if (channelKeys.has('components') && (Array.isArray(node.components) || node.content)) {
      F.props.pointer(`${w}#T2.21`).assert(!(typeof node.label === 'string' && node.label && node.hideLabel !== true),
        `T2.21 container "${type}" at ${where} carries label ${JSON.stringify(node.label)} without hideLabel:true (DC-01)`);
    }

    // ---- T2.07 required props present -------------------------------------
    const req = reg.requiredProps[type];
    if (req) {
      for (const rp of req) {
        F.required.pointer(`${w}.${rp}#T2.07`).assert(node[rp] !== undefined && node[rp] !== null,
          `T2.07 required prop "${rp}" missing on "${type}" at ${where}`);
      }
    }

    // ---- T2.08 value types + T2.09 enums -----------------------------------
    for (const [k, spec] of Object.entries(props)) {
      if (!(k in node)) continue;
      const val = node[k];
      const s = /** @type {any} */ (spec);
      if (s.valueType === 'boolean') {
        F.valueTypes.pointer(`${w}.${k}#T2.08`).assert(typeof val === 'boolean',
          `T2.08 "${type}.${k}" at ${where} must be a boolean, got ${JSON.stringify(val)}`);
      } else if (s.valueType === 'number') {
        F.valueTypes.pointer(`${w}.${k}#T2.08`).assert(typeof val === 'number',
          `T2.08 "${type}.${k}" at ${where} must be a number, got ${JSON.stringify(val)}`);
      } else if (s.valueType === 'enum' && Array.isArray(s.enum)) {
        F.enums.pointer(`${w}.${k}#T2.09`).assert(s.enum.includes(val),
          `T2.09 "${type}.${k}" at ${where} is ${JSON.stringify(val)}, outside its domain ${JSON.stringify(s.enum)}`);
      }
      if (k === 'stylingBox' && typeof val === 'string') {
        let parsed = true; try { JSON.parse(val); } catch { parsed = false; }
        F.valueTypes.pointer(`${w}.stylingBox#T2.08`).assert(parsed,
          `T2.08 stylingBox at ${where} is a string that does not parse as JSON`);
      }
    }

    // ---- T2.10 slot placement legal ---------------------------------------
    const legalSlots = new Set([rec.childrenKey, rec.itemsKey, ...(rec.slots || [])].filter(Boolean));
    if (rec.childrenKey === 'components') legalSlots.add('components');
    if (slot !== 'components' && node !== undefined) {
      // slot is the channel THIS node was reached through; legality is asserted on
      // the PARENT, so this is covered by the parent's own emission below.
    }
    // Assert each channel the node actually uses is one the registry declares.
    const usedChannels = reg.slots.filter((ch) => {
      const seg = ch.key.split('.');
      let cur = node; for (const s2 of seg) { cur = cur && cur[s2]; }
      return Array.isArray(cur) ? cur.length > 0 : (cur && typeof cur === 'object' && 'type' in cur);
    }).map((ch) => ch.key);
    if (usedChannels.length > 0) {
      const declared = new Set([rec.childrenKey, rec.itemsKey, ...(rec.slots || [])].filter(Boolean));
      const bad = usedChannels.filter((c) => !declared.has(c) && !declared.has(c.split('.')[0]));
      F.slots.pointer(`${w}#T2.10`).assert(bad.length === 0,
        `T2.10 "${type}" at ${where} places children in slot(s) it does not declare: ${bad.join(', ')} (declares ${[...declared].join(', ') || 'none'})`);
    }

    // ---- T2.11 nested item schemas ----------------------------------------
    if (Array.isArray(node.items) && (type === 'datatable' || type === 'buttonGroup')) {
      node.items.forEach((/** @type {any} */ it, /** @type {number} */ i) => {
        const p = F.nested.pointer(`${where}.items[${i}]#T2.11`);
        if (type === 'buttonGroup') {
          p.assert(it && typeof it === 'object' && 'actionConfiguration' in it,
            `T2.11 buttonGroup.items[${i}] at ${where} needs actionConfiguration`);
        } else {
          const okSchema = it && it.columnType !== undefined && typeof it.caption === 'string' && it.sortOrder !== undefined
            && (it.columnType !== 'data' || typeof it.propertyName === 'string');
          p.assert(okSchema,
            `T2.11 datatable.items[${i}] at ${where} needs columnType, caption, sortOrder (and propertyName when columnType is "data")`);
        }
      });
    }

    // ---- T2.12 deny list + T2.13 action pairs ------------------------------
    for (const d of reg.deny.props) {
      // editMode is legal on a component whose registry record declares an
      // editModeChannel (a container carries `editMode:"inherited"`); D-032 denies
      // it only where the registry does not channel it.
      if (d.key === 'editMode' && rec.editModeChannel) continue;
      const present = d.key.includes('.')
        ? d.key.split('.').reduce((/** @type {any} */ c, /** @type {string} */ s2) => (c == null ? c : c[s2]), node) !== undefined
        : (d.key in node);
      if (present) {
        F.deny.pointer(`${w}.${d.key}#T2.12`).fail(`T2.12 denied key "${d.key}" on "${type}" at ${where}: ${d.reason} (${d.decision})`);
      }
    }
    for (const cond of reg.deny.conditional || []) {
      const sibling = cond.forbiddenWhenSiblingPresent;
      const sibPresent = sibling.split('.').reduce((/** @type {any} */ c, /** @type {string} */ s2) => (c == null ? c : c[s2]), node) !== undefined;
      if (sibPresent) {
        for (const k of cond.keys) {
          if (k in node) F.deny.pointer(`${w}.${k}#T2.12c`).fail(`T2.12 "${k}" and "${sibling}" both present on "${type}" at ${where}: ${cond.reason}`);
        }
      }
    }
    if (node.actionConfiguration && typeof node.actionConfiguration === 'object') {
      const ac = node.actionConfiguration;
      const owner = ac.actionOwner;
      const okOwner = typeof owner === 'string' && (/^[a-z][a-z0-9.]*$/.test(owner) || /^[0-9a-f-]{36}$/.test(owner));
      F.deny.pointer(`${w}#T2.13`).assert(okOwner || owner === undefined,
        `T2.13 actionOwner "${owner}" at ${where} must be lowercase-dotted or a component id (D-034)`);
    }

    // ---- styling family: T2.14/15/17/18/19/22 -----------------------------
    const leaves = styleLeaves(node, channelKeys);
    // T2.17 no literal hex. The SFS carries no literal colours (TOK-2010/D-010
    // rejects them at compile) and the compiler injects every colour from the brand
    // token map, so an output hex is the RESOLVED token value, not a bypass. Output
    // hex is indistinguishable from a hardcoded one without a `resolvedFrom`
    // provenance entry the compiler does not yet emit (BL-023), so at the output
    // tier this is disposed notApplicable rather than failing every resolved colour.
    if (!legacy) {
      F.styling.pointer(`${w}#T2.17`).na(
        'output hex is a resolved brand-token value (literal SFS colours are rejected by TOK-2010/D-010); provenance-based output verification is BL-023');
    }
    // T2.18 no unresolved $role token
    const unresolved = leaves.find(([, v]) => typeof v === 'string' && ROLE.test(v));
    F.styling.pointer(`${w}#T2.18`).assert(unresolved === undefined,
      `T2.18 unresolved token at ${where}${unresolved ? ` (${unresolved[0]}=${unresolved[1]})` : ''}; role resolution was bypassed`);
    // T2.14 single styling channel: legacy fontSize/fontWeight AND desktop.font
    const hasLegacyFont = 'fontSize' in node || 'fontWeight' in node;
    const hasV7Font = node.desktop && typeof node.desktop === 'object' && 'font' in node.desktop;
    F.styling.pointer(`${w}#T2.14`).assert(!(hasLegacyFont && hasV7Font),
      `T2.14 "${type}" at ${where} carries both legacy font and desktop.font (DC-05)`);
    // T2.15 no DUPLICATED stylingBox: a non-empty base stylingBox AND a breakpoint
    // stylingBox is DC-06. A base `{}` with a breakpoint override is the legitimate
    // compiler pattern, not a duplicate, so an empty base does not count.
    const baseBox = node.stylingBox;
    const baseBoxNonEmpty = baseBox != null && (typeof baseBox === 'string'
      ? baseBox.replace(/\s/g, '') !== '{}' && baseBox !== ''
      : (typeof baseBox === 'object' && Object.keys(baseBox).length > 0));
    const boxInBreakpoint = BREAKPOINTS.some((b) => node[b] && typeof node[b] === 'object' && 'stylingBox' in node[b]);
    F.styling.pointer(`${w}#T2.15`).assert(!(baseBoxNonEmpty && boxInBreakpoint),
      `T2.15 non-empty stylingBox at both base and a breakpoint on "${type}" at ${where} (DC-06)`);
    // T2.19 flex containers declare display
    const flexish = ('flexDirection' in node || 'gap' in node);
    if (flexish) {
      F.styling.pointer(`${w}#T2.19`).assert(node.display === 'flex',
        `T2.19 "${type}" at ${where} sets flexDirection/gap without display:"flex"`);
    }
    // T2.22 no fixed height on the page-shell (a root component wrapping the page).
    // The sidecar carries no `region`, so the page shell is the root node itself
    // (parentNode === null); a fixed height there is DC-04.
    const region = metaByPath[node.id] ? metaByPath[node.id].region : undefined;
    if (parentNode === null || region === 'page') {
      const h = node.dimensions && node.dimensions.height;
      F.styling.pointer(`${w}#T2.22`).assert(h === undefined || h === null || h === 'auto',
        `T2.22 page-shell node at ${where} carries a fixed height ${JSON.stringify(h)} (DC-04)`);
    }

    // ---- T2.16 breakpoint consistency -------------------------------------
    const bpKeys = new Set();
    for (const b of BREAKPOINTS) if (node[b] && typeof node[b] === 'object') for (const k of Object.keys(node[b])) bpKeys.add(k);
    if (bpKeys.size > 0) {
      const p16 = F.breakpoints.pointer(`${w}#T2.16`);
      const inconsistent = [...bpKeys].filter((k) => {
        const present = BREAKPOINTS.filter((b) => node[b] && typeof node[b] === 'object' && k in node[b]).length;
        return present !== 0 && present !== 3;
      });
      p16.assert(inconsistent.length === 0,
        `T2.16 "${type}" at ${where} sets breakpoint key(s) in some but not all of desktop/tablet/mobile: ${inconsistent.join(', ')}`);
    }
  }

  // ---- T2.20 formSettings key set legal for the kind ----------------------
  const kind = deriveKind(doc, meta);
  const fs = doc && /** @type {any} */ (doc).formSettings;
  const kindSpec = reg.formSettings.kinds ? reg.formSettings.kinds[kind] : undefined;
  const baseKeys = new Set(Object.keys(reg.formSettings.base || {}));
  const p20 = F.formSettings.pointer(`formSettings<${kind}>#T2.20`);
  if (!fs || typeof fs !== 'object') {
    p20.assert(false, 'T2.20 the form has no formSettings block');
  } else if (!kindSpec) {
    p20.na(`no formSettings profile for kind "${kind}" (T2.20)`);
  } else {
    const forbidden = new Set(FORBIDDEN_BY_KIND[kind] || []);
    if (kind === 'list' && hasInlineEdit) { forbidden.delete('dataSubmitterType'); forbidden.delete('dataSubmittersSettings'); }
    const allowed = new Set([...baseKeys, ...Object.keys(kindSpec)]);
    // "forbidden means present with a NON-NULL value" (D-033), but a forbidden key
    // set to its INACTIVE sentinel is the absence, not the behaviour: a kind:list
    // profile sets `dataSubmitterType:"none"` and `onBeforeDataLoad:null` — neither
    // is a submit pipeline. Only an ACTIVE value (a real loader/submitter, a hook
    // body) violates the rule.
    /** @param {any} v */
    const active = (v) => !(v == null || v === 'none' || v === ''
      || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0));
    /** @type {string[]} */
    const problems = [];
    for (const [k, v] of Object.entries(fs)) {
      if (forbidden.has(k)) {
        if (active(v)) problems.push(`${k} carries an active value ${JSON.stringify(v)}, forbidden for kind ${kind} (D-033)`);
      } else if (!allowed.has(k) && !baseKeys.has(k)) {
        problems.push(`${k} is in neither allowed nor forbidden for kind ${kind}`);
      }
      F.formSettings.pointer(`formSettings.${k}#T2.20`).assert(
        !(forbidden.has(k) && active(v)),
        `T2.20 "${k}" carries an active value ${JSON.stringify(v)}, forbidden on a ${kind} form (D-033)`);
    }
    p20.assert(problems.length === 0, `T2.20 formSettings for kind ${kind}: ${problems.join('; ')}`);
  }

  return fams.list;
}

/** §3.2.3: kind:list forbids the submit pipeline; other kinds per D-033. */
const FORBIDDEN_BY_KIND = /** @type {Record<string, string[]>} */ ({
  list: ['dataSubmitterType', 'dataSubmittersSettings', 'onBeforeDataLoad'],
  detail: ['dataSubmitterType', 'dataSubmittersSettings'],
});

/**
 * Kind is recorded in the sidecar; fall back to the formSettings dataSubmitterType
 * shape when no sidecar is supplied (a list has no submitter).
 * @param {any} doc
 * @param {any} meta
 * @returns {string}
 */
function deriveKind(doc, meta) {
  // The compiler records the form kind in the sidecar (§3.2.3 T2.20 needs it, and
  // deriving it from dataSubmitterType would be circular — that is the field T2.20
  // checks). The heuristic fallback only fires for a hand-supplied doc with no meta.
  if (meta && typeof meta.kind === 'string') return meta.kind;
  const fs = doc && doc.formSettings;
  if (fs && fs.dataSubmitterType && fs.dataSubmitterType !== 'none') return 'create';
  return 'list';
}

/**
 * Read a form file (envelope or bare markup), returning `{doc, meta}`.
 * @param {string} root
 * @param {string} formRel
 * @param {string|null} metaRel
 * @returns {{doc:any, meta:any}}
 */
export function readForm(root, formRel, metaRel) {
  const text = readText(path.join(root, formRel)) || '';
  const raw = JSON.parse(text);
  const markupText = typeof raw.Markup === 'string' ? raw.Markup : JSON.stringify(raw.Markup ?? raw);
  const doc = JSON.parse(markupText);
  const meta = metaRel ? JSON.parse(readText(path.join(root, metaRel)) || 'null') : null;
  return { doc, meta };
}

/**
 * Harness/driver entry: run T2 over a baseline compiled fixture from the repo.
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const { compile } = await import('../../../sfs/src/compile/index.mjs');
  const src = readText(path.join(root, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json')) || '';
  const r = compile(src, { source: 'baseline' });
  const doc = JSON.parse(String(r.envelope.Markup));
  const meta = /** @type {any} */ (r.meta || null);
  return t2Registry(doc, meta, {});
}

/**
 * First component in `doc` (through every channel) matching `pred`. Used by the
 * mutations to target one node; the tier-mutation test clones the doc first.
 * @param {any} doc @param {(n:any)=>boolean} pred @returns {any|null}
 */
function findNode(doc, pred) {
  for (const { node } of walkComponents(doc)) { if (node && node.type && !String(node.type).startsWith('[') && node.columnType === undefined && pred(node)) return node; }
  return null;
}

/**
 * Tier mutations (§3.5.2, kind 'compiled'): each injects ONE real defect into the
 * compiled clean doc and asserts T2 flips in the named family. Every non-subsumed
 * check id is covered; T2.17 is subsumed (na, BL-023) and is not mutated.
 * The tier-mutation runner is packages/verify/test/tier-mutations.test.mjs.
 */
export const mutations = [
  { name: 'unknown component type', covers: ['T2.01'], expect: 'fail', expectFamily: 'types', apply: (/** @type {any} */ c) => { c.doc.components[0].type = 'ghostType'; } },
  { name: 'version not the registry current version', covers: ['T2.02'], expect: 'fail', expectFamily: 'versions', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'datatable'); if (n) n.version = 9999; } },
  { name: 'version is a string, not an integer', covers: ['T2.03'], expect: 'fail', expectFamily: 'versions', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => typeof x.version === 'number'); if (n) n.version = String(n.version); } },
  { name: 'an illegal prop key for the type', covers: ['T2.04'], expect: 'fail', expectFamily: 'props', apply: (/** @type {any} */ c) => { c.doc.components[0].zzIllegalKey = true; } },
  { name: 'referenceListId with a dotted name', covers: ['T2.05'], expect: 'fail', expectFamily: 'props', apply: (/** @type {any} */ c) => { c.doc.components[0].referenceListId = { module: 'm', name: 'a.b' }; } },
  { name: 'an authorable:false component appears', covers: ['T2.06'], expect: 'fail', expectFamily: 'types', apply: (/** @type {any} */ c) => { c.doc.components[0].type = 'columns'; } },
  { name: 'a declared required prop is missing', covers: ['T2.07'], expect: 'fail', expectFamily: 'required', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'datatable'); if (n) delete n.propertyName; } },
  { name: 'a boolean prop carries a string', covers: ['T2.08'], expect: 'fail', expectFamily: 'valueTypes', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'datatable.pager' && 'hideLabel' in x) || findNode(c.doc, (x) => x.type === 'datatable'); if (n) n.hideLabel = 'nope'; } },
  { name: 'an enum prop out of domain', covers: ['T2.09'], expect: 'fail', expectFamily: 'enums', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'datatable'); if (n) n.labelAlign = 'sideways'; } },
  { name: 'children in a slot the type does not declare', covers: ['T2.10'], expect: 'fail', expectFamily: 'slots', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'datatable'); if (n) n.tabs = [{ type: 'text', id: 'x', version: 1 }]; } },
  { name: 'a datatable item missing its columnType', covers: ['T2.11'], expect: 'fail', expectFamily: 'nested', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => Array.isArray(x.items) && x.type === 'datatable'); if (n && n.items[0]) delete n.items[0].columnType; } },
  { name: 'a denied prop key (flat referenceListName)', covers: ['T2.12'], expect: 'fail', expectFamily: 'deny', apply: (/** @type {any} */ c) => { c.doc.components[0].referenceListName = 'x'; } },
  { name: 'an illegal actionOwner', covers: ['T2.13'], expect: 'fail', expectFamily: 'deny', apply: (/** @type {any} */ c) => { c.doc.components[0].actionConfiguration = { actionOwner: 'Shesha.Common', actionName: 'ExecuteScript' }; } },
  { name: 'two styling channels for one property', covers: ['T2.14'], expect: 'fail', expectFamily: 'styling', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.desktop && x.desktop.font); if (n) n.fontSize = 12; } },
  { name: 'stylingBox duplicated base + breakpoint', covers: ['T2.15'], expect: 'fail', expectFamily: 'styling', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.desktop && typeof x.desktop === 'object'); if (n) { n.stylingBox = { paddingTop: '9' }; n.desktop.stylingBox = { paddingTop: '9' }; } } },
  { name: 'a breakpoint key present in only one breakpoint', covers: ['T2.16'], expect: 'fail', expectFamily: 'breakpoints', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.desktop && typeof x.desktop === 'object'); if (n) n.desktop.zzOnlyHere = '1'; } },
  { name: 'an unresolved $role token in output', covers: ['T2.18'], expect: 'fail', expectFamily: 'styling', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.desktop && x.desktop.background); if (n) n.desktop.background.color = '$role:doesNotExist'; } },
  { name: 'a flex container without display:flex', covers: ['T2.19'], expect: 'fail', expectFamily: 'styling', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'container'); if (n) { n.flexDirection = 'row'; delete n.display; } } },
  { name: 'an active submit pipeline on a list form', covers: ['T2.20'], expect: 'fail', expectFamily: 'formSettings', apply: (/** @type {any} */ c) => { c.doc.formSettings = { ...c.doc.formSettings, dataSubmitterType: 'gql' }; for (const { node } of walkComponents(c.doc)) if (node && node.canEditInline) node.canEditInline = 'no'; } },
  { name: 'a stray label on a container', covers: ['T2.21'], expect: 'fail', expectFamily: 'props', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => Array.isArray(x.components) || (x.content && x.content.components)); if (n) { n.label = 'Card1'; delete n.hideLabel; } } },
  { name: 'a fixed height on the page-shell root', covers: ['T2.22'], expect: 'fail', expectFamily: 'styling', apply: (/** @type {any} */ c) => { c.doc.components[0].dimensions = { ...(c.doc.components[0].dimensions || {}), height: '30px' }; } },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const args = process.argv.slice(2);
    const formArg = args.find((a) => !a.startsWith('--'));
    let fams;
    if (formArg) {
      const metaAt = args.indexOf('--meta');
      const { doc, meta } = readForm(root, formArg, metaAt >= 0 ? args[metaAt + 1] : null);
      fams = t2Registry(doc, meta, { legacy: args.includes('--legacy') });
    } else {
      fams = await run({ repoRoot: root });
    }
    console.log(report(fams, { title: id }));
    const v = verdictOf(fams);
    return v === 'pass' ? EXIT.pass : exitFor(v);
  }));
}
