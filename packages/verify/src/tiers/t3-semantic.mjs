// T3 — Semantic / graph (§3.2.4). The offline core (WP-3b.3): the checks that read
// only the compiled tree, the sidecar and registry data — no backend, no metadata.
//
// This is the REWRITE the quarantine warned about (D-038/D-049): the old
// quarantine/t3-semantic.mjs was the verify-artifact CLI with its OWN verdictOf and
// walked/checked pair, which D-005 forbids in packages/**. This tier defines neither:
// it declares its family set with families() from the one coverage implementation and
// yields to the driver's verdictOf, exactly like t1-schema and t2-registry.
//
// Scope of THIS tier: the 10 offline checks below. The six backend-dependent checks
// (T3.01/02/05/06/07/09) and the datatype/action-owner registry checks (T3.03/T3.11)
// arrive with the metadata substrate in WP-3b.3c; the three contract checks
// (T3.20/21/22, over the placement predicate engine) arrive with the fixtures in
// WP-3b.3b. Each is added to `checks` in the WP that implements it, so
// g-mutation-coverage never sees an uncovered id.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, EXIT } from '@shesha/registry/coverage';
import { load } from '@shesha/registry';
import { readText, repoRoot } from '../lib/fsx.mjs';
import { walkComponents } from '../walk.mjs';
import { readForm } from './t2-registry.mjs';
import { evaluate } from '../predicates/index.mjs';

export const id = 't3-semantic';
export const describe = 'binding scope, references, data context, actions, submit/exit, embedded scripts, templating, row-click wiring — offline over the compiled tree';

/** The offline T3 checks (§3.2.4). Backend and contract checks are added by later sub-WPs. */
export const checks = [
  { id: 'T3.04', family: 'bindings', describe: 'no duplicate propertyName within one binding scope' },
  { id: 'T3.08', family: 'references', describe: 'a component whose registry entry requires formId carries a non-empty one' },
  { id: 'T3.10', family: 'actions', describe: 'every actionConfiguration.onSuccess target resolves to an in-tree id or a legal global action' },
  { id: 'T3.12', family: 'data', describe: 'every data component has a dataContext ancestor carrying entityType, sourceType, dataFetchingMode, defaultPageSize' },
  { id: 'T3.13', family: 'data', describe: 'dataContext.entityType equals the form entity' },
  { id: 'T3.14', family: 'actions', describe: 'at most one primary button per action zone' },
  { id: 'T3.16', family: 'formSemantics', describe: 'the submit pipeline matches the form kind: list has none, create/edit has a submitter' },
  { id: 'T3.17', family: 'scripts', describe: 'every embedded script parses' },
  { id: 'T3.18', family: 'templating', describe: 'every mustache expression root is a known scope' },
  { id: 'T3.19', family: 'wiring', describe: 'at most one navigation wiring per row-click surface (onRowClick xor rowClickActionConfiguration)' },
  { id: 'T3.20', family: 'columns', describe: 'the compiled column captions equal the contract’s declared set, in order' },
  { id: 'T3.21', family: 'placement', describe: 'every non-tab contract predicate evaluates true over the compiled tree' },
  { id: 'T3.22', family: 'tabs', describe: 'every tab-assignment contract predicate evaluates true' },
];

/** The frozen mustache scopes a `{{root...}}` expression may name (§3.2.4 T3.18). */
const MUSTACHE_SCOPES = new Set(['selectedRow', 'form', 'formArguments', 'globalState', 'data', 'contexts']);
/** The keys under which a component/formSettings may carry an embedded script string. */
const SCRIPT_KEYS = new Set([
  'onBeforeDataLoad', 'onAfterDataLoad', 'onPrepareSubmitData', 'onBeforeSubmit', 'onSubmitSuccess',
  'onSubmitFailed', 'onChange', 'onFocus', 'onBlur', 'onClick', 'expression', 'customVisibility', 'customEnabled',
]);
const MUSTACHE = /\{\{\s*([A-Za-z_$][\w$]*)/g;
/** A body-of-a-function parser: throws SyntaxError on bad syntax, without executing. */
const AsyncFunction = /** @type {any} */ (Object.getPrototypeOf(async () => {}).constructor);

/** @param {any} v @returns {boolean} */
const isDataComponent = (v) => v === 'datatable' || v === 'datalist';

/**
 * Collect every embedded script string (non-empty) reachable from a node's own props
 * (not its child components — those are walked separately), as [where, code] pairs.
 * @param {any} node @param {string} base @param {Set<string>} channelKeys
 * @returns {[string, string][]}
 */
function scriptsOf(node, base, channelKeys) {
  /** @type {[string, string][]} */
  const out = [];
  /** @param {any} v @param {string} p @param {string|null} key */
  const rec = (v, p, key) => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (key !== null && SCRIPT_KEYS.has(key) && v.trim() !== '') out.push([p, v]);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => rec(x, `${p}[${i}]`, null)); return; }
    if (typeof v === 'object') {
      // A code-mode expression carries its script under `_code` / `code`.
      if ((v._mode === 'code' || v.mode === 'code') && typeof (v._code ?? v.code) === 'string' && String(v._code ?? v.code).trim() !== '') {
        out.push([`${p}._code`, String(v._code ?? v.code)]);
      }
      for (const k of Object.keys(v)) {
        if (channelKeys.has(k)) continue; // don't descend into child-component channels
        rec(v[k], `${p}.${k}`, k);
      }
    }
  };
  for (const k of Object.keys(node)) {
    if (channelKeys.has(k)) continue;
    rec(node[k], `${base}.${k}`, k);
  }
  return out;
}

/**
 * Collect every mustache root identifier used in a node's own string values.
 * @param {any} node @param {Set<string>} channelKeys
 * @returns {string[]}
 */
function mustacheRootsOf(node, channelKeys) {
  /** @type {string[]} */
  const roots = [];
  /** @param {any} v */
  const rec = (v) => {
    if (typeof v === 'string') { for (const m of v.matchAll(MUSTACHE)) roots.push(/** @type {string} */ (m[1])); return; }
    if (Array.isArray(v)) { v.forEach(rec); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { if (!channelKeys.has(k)) rec(v[k]); } }
  };
  for (const k of Object.keys(node)) { if (!channelKeys.has(k)) rec(node[k]); }
  return roots;
}

/**
 * The full offline T3 over ONE compiled form.
 * @param {{components?:any[], formSettings?:any}} doc parsed markup
 * @param {{nodes?:any[], kind?:string}|null} meta the compiled sidecar
 * @param {{ref?:string, legacy?:boolean, entity?:string|null, contract?:{acceptance?:any[], columns?:Record<string, string[]>}}} [opts]
 * @returns {import('@shesha/registry/coverage').Family[]}
 */
export function t3Semantic(doc, meta, opts = {}) {
  const reg = load(opts.ref);
  const channelKeys = new Set(reg.slots.map((s) => /** @type {string} */ (s.key.split('.')[0])));
  const requiredProps = reg.requiredProps;
  const kind = (meta && typeof meta.kind === 'string') ? meta.kind : deriveKind(doc);
  const entity = opts.entity ?? null;

  const fams = families([
    { name: 'bindings', unit: 'binding-scope', required: false },
    { name: 'references', unit: 'reference-site', required: false },
    { name: 'actions', unit: 'action-site', required: false },
    { name: 'data', unit: 'data-component', required: false },
    { name: 'formSemantics', unit: 'setting' },
    { name: 'scripts', unit: 'script-site', required: false },
    { name: 'templating', unit: 'mustache-site', required: false },
    { name: 'wiring', unit: 'row-click-surface', required: false },
    { name: 'placement', unit: 'predicate-row', required: false },
    { name: 'columns', unit: 'datatable', required: false },
    { name: 'tabs', unit: 'tab-row', required: false },
  ]);
  const F = {
    bindings: fams.get('bindings'), references: fams.get('references'), actions: fams.get('actions'),
    data: fams.get('data'), formSemantics: fams.get('formSemantics'), scripts: fams.get('scripts'),
    templating: fams.get('templating'), wiring: fams.get('wiring'),
    placement: fams.get('placement'), columns: fams.get('columns'), tabs: fams.get('tabs'),
  };

  const visits = walkComponents(doc);
  /** @type {Map<any, any>} */
  const parentOf = new Map();
  for (const v of visits) parentOf.set(v.node, v.parentNode);
  /** @param {any} node @param {(n:any)=>boolean} pred */
  const hasAncestor = (node, pred) => { let cur = parentOf.get(node); while (cur) { if (pred(cur)) return cur; cur = parentOf.get(cur); } return null; };
  /** Every real component id in the tree (for onSuccess target resolution). */
  const ids = new Set(visits.map((v) => v.node && v.node.id).filter(Boolean));
  const globalOwners = new Set((reg.actions && reg.actions.intents ? Object.values(reg.actions.intents) : [])
    .map((/** @type {any} */ i) => i && i.actionOwner).filter((o) => typeof o === 'string'));

  // ---- T3.04 duplicate propertyName within one binding scope -----------------
  // A scope is the nearest data ancestor (dataContext) or the form root. Column
  // bindings (datatable.items[].propertyName) count within the datatable's scope.
  /** @type {Map<any, Map<string, string>>} */
  const scopeSeen = new Map();
  /** @param {any} node @returns {any} */
  const scopeOf = (node) => hasAncestor(node, (a) => a.type === 'dataContext') || 'form';
  /** @param {string} pn @param {any} node @param {string} where */
  const recordBinding = (pn, node, where) => {
    const scope = scopeOf(node);
    let seen = scopeSeen.get(scope);
    if (!seen) { seen = new Map(); scopeSeen.set(scope, seen); }
    const p = F.bindings.pointer(`${where}.${pn}#T3.04`);
    if (seen.has(pn)) p.fail(`T3.04 duplicate propertyName "${pn}" at ${where}; already bound at ${seen.get(pn)} in the same scope`);
    else { seen.set(pn, where); p.check(); }
  };

  for (const { node, where } of visits) {
    const type = node && node.type;
    if (!type || String(type).startsWith('[') || node.columnType !== undefined) continue;

    if (typeof node.propertyName === 'string' && node.propertyName) recordBinding(node.propertyName, node, `${where}<${type}>`);
    if (Array.isArray(node.items)) {
      node.items.forEach((/** @type {any} */ it, /** @type {number} */ i) => {
        if (it && it.columnType === 'data' && typeof it.propertyName === 'string' && it.propertyName) recordBinding(it.propertyName, node, `${where}.items[${i}]`);
      });
    }

    // ---- T3.08 formId required where the registry requires it ----------------
    const req = requiredProps[type] || [];
    if (req.includes('formId')) {
      const fid = node.formId;
      const present = fid !== undefined && fid !== null && fid !== ''
        && !(typeof fid === 'object' && !fid._mode && !fid.name && Object.keys(fid).length === 0);
      F.references.pointer(`${where}<${type}>#T3.08`).assert(present,
        `T3.08 "${type}" at ${where} requires a formId (row-template / dialog) but it is absent/empty`);
    }

    // ---- T3.10 onSuccess target resolves ------------------------------------
    const ac = node.actionConfiguration;
    if (ac && typeof ac === 'object' && ac.onSuccess && typeof ac.onSuccess === 'object') {
      const os = ac.onSuccess;
      const target = os.actionArguments && (os.actionArguments.target ?? os.actionArguments.componentId);
      const owner = os.actionOwner;
      const p = F.actions.pointer(`${where}<${type}>#T3.10`);
      if (typeof target === 'string' && target) {
        p.assert(ids.has(target), `T3.10 onSuccess at ${where} targets component id "${target}", which is not in this form`);
      } else if (typeof owner === 'string' && owner) {
        p.assert(globalOwners.has(owner) || /^[a-z][a-z0-9.]*$/.test(owner), `T3.10 onSuccess owner "${owner}" at ${where} is not a known global action owner`);
      } else {
        p.check(); // an onSuccess with no target/owner is a no-op, not a dangling reference
      }
    }

    // ---- T3.14 at most one primary button per action zone -------------------
    if (type === 'buttonGroup' && Array.isArray(node.items)) {
      const primaries = node.items.filter((/** @type {any} */ it) => it && (it.buttonType === 'primary')).length;
      F.actions.pointer(`${where}<buttonGroup>#T3.14`).assert(primaries <= 1,
        `T3.14 buttonGroup at ${where} has ${primaries} primary buttons; a zone has at most one`);
    }

    // ---- T3.12 data component has a dataContext ancestor with the 4 props ----
    if (isDataComponent(type)) {
      const dc = hasAncestor(node, (a) => a.type === 'dataContext');
      const p12 = F.data.pointer(`${where}<${type}>#T3.12`);
      if (!dc) p12.fail(`T3.12 "${type}" at ${where} has no dataContext ancestor`);
      else {
        const missing = ['entityType', 'sourceType', 'dataFetchingMode', 'defaultPageSize'].filter((k) => dc[k] === undefined || dc[k] === null);
        p12.assert(missing.length === 0, `T3.12 dataContext for "${type}" at ${where} is missing ${missing.join(', ')}`);
      }
    }

    // ---- T3.13 dataContext.entityType equals the form entity -----------------
    if (type === 'dataContext') {
      const p13 = F.data.pointer(`${where}<dataContext>#T3.13`);
      if (entity === null) p13.na('T3.13 the form entity was not supplied (bare markup); dataContext.entityType is uncomparable');
      else p13.assert(node.entityType === entity, `T3.13 dataContext.entityType "${node.entityType}" at ${where} does not equal the form entity "${entity}"`);
    }

    // ---- T3.17 embedded scripts parse ---------------------------------------
    for (const [w, code] of scriptsOf(node, `${where}<${type}>`, channelKeys)) {
      const p = F.scripts.pointer(`${w}#T3.17`);
      try { new AsyncFunction(code); p.check(); } catch (e) { p.fail(`T3.17 script at ${w} does not parse: ${(/** @type {Error} */ (e)).message}`); }
    }

    // ---- T3.18 mustache roots are known scopes ------------------------------
    for (const root of mustacheRootsOf(node, channelKeys)) {
      F.templating.pointer(`${where}<${type}>.{{${root}}}#T3.18`).assert(MUSTACHE_SCOPES.has(root),
        `T3.18 mustache root "${root}" at ${where} is not a known scope (${[...MUSTACHE_SCOPES].join(', ')})`);
    }

    // ---- T3.19 one navigation wiring per row-click surface -------------------
    if (isDataComponent(type)) {
      const hasCode = node.onRowClick !== undefined && node.onRowClick !== null && node.onRowClick !== '';
      const hasCfg = node.rowClickActionConfiguration !== undefined && node.rowClickActionConfiguration !== null;
      F.wiring.pointer(`${where}<${type}>#T3.19`).assert(!(hasCode && hasCfg),
        `T3.19 "${type}" at ${where} wires BOTH onRowClick (code) and rowClickActionConfiguration; exactly one navigation wiring per row-click surface`);
    }
  }

  // ---- T3.16 the submit pipeline matches the form kind ----------------------
  const fs = doc && doc.formSettings;
  const submitter = fs && typeof fs === 'object' ? fs.dataSubmitterType : undefined;
  const p16 = F.formSemantics.pointer(`formSettings<${kind}>#T3.16`);
  if (kind === 'list' || kind === 'detail') {
    p16.assert(submitter === undefined || submitter === 'none',
      `T3.16 a ${kind} form must have no submit pipeline, but dataSubmitterType is ${JSON.stringify(submitter)}`);
  } else if (kind === 'create' || kind === 'edit') {
    p16.assert(typeof submitter === 'string' && submitter !== 'none',
      `T3.16 a ${kind} form needs a submit pipeline, but dataSubmitterType is ${JSON.stringify(submitter)}`);
  } else {
    p16.na(`T3.16 no submit-pipeline rule for kind "${kind}"`);
  }

  // ---- T3.20/21/22 contract predicates over the compiled tree ---------------
  // The contract is declarative data (§3.3.3): {acceptance:[predicate rows], columns:{
  // datatable: [captions]}}. Each acceptance row is one pointer; the verifier evaluates
  // it through the WP-3b.2 engine (no eval, no free text). A `tab` row is T3.22; every
  // other predicate is T3.21; the declared column set is T3.20.
  const contract = opts.contract;
  if (contract && typeof contract === 'object') {
    const rows = Array.isArray(contract.acceptance) ? contract.acceptance : [];
    for (const row of rows) {
      if (!row || typeof row.predicate !== 'string') continue;
      const isTab = row.predicate === 'tab';
      const fam = isTab ? F.tabs : F.placement;
      const checkId = isTab ? 'T3.22' : 'T3.21';
      const res = evaluate(row, /** @type {any} */ (meta || { nodes: [] }));
      fam.pointer(`${row.id || row.predicate}#${checkId}`).assert(res.pass, `${checkId} ${row.id || row.predicate}: ${res.reason || 'failed'}`);
    }
    const cols = contract.columns && typeof contract.columns === 'object' ? contract.columns : {};
    for (const [dtName, declared] of Object.entries(cols)) {
      const p = F.columns.pointer(`${dtName}#T3.20`);
      const dt = findNode(doc, (x) => x.type === 'datatable' && (x.componentName === dtName || x.propertyName === dtName));
      if (!dt) { p.fail(`T3.20 contract names datatable "${dtName}", which is not in the form`); continue; }
      const captions = (Array.isArray(dt.items) ? dt.items : []).filter((/** @type {any} */ it) => it.columnType === 'data').map((/** @type {any} */ it) => it.caption);
      p.assert(JSON.stringify(captions) === JSON.stringify(declared),
        `T3.20 "${dtName}" compiled columns ${JSON.stringify(captions)} != declared ${JSON.stringify(declared)}`);
    }
  }

  return fams.list;
}

/**
 * Kind from the sidecar, falling back to the submitter shape for a hand-supplied doc.
 * @param {any} doc @returns {string}
 */
function deriveKind(doc) {
  const fs = doc && doc.formSettings;
  if (fs && fs.dataSubmitterType && fs.dataSubmitterType !== 'none') return 'create';
  return 'list';
}

/**
 * First component in `doc` matching `pred`. Used by the mutations to target one node.
 * @param {any} doc @param {(n:any)=>boolean} pred @returns {any|null}
 */
function findNode(doc, pred) {
  for (const { node } of walkComponents(doc)) { if (node && node.type && !String(node.type).startsWith('[') && node.columnType === undefined && pred(node)) return node; }
  return null;
}

/**
 * Tier mutations (§3.5.2, kind 'compiled'): each injects ONE real defect into the
 * compiled clean doc and asserts T3 flips in the named family. The tier-mutation runner
 * is packages/verify/test/tier-mutations.test.mjs; ctx carries {doc, meta, entity}.
 */
export const mutations = [
  { name: 'a duplicate propertyName in one scope', covers: ['T3.04'], expect: 'fail', expectFamily: 'bindings', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => Array.isArray(x.items) && x.type === 'datatable'); if (n) { const cols = n.items.filter((/** @type {any} */ it) => it.columnType === 'data'); if (cols[1] && cols[0]) cols[1].propertyName = cols[0].propertyName; } } },
  { name: 'a datalist with no formId', covers: ['T3.08'], expect: 'fail', expectFamily: 'references', apply: (/** @type {any} */ c) => { c.doc.components.push({ type: 'datalist', id: 'inject-dl', parentId: 'root', version: 1 }); } },
  { name: 'an onSuccess targeting a missing component id', covers: ['T3.10'], expect: 'fail', expectFamily: 'actions', apply: (/** @type {any} */ c) => { c.doc.components[0].actionConfiguration = { _type: 'action-config', actionName: 'refresh', onSuccess: { actionArguments: { target: 'no-such-id-xyz' } } }; } },
  { name: 'a data component with no dataContext ancestor', covers: ['T3.12'], expect: 'fail', expectFamily: 'data', apply: (/** @type {any} */ c) => { c.doc.components.push({ type: 'datatable', id: 'inject-dt', parentId: 'root', version: 1 }); } },
  { name: 'a dataContext whose entityType disagrees with the form entity', covers: ['T3.13'], expect: 'fail', expectFamily: 'data', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'dataContext'); if (n) n.entityType = 'wrong.Entity.Type'; } },
  { name: 'a buttonGroup with two primary buttons', covers: ['T3.14'], expect: 'fail', expectFamily: 'actions', apply: (/** @type {any} */ c) => { c.doc.components.push({ type: 'buttonGroup', id: 'inject-bg', parentId: 'root', version: 1, items: [{ itemSubType: 'button', buttonType: 'primary' }, { itemSubType: 'button', buttonType: 'primary' }] }); } },
  { name: 'a submit pipeline on a list form', covers: ['T3.16'], expect: 'fail', expectFamily: 'formSemantics', apply: (/** @type {any} */ c) => { c.doc.formSettings = { ...(c.doc.formSettings || {}), dataSubmitterType: 'gql' }; } },
  { name: 'an embedded script that does not parse', covers: ['T3.17'], expect: 'fail', expectFamily: 'scripts', apply: (/** @type {any} */ c) => { c.doc.components[0].onClick = 'return ((('; } },
  { name: 'a mustache expression with an unknown root', covers: ['T3.18'], expect: 'fail', expectFamily: 'templating', apply: (/** @type {any} */ c) => { c.doc.components[0].label = '{{ mysteryRoot.value }}'; } },
  { name: 'a row-click surface wired both ways', covers: ['T3.19'], expect: 'fail', expectFamily: 'wiring', apply: (/** @type {any} */ c) => { const n = findNode(c.doc, (x) => x.type === 'datatable'); if (n) { n.onRowClick = 'return 1;'; n.rowClickActionConfiguration = { actionName: 'navigate' }; } } },
  { name: 'a contract placement predicate that is false', covers: ['T3.21'], expect: 'fail', expectFamily: 'placement', apply: (/** @type {any} */ c) => { c.contract = { acceptance: [{ id: 'M21', tier: 't3', predicate: 'region', args: { node: 'pageShell' }, expect: { eq: 'body' } }] }; } },
  { name: 'a contract tab assignment the tree does not satisfy', covers: ['T3.22'], expect: 'fail', expectFamily: 'tabs', apply: (/** @type {any} */ c) => { c.contract = { acceptance: [{ id: 'M22', tier: 't3', predicate: 'tab', args: { node: 'pageShell' }, expect: { eq: 'Endpoints' } }] }; } },
  { name: 'a contract column set that disagrees with the compiled columns', covers: ['T3.20'], expect: 'fail', expectFamily: 'columns', apply: (/** @type {any} */ c) => { c.contract = { columns: { inventoryTable: ['Not', 'The', 'Real', 'Columns'] } }; } },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const args = process.argv.slice(2);
    const formArg = args.find((a) => !a.startsWith('--'));
    let fams;
    if (formArg) {
      const metaAt = args.indexOf('--meta');
      const { doc, meta } = readForm(root, formArg, metaAt >= 0 ? (args[metaAt + 1] ?? null) : null);
      const entArg = args.indexOf('--entity');
      fams = t3Semantic(doc, meta, { legacy: args.includes('--legacy'), entity: entArg >= 0 ? (args[entArg + 1] ?? null) : (meta && meta.entity) || null });
    } else {
      const { compile } = await import('../../../sfs/src/compile/index.mjs');
      const src = readText(path.join(root, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json')) || '';
      const r = compile(src, { source: 'baseline' });
      const doc = JSON.parse(String(r.envelope.Markup));
      fams = t3Semantic(doc, /** @type {any} */ (r.meta), { entity: String(r.envelope.ModelType) });
    }
    console.log(report(fams, { title: id }));
    const v = verdictOf(fams);
    return v === 'pass' ? EXIT.pass : exitFor(v);
  }));
}
