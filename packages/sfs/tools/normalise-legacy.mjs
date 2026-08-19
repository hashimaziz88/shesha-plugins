#!/usr/bin/env node
// normalise-legacy: legacy Shesha form (envelope or bare) -> NORMALISED markup. Pure; registry data only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', '..', 'registry', 'data', '0.45.1');
/** @param {string} p @returns {*} */
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const REG = rd(path.join(dataDir, 'components.json')).components;
const FS = rd(path.join(dataDir, 'form-settings.json'));
const T = rd(path.join(dataDir, 'tokens', 'shesha.json'));

const argv = process.argv.slice(2);
const outIx = argv.indexOf('--out');
const inFile = argv[0];
if (!inFile || outIx < 0 || !argv[outIx + 1]) {
  process.stderr.write('usage: normalise-legacy.mjs <input.json> --out <output.json>\n');
  process.exit(1);
}
const outFile = /** @type {string} */ (argv[outIx + 1]); // guarded present above

const raw = rd(path.resolve(inFile));
/** @type {*} */ let env;
/** @type {*} */ let markup;
if (typeof raw.Markup === 'string') { env = raw; markup = JSON.parse(raw.Markup); }
else { env = { ModelType: null, ModuleName: null, Permissions: [], Access: undefined }; markup = raw; }
const inFs = markup.formSettings || {};
const comps = Array.isArray(markup.components) ? markup.components : [];

/** @param {*} x @returns {*} */
const dc = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
/** @param {*} c @returns {*[]} */
const kidArrays = (c) => [c.components, c.content && c.content.components, c.header && c.header.components].filter(Array.isArray);
const BPS = ['desktop', 'tablet', 'mobile'];

// R1
/** @param {*[]} list @returns {boolean} */
const hasTable = (list) => list.some((c) => c.type === 'datatable' || c.type === 'datalist' || kidArrays(c).some(hasTable));
const kind = hasTable(comps) && inFs.dataLoaderType === 'gql' ? 'list' : 'custom';
const P = FS.kinds[kind];

// R2
/** @param {*} v @returns {*} */
const deref = (v) => typeof v === 'string' && v[0] === '_' ? dc(FS[v]) : dc(v);
/** @param {*} a @returns {boolean} */
const okAccess = (a) => a === 1 || a === 2 || a === 4;
/** @type {*} */
const fs2 = {
  layout: FS.base.layout, colon: FS.base.colon,
  labelCol: dc(FS.base.labelCol), wrapperCol: dc(FS.base.wrapperCol),
  modelType: typeof env.ModelType === 'string'
    ? { name: env.ModelType.split('.').pop(), module: env.ModuleName ?? 'app' } : null,
  dataLoaderType: P.dataLoaderType, dataSubmitterType: P.dataSubmitterType,
  access: okAccess(inFs.access) ? inFs.access : okAccess(env.Access) ? env.Access : 4,
  permissions: Array.isArray(env.Permissions) && env.Permissions.length ? dc(env.Permissions) : [],
  version: FS.base.version,
};
for (const k of FS._hookKeys) fs2[k] = (inFs[k] != null && P.hooks.includes(k)) ? inFs[k] : null;
const dls = deref(P.dataLoadersSettings); if (dls != null) fs2.dataLoadersSettings = dls;
const dss = deref(P.dataSubmittersSettings); if (dss != null) fs2.dataSubmittersSettings = dss;

// R3
const exempt = new Set();
const shellB = () => ({
  background: { type: 'color', color: T.palette.surfaces.page, repeat: 'no-repeat', size: 'auto', position: 'center', gradient: { direction: 'to right', colors: {} }, url: '', storedFile: { id: null }, uploadFile: null },
  border: { hideBorder: false, radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'none', color: '#d9d9d9' }, top: {}, bottom: {}, left: {}, right: {} }, radius: { all: 0 } },
  dimensions: { width: '100%', height: 'auto', minHeight: '0px', maxHeight: 'auto', minWidth: '0px', maxWidth: 'auto' },
  enableStyleOnReadonly: false, className: 'sha-page',
});
const bandC = () => ({
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch', flexWrap: 'nowrap', gap: '4',
  dimensions: { width: '100%', height: 'auto', minHeight: 'fit-content', maxHeight: 'auto', minWidth: '0px', maxWidth: 'auto' },
  stylingBox: '{"paddingTop":"4","paddingBottom":"18"}',
});
/** @param {*} size @param {string} weight @param {string} color @param {string} mb @returns {*} */
const textF = (size, weight, color, mb) => ({
  font: { type: T.type.family, size, weight, color, align: 'left' },
  stylingBox: '{"marginBottom":"' + mb + '"}',
});
/** @param {*} n @param {string} pn @param {() => *} f @returns {*} */
const mkText = (n, pn, f) => {
  const t = { id: n.id, type: 'text', version: n.version, propertyName: pn, componentName: n.componentName, hideLabel: true, hidden: false, isDynamic: false, textType: 'span', contentDisplay: 'content', dataType: 'string', stylingBox: '{}', desktop: f(), tablet: f(), mobile: f(), content: n.content, parentId: n.parentId };
  exempt.add(t); return t;
};
let tree = comps;
const card0 = comps.length === 1 ? comps[0] : null;
const band0 = card0 && card0.type === 'card' && card0.content && Array.isArray(card0.content.components) ? card0.content.components[0] : null;
if (band0 && band0.type === 'container' && Array.isArray(band0.components) && band0.components[0] && band0.components[0].type === 'text') {
  /** @type {*[]} */
  const texts = [];
  for (const ch of band0.components) { if (ch.type !== 'text' || texts.length === 2) break; texts.push(ch); }
  const others = band0.components.slice(texts.length);
  const title = mkText(texts[0], 'pageTitle', () => textF(T.type.scale.title, '600', T.palette.text.primary, '2'));
  const bandKids = [title];
  if (texts[1]) bandKids.push(mkText(texts[1], 'pageSubtitle', () => textF(T.type.scale.subtitle, '400', T.palette.text.secondary, '0')));
  const band = { id: band0.id, type: 'container', version: band0.version, propertyName: 'titleBand', componentName: band0.componentName, hideLabel: true, hidden: false, isDynamic: false, display: 'flex', justifyContent: 'flex-start', alignItems: 'stretch', flexWrap: 'nowrap', stylingBox: '{}', flexDirection: 'column', gap: '4', direction: 'vertical', editMode: 'inherited', enableStyleOnReadonly: false, desktop: bandC(), tablet: bandC(), mobile: bandC(), components: bandKids, parentId: band0.parentId };
  exempt.add(band);
  for (const m of others) m.parentId = card0.content.id;
  card0.content.components = [band, ...others, ...card0.content.components.slice(1)];
  const card = { id: card0.id, type: 'card', version: card0.version, propertyName: 'pageShell', componentName: card0.componentName, hideLabel: true, hidden: false, isDynamic: false, stylingBox: '{}', hideHeading: true, enableStyleOnReadonly: false, desktop: shellB(), tablet: shellB(), mobile: shellB(), content: card0.content, header: card0.header, parentId: card0.parentId };
  exempt.add(card);
  tree = [card];
}

// R4-R13, children first
/** @param {string} s @returns {string} */
const camel = (s) => s.split('.').map((p) => (p[0] ?? '').toLowerCase() + p.slice(1)).join('.');
const CHAN = ['font', 'background', 'border', 'shadow'];
const OW = new Map();
/** @param {*} c @returns {void} */
function rules(c) {
  const r = REG[c.type] || {};
  const ch = r.breakpointChannels || [];
  const in0 = { fd: c.flexDirection, jc: c.justifyContent, ai: c.alignItems, fw: c.flexWrap, gap: c.gap };
  OW.set(c, BPS.map((bp) => c[bp] && c[bp].dimensions ? c[bp].dimensions.width : undefined));
  // R4
  if (typeof c.label === 'string' && /^[A-Z][a-z]+\d+$/.test(c.label)) delete c.label;
  delete c.labelAlign;
  c.hideLabel = true;
  // R5
  if (ch.length) for (const k of r.legacyStyleProps || []) delete c[k];
  // R6
  if (ch.includes('stylingBox')) c.stylingBox = '{}';
  // R7
  const d = r.defaults || {};
  if (!('hidden' in c)) c.hidden = 'hidden' in d ? d.hidden : false;
  if (!('isDynamic' in c)) c.isDynamic = false;
  for (const k in d) if (k !== 'hidden' && k !== 'hideLabel' && !(k in c)) c[k] = dc(d[k]);
  // R8
  if (ch.includes('display')) {
    const fd = in0.fd || 'column';
    c.display = 'flex'; c.flexDirection = fd;
    c.justifyContent = in0.jc || (fd === 'row' ? 'space-between' : 'flex-start');
    c.alignItems = in0.ai || 'stretch';
    c.flexWrap = in0.fw || 'nowrap';
    c.gap = String(in0.gap !== undefined ? in0.gap : (fd === 'row' ? 16 : 0));
    c.direction = fd === 'row' ? 'horizontal' : 'vertical';
  }
  // R9
  if (r.editModeChannel) c.editMode = P.editMode[r.editModeChannel];
  if (c.type === 'buttonGroup' && Array.isArray(c.items)) for (const it of c.items) it.editMode = P.editMode.actionsItem;
  // A4: row children keep input width, else 'auto'
  if (ch.includes('display') && c.flexDirection === 'row') {
    for (const arr of kidArrays(c)) for (const k of arr) {
      const kr = REG[k.type];
      if (!kr || !(kr.breakpointChannels || []).includes('dimensions') || exempt.has(k)) continue;
      const ow = OW.get(k) || [];
      BPS.forEach((bp, i) => {
        const b = k[bp] = k[bp] || {};
        b.dimensions = b.dimensions || {};
        b.dimensions.width = ow[i] !== undefined ? ow[i] : 'auto';
      });
    }
  }
  // R10
  if (r.breakpointBlocks) {
    if (c.desktop === undefined && c.tablet === undefined && c.mobile === undefined) {
      const mk = () => {
        /** @type {*} */ const b = {};
        if (ch.includes('display')) Object.assign(b, { display: 'flex', flexDirection: c.flexDirection, justifyContent: c.justifyContent, alignItems: c.alignItems, flexWrap: c.flexWrap, gap: c.gap });
        if (r.dimensionDefaults) b.dimensions = dc(r.dimensionDefaults);
        return b;
      };
      c.desktop = mk(); c.tablet = mk(); c.mobile = mk();
    } else {
      c.desktop = c.desktop || {}; c.tablet = c.tablet || {}; c.mobile = c.mobile || {};
      for (const k of CHAN) {
        if (c.desktop[k] !== undefined) { c.tablet[k] = dc(c.desktop[k]); c.mobile[k] = dc(c.desktop[k]); }
        else { delete c.tablet[k]; delete c.mobile[k]; }
      }
      if (c.desktop.className !== undefined) { c.tablet.className = c.desktop.className; c.mobile.className = c.desktop.className; }
      else { delete c.tablet.className; delete c.mobile.className; }
      // A5: dims clamped to keys(D)+width/height
      if (r.dimensionDefaults) for (const bp of BPS) {
        const di = c[bp].dimensions || {};
        const nd = dc(r.dimensionDefaults);
        for (const k of Object.keys(r.dimensionDefaults).concat('width', 'height')) if (di[k] !== undefined) nd[k] = di[k];
        c[bp].dimensions = nd;
      }
    }
    // N9
    for (const bp of BPS) {
      const b = c[bp];
      if (!b || b.flexDirection !== 'row') continue;
      let hit = false;
      for (const arr of kidArrays(c)) for (const k of arr) { const kb = k[bp]; if (kb && kb.dimensions && kb.dimensions.width === '100%') hit = true; }
      if (hit) { b.flexDirection = 'column'; b.alignItems = 'stretch'; }
    }
    // A6
    if (c.flexDirection === 'row') for (const bp of BPS) { const b = c[bp]; if (b && b.flexDirection === 'column') b.alignItems = 'stretch'; }
  }
  // A3
  for (const bp of BPS) {
    const b = c[bp];
    if (!b || typeof b.stylingBox !== 'string') continue;
    let e = b.stylingBox === '{}';
    if (!e) { try { const o = JSON.parse(b.stylingBox); e = !!o && typeof o === 'object' && Object.keys(o).length === 0; } catch { e = false; } }
    if (e) delete b.stylingBox;
  }
  // R11
  if (c.type === 'datatable' && c.rowClickActionConfiguration !== undefined) { delete c.onRowClick; delete c.dblClickActionConfiguration; }
  // R12
  if (Array.isArray(c.items)) {
    let n = 0;
    for (const it of c.items) {
      if (it.columnType === 'crud-operations') it.sortOrder = -1; else it.sortOrder = n++;
      if (c.type === 'datatable' && typeof it.propertyName === 'string') it.propertyName = camel(it.propertyName);
    }
  }
  if (r.isInput && typeof c.propertyName === 'string') c.propertyName = camel(c.propertyName);
  // R13
  if (c.type === 'dataContext' && !Array.isArray(c.items)) c.items = [];
}
/** @param {*[]} list @returns {void} */
function walk(list) {
  for (const c of list) {
    for (const arr of kidArrays(c)) walk(arr);
    if (!exempt.has(c)) rules(c);
  }
}
walk(tree);

mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
writeFileSync(path.resolve(outFile), JSON.stringify({ components: tree, formSettings: fs2 }));
