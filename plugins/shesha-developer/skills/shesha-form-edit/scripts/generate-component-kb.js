#!/usr/bin/env node
/**
 * generate-component-kb.js
 *
 * Builds a source-derived component knowledge base for Shesha's form designer
 * by regex/string-parsing the renderer source (no TS compiler, no npm deps).
 *
 * Usage:
 *   node scripts/generate-component-kb.js "<designer-components source dir>" "<output dir>"
 *
 * Example (0.43):
 *   node scripts/generate-component-kb.js \
 *     "C:/Users/Hashim/Documents/Git Repos/shesha-framework/shesha-reactjs-043/shesha-reactjs/src/designer-components" \
 *     "assets/components-kb"
 *
 * For every IToolboxComponent definition found (including nested sub-component
 * folders like button/buttonGroup), emits <outdir>/<type>.json plus:
 *   _index.json  — type -> { version, name, isInput, file }
 *   _meta.json   — { sourceBranch, commit, generatedAt, componentCount }
 *   _gaps.json   — extraction failures / partial parses with reasons
 *
 * Deterministic and re-runnable (point it at a 0.45 source dir later).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const srcDir = process.argv[2];
const outDir = process.argv[3];
if (!srcDir || !outDir) {
  console.error('Usage: node generate-component-kb.js <designer-components-dir> <output-dir>');
  process.exit(1);
}
if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`Source dir not found: ${srcDir}`);
  process.exit(1);
}
const SRC = path.resolve(srcDir);
// src root = two levels up from designer-components (src/designer-components)
const SRC_ROOT = path.resolve(SRC, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const relRoot = (p) => path.relative(SRC_ROOT, p).split(path.sep).join('/');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(full, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(full);
    }
  }
  return out;
}

/** Extract a balanced-delimiter span starting at `openIdx` (which must point at the opening char). */
function balancedSpan(text, openIdx, open = '{', close = '}') {
  let depth = 0;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    const c2 = text.substr(i, 2);
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c2 === '*/') { inBlockComment = false; i++; } continue; }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c2 === '//') { inLineComment = true; i++; continue; }
    if (c2 === '/*') { inBlockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Interface index (best-effort): designer-components tree + shared model files
// ---------------------------------------------------------------------------
const interfaceIndex = new Map(); // name -> { file, extends: [], props: [] }
// 0.45 style: `export type XComponentDefinition = IToolboxComponent<IXProps>;`
// alias name -> props interface name from the generic parameter
const toolboxAliasIndex = new Map();

function indexToolboxAliasesInFile(file, text) {
  // matches `type X = IToolboxComponent<IProps>` and the 0.45 helper
  // `type X = ComponentDefinition<"type", IProps, ICalculatedValues>`
  const re = /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*(?:IToolboxComponent|ComponentDefinition)\s*<([^>;]*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const args = m[2].replace(/["'][^"']*["']/g, ''); // drop string-literal type args
    const ident = args.match(/[A-Za-z_$][\w$]*/);
    if (ident && !toolboxAliasIndex.has(m[1])) toolboxAliasIndex.set(m[1], ident[0]);
  }
}

function indexInterfacesInFile(file) {
  let text;
  try { text = readFile(file); } catch { return; }
  indexToolboxAliasesInFile(file, text);
  const re = /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\s*(?:<[^>{]*>)?\s*(extends\s+[^\{]+)?\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const braceIdx = m.index + m[0].length - 1;
    const body = balancedSpan(text, braceIdx);
    if (!body) continue;
    const extendsList = m[2]
      ? m[2].replace(/^extends\s+/, '').split(',').map((s) => s.trim().replace(/<[^>]*>/g, '').trim()).filter(Boolean)
      : [];
    // property / method names at top level of the interface body
    const props = [];
    const inner = body.slice(1, -1);
    // strip nested object-literal type bodies so nested keys aren't captured
    let flat = '';
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (depth === 0) flat += c;
    }
    const propRe = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?]?\s*[:(]/gm;
    let pm;
    while ((pm = propRe.exec(flat)) !== null) {
      if (!props.includes(pm[1])) props.push(pm[1]);
    }
    if (!interfaceIndex.has(name)) {
      interfaceIndex.set(name, { file: relRoot(file), extends: extendsList, props });
    }
  }
}

function buildInterfaceIndex() {
  const candidates = [];
  candidates.push(...walk(SRC, ['.ts', '.tsx']));
  const shared = [
    path.join(SRC_ROOT, 'providers', 'form', 'models.ts'),
    path.join(SRC_ROOT, 'interfaces'),
    path.join(SRC_ROOT, 'providers', 'dataTable'),
    path.join(SRC_ROOT, 'components'),
  ];
  for (const s of shared) {
    if (!fs.existsSync(s)) continue;
    if (fs.statSync(s).isDirectory()) candidates.push(...walk(s, ['.ts', '.tsx']));
    else candidates.push(s);
  }
  for (const f of candidates) indexInterfacesInFile(f);
}

/** Resolve an interface's full property list by following extends (best-effort). */
function resolveInterface(name, seen = new Set(), depth = 0) {
  if (seen.has(name) || depth > 6) return { props: [], unresolved: [] };
  seen.add(name);
  const decl = interfaceIndex.get(name);
  if (!decl) return { props: [], unresolved: [name] };
  const props = [...decl.props];
  const unresolved = [];
  for (const parent of decl.extends) {
    const r = resolveInterface(parent, seen, depth + 1);
    for (const p of r.props) if (!props.includes(p)) props.push(p);
    unresolved.push(...r.unresolved);
  }
  return { props, unresolved };
}

// ---------------------------------------------------------------------------
// Toolbox component extraction
// ---------------------------------------------------------------------------
const gaps = [];
const entries = new Map(); // type -> entry

function extractStringProp(objSrc, key) {
  const m = objSrc.match(new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`, 'm'));
  return m ? m[2] : undefined;
}

function extractBoolProp(objSrc, key) {
  const m = objSrc.match(new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*(true|false)\\b`, 'm'));
  return m ? m[1] === 'true' : undefined;
}

/** Extract the value snippet of a top-level object property (arrow fn or literal). */
function extractPropSnippet(objSrc, key) {
  const re = new RegExp(`(?:^|[,{\\n])\\s*${key}\\s*:`, 'm');
  const m = re.exec(objSrc);
  if (!m) return null;
  let i = m.index + m[0].length;
  // skip whitespace
  while (i < objSrc.length && /\s/.test(objSrc[i])) i++;
  // Consume until we hit a comma/close-brace at depth 0
  let depth = 0;
  let inStr = null;
  const start = i;
  for (; i < objSrc.length; i++) {
    const c = objSrc[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    // NOTE: '<'/'>' are NOT bracket-tracked (they appear in arrows `=>` and comparisons);
    // generics with top-level commas (e.g. Omit<A, 'b'>) may truncate — acceptable for
    // the properties this is used on (initModel, customContainerNames).
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if ((c === ',' && depth === 0)) break;
    if (depth < 0) break;
  }
  return objSrc.slice(start, i).trim();
}

/** Parse statically-readable literal keys out of an initModel body. */
function parseInitModelDefaults(snippet) {
  if (!snippet) return null;
  // find the object literal returned: ({ ... }) or => { return {...} }
  let objStart = -1;
  const parenObj = snippet.match(/=>\s*\(\s*\{/);
  if (parenObj) objStart = snippet.indexOf('{', parenObj.index);
  else {
    const ret = snippet.match(/return\s*\{/);
    if (ret) objStart = snippet.indexOf('{', ret.index);
  }
  if (objStart < 0) return null;
  const body = balancedSpan(snippet, objStart);
  if (!body) return null;
  const inner = body.slice(1, -1);
  const defaults = {};
  // match simple `key: <literal>` pairs at top level
  let depth = 0;
  let cur = '';
  const parts = [];
  let inStr = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += inner[++i] ?? ''; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    if (c === '}' || c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    const pm = part.trim().match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
    if (!pm) continue;
    const key = pm[1];
    const raw = pm[2].trim();
    let val;
    if (/^(['"])(?:\\.|(?!\1).)*\1$/.test(raw)) val = raw.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(raw)) val = Number(raw);
    else if (raw === 'true' || raw === 'false') val = raw === 'true';
    else if (raw === 'null') val = null;
    else continue; // not statically readable -> skip (raw snippet is preserved separately)
    defaults[key] = val;
  }
  return Object.keys(defaults).length ? defaults : null;
}

/** Count migrator versions: highest .add<...>(N in the snippet(s). */
function highestAddIndex(text) {
  const re = /\.add(?:\s*<[^>]*>)?\s*\(\s*(\d+)\s*,/g;
  let max = -1;
  let m;
  while ((m = re.exec(text)) !== null) max = Math.max(max, Number(m[1]));
  return max;
}

// ---------------------------------------------------------------------------
// Settings-field catalog extraction (0.43)
//
// In 0.43 a component's settings panel is defined by ONE of:
//   1. `settingsFormMarkup: <jsonImport>`  — a raw Shesha form-markup JSON file
//      (e.g. textField/settingsForm.json). Parsed as JSON -> quality "full".
//   2. `settingsFormMarkup: (data) => getSettings(data)` — a DesignerToolbarSettings
//      fluent-builder chain in settingsForm.ts / settings.ts. Parsed by scanning
//      `.addXxx({...})` calls -> quality "full".
//   3. `settingsFormFactory: (props) => <XxxSettingsForm/>` — a React settings form
//      (settings.tsx). Parsed by grepping `<SettingsFormItem name="..." label="...">`
//      -> quality "partial".
// On 0.45 appearance is NOT a shared repeated panel — each settings form nests it
// inline under a styleRouter keyed on `contexts.canvasContext?.designerDevice`, so
// the same family reads/writes desktop.*, tablet.* or mobile.* depending on the
// selected canvas device. The KB therefore stores appearance paths UNPREFIXED
// (`dimensions.width`, `border.border.all.width`); generate-component-gym.js adds
// the `desktop.` breakpoint prefix when it builds variants.
// ---------------------------------------------------------------------------

/** 0.45 appearance families. A settings path is appearance iff it is exactly one of
 * these, or is dotted-prefixed by one. Drives `appearanceFieldPaths`, which is what
 * gym-lib/groups.js buckets on and what the gym varies with a `desktop.` prefix. */
const APPEARANCE_FAMILIES = [
  'border', 'font', 'dimensions', 'background', 'shadow', 'overflow',
  'stylingBox', 'style', 'customStyle', 'size',
];
const isAppearancePath = (p) =>
  APPEARANCE_FAMILIES.some((fam) => p === fam || p.startsWith(`${fam}.`));

/**
 * Inputs generated by a helper rather than declared literally, so no static parse of
 * a settingsForm can see them. Expanded at the call site with the helper's real
 * `path` argument (`getBorderInputs(fbf, path = '', …)` —
 * designer-components/_settings/utils/border/utils.tsx).
 *
 * This is the single reason `border` was absent from every component's KB entry
 * while being present on every component's designer Appearance tab.
 */
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
const BORDER_CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

function expandHelperInputs(helper, pathArg) {
  const pre = pathArg ? `${pathArg}.` : '';
  const out = [];
  if (helper === 'getBorderInputs') {
    const bp = `${pre}border.border`;
    out.push(mkField(`${pre}border.borderType`, 'Border Type', 'dropdown', undefined, 'Border',
      'Border style: solid | dashed | dotted | none'));
    for (const side of ['all', ...BORDER_SIDES]) {
      out.push(mkField(`${bp}.${side}.width`, `Border width (${side})`, 'textField', undefined, 'Border', 'Border width, e.g. "1px"'));
      out.push(mkField(`${bp}.${side}.style`, `Border style (${side})`, 'dropdown', undefined, 'Border', 'solid | dashed | dotted | none'));
      out.push(mkField(`${bp}.${side}.color`, `Border colour (${side})`, 'colorPicker', undefined, 'Border'));
    }
  } else if (helper === 'getCornerInputs') {
    out.push(mkField(`${pre}border.radiusType`, 'Radius Type', 'dropdown', undefined, 'Border', 'all | custom'));
    for (const corner of ['all', ...BORDER_CORNERS]) {
      out.push(mkField(`${pre}border.radius.${corner}`, `Radius (${corner})`, 'numberField', undefined, 'Border', 'Corner radius in px'));
    }
  }
  return out;
}

/** `...getBorderInputs(fbf, 'columnStyles', true)` -> expanded fields. */
function fieldsFromHelperCalls(text) {
  const out = [];
  const re = /\b(getBorderInputs|getCornerInputs)\s*\(\s*[\w$]+\s*(?:,\s*(['"`])([^'"`]*)\2)?/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(...expandHelperInputs(m[1], m[3] || ''));
  return out;
}

/** Settings-form layout components that do not bind a model property. */
const NONFIELD_TYPES = new Set([
  'collapsiblePanel', 'sectionSeparator', 'divider', 'propertyRouter',
  'container', 'columns', 'tabs', 'alert', 'text', 'paragraph', 'title', 'button', 'buttons',
]);
const FLUENT_LAYOUT_METHODS = new Set([
  'addCollapsiblePanel', 'addSectionSeparator', 'addDivider', 'addPropertyRouter',
  'addContainer', 'addAlert', 'addButtons',
]);

/** addTextField -> textField, addEditMode -> editModeSelector, etc. */
function editorTypeFromMethod(method) {
  const overrides = {
    addEditMode: 'editModeSelector',
    addEditableTagGroupProps: 'editableTagGroup',
    addConfigurableActionConfigurator: 'configurableActionConfigurator',
    addButtons: 'buttonGroup',
  };
  if (overrides[method]) return overrides[method];
  const raw = method.slice(3);
  return raw.charAt(0).toLowerCase() + raw.slice(1);
}

function parseLiteral(raw) {
  if (raw === undefined || raw === null) return undefined;
  const t = String(raw).trim();
  if (/^(['"])(?:\\.|(?!\1).)*\1$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  return undefined;
}

function mkField(path_, label, editorType, defaultValue, group, description) {
  const f = { path: path_ };
  if (label !== undefined && label !== null && label !== '') f.label = label;
  if (editorType) f.editorType = editorType;
  if (defaultValue !== undefined) f.defaultValue = defaultValue;
  if (group) f.group = group;
  if (description) f.description = description;
  return f;
}

const joinPath = (prefix, name) => (prefix ? `${prefix}.${name}` : name);

/**
 * Split one fluent call argument into `{ propertyName, window }` per declared input.
 *
 * `window` runs from each `propertyName:` to the next one (or the end), which is a
 * good-enough object boundary for sibling inputs in an `inputs: [...]` array and
 * avoids a full JS object parse. Attributes are read from the window so each input
 * keeps its OWN label/description rather than the first one in the call.
 *
 * Template-literal names containing `${…}` are unresolvable statically and skipped
 * here — the helper-generated ones are supplied by fieldsFromHelperCalls().
 */
/**
 * Drop `//` and block comments while leaving string literals intact.
 *
 * Settings forms carry a lot of commented-out inputs (dataList `showBorder`, container
 * `position.value`, progress `lineStrokeColor` are all disabled this way). A commented
 * declaration is not a declaration, and a commented-out `.addX(` must not make the
 * enclosing call look like a container.
 */
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const c2 = text.substr(i, 2);
    if (quote) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c2 === '//') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c2 === '/*') { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; }
    out += c;
  }
  return out;
}

/** Blank out string/template literals so code samples inside `_code`, `description`
 * or `availableConstants` cannot be mistaken for real syntax. */
function stripStrings(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = null; out += c; continue; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    out += c;
  }
  return out;
}

function inputWindows(arg) {
  const re = /propertyName\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  const hits = [];
  let m;
  while ((m = re.exec(arg)) !== null) hits.push({ name: m[2], start: m.index });
  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const name = hits[i].name;
    if (!name || name.includes('${')) continue;
    const end = i + 1 < hits.length ? hits[i + 1].start : arg.length;
    out.push({ propertyName: name, window: arg.slice(hits[i].start, end) });
  }
  return out;
}

/** 1. JSON form-markup settings file -> fields. */
function fieldsFromMarkupJson(json) {
  const fields = [];
  const visitChildren = (node, group, prefix) => {
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (key === 'content' && v && Array.isArray(v.components)) visit(v.components, group, prefix);
      else if (Array.isArray(v) && v.some((x) => x && typeof x === 'object' && x.type && x.id)) visit(v, group, prefix);
      else if (v && typeof v === 'object' && !Array.isArray(v) && key !== 'content' && Array.isArray(v.components)) visit(v.components, group, prefix);
    }
  };
  const visit = (node, group, prefix) => {
    if (Array.isArray(node)) { node.forEach((n) => visit(n, group, prefix)); return; }
    if (!node || typeof node !== 'object') return;
    const type = node.type;
    if (type === 'collapsiblePanel') { visitChildren(node, node.label || group, prefix); return; }
    if (type === 'propertyRouter') {
      // propertyRouteName may be a JS-setting object ({_code,_mode,_value}) — only
      // prefix when it resolves to a plain non-empty string.
      let routeName = node.propertyRouteName;
      if (routeName && typeof routeName === 'object') routeName = typeof routeName._value === 'string' ? routeName._value : null;
      const p = typeof routeName === 'string' && routeName ? joinPath(prefix, routeName) : prefix;
      visitChildren(node, group, p);
      return;
    }
    if (type && node.propertyName && !NONFIELD_TYPES.has(type)) {
      fields.push(mkField(joinPath(prefix, node.propertyName), node.label, type,
        node.defaultValue !== undefined && ['string', 'number', 'boolean'].includes(typeof node.defaultValue) ? node.defaultValue : undefined,
        group, node.description || node.tooltip));
    }
    visitChildren(node, group, prefix);
  };
  visit(json.components || [], undefined, '');
  return fields;
}

/**
 * 2. DesignerToolbarSettings fluent chain -> fields.
 *
 * A call may declare MANY inputs: `.addSettingsInputRow({ inputs: [{…}, {…}, …] })`
 * is the dominant 0.45 shape, and reading only the first `propertyName` per call
 * dropped the majority of every component's real settings — every appearance family
 * among them. So each call is split into per-input windows.
 *
 * Only LEAF calls contribute. A call whose argument contains a nested `.addXxx(` is a
 * container (addContainer / addCollapsiblePanel / addSearchableTabs); the outer scan
 * matches its children independently, so harvesting it too would double-count and
 * would attribute a child's label to the wrapper.
 */
function fieldsFromFluent(text) {
  const fields = [];
  const panels = []; // { start, end, label }
  const re = /\.add([A-Z][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const method = 'add' + m[1];
    const openParen = m.index + m[0].length - 1;
    const span = balancedSpan(text, openParen, '(', ')');
    if (!span) continue;
    const arg = stripComments(span);
    if (method === 'addCollapsiblePanel') {
      const label = (arg.match(/label\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/) || [])[2];
      panels.push({ start: openParen, end: openParen + span.length, label });
      continue;
    }
    if (FLUENT_LAYOUT_METHODS.has(method)) continue;
    // Container — its children are matched by the outer scan on their own pass, so
    // harvesting it too would double-count and misattribute labels.
    //
    // Detected by a nested SETTINGS-builder spread (`components: [...fbf()…]`), not by
    // any `.addX(` — a codeEditor's `availableConstants` legitimately chains a metadata
    // builder (`.addObject().addEntityAsync()`), and treating that as nesting dropped
    // real expression fields.
    if (/\bfbf\s*\(|new\s+DesignerToolbarSettings/.test(stripStrings(arg))) continue;
    for (const { propertyName, window } of inputWindows(arg)) {
      const label = (window.match(/label\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/) || [])[2];
      const dv = (window.match(/defaultValue\s*:\s*((['"])(?:\\.|(?!\2).)*\2|-?\d+(?:\.\d+)?|true|false|null)\s*(?:,|\n|\})/) || [])[1];
      const desc = (window.match(/(?:description|tooltip)\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/) || [])[2];
      // an input's own `type:`/`inputType:` beats the method name, which for an
      // input row is just `settingsInputRow` and says nothing about the editor
      const declared = (window.match(/(?:^|[,{\s])(?:inputType|type)\s*:\s*['"]([\w-]+)['"]/) || [])[1];
      fields.push({
        pos: m.index,
        field: mkField(propertyName, label, declared || editorTypeFromMethod(method), parseLiteral(dv), undefined, desc),
      });
    }
  }
  for (const { pos, field } of fields) {
    let best = null;
    for (const p of panels) {
      if (pos > p.start && pos < p.end && p.label) {
        if (!best || (p.end - p.start) < (best.end - best.start)) best = p;
      }
    }
    if (best) field.group = best.label;
  }
  return fields.map((f) => f.field);
}

/** 3. React settings.tsx -> best-effort fields (partial). */
function fieldsFromTsx(text) {
  const fields = [];
  const panels = [...text.matchAll(/<SettingsCollapsiblePanel[^>]*header\s*=\s*[{'"]+([^'"}]+)/g)]
    .map((m) => ({ start: m.index, label: m[1] }));
  const re = /<(?:SettingsFormItem|Form\.Item|FormItem)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const name = (attrs.match(/\bname\s*=\s*(?:"([\w.]+)"|'([\w.]+)'|\{\s*['"]([\w.]+)['"]\s*\})/) || []);
    const path_ = name[1] || name[2] || name[3];
    if (!path_) continue;
    const label = (attrs.match(/\blabel\s*=\s*(?:"([^"]*)"|'([^']*)')/) || []);
    const tooltip = (attrs.match(/\btooltip\s*=\s*(?:"([^"]*)"|'([^']*)')/) || []);
    let group;
    for (const p of panels) if (p.start < m.index) group = p.label;
    fields.push(mkField(path_, label[1] || label[2], undefined, undefined, group, tooltip[1] || tooltip[2]));
  }
  return fields;
}

/** Resolve an import specifier to an existing file path. */
function resolveSpec(fromFile, spec) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(SRC_ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  if (!base) return null;
  for (const ext of ['', '.json', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/** Find the module file an identifier is imported from (default or named, incl. alias). */
function resolveImportedIdentifier(fromFile, text, identifier) {
  const re = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const clause = m[1];
    const names = [];
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def && !clause.trimStart().startsWith('{')) names.push(def[1]);
    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const p = part.trim();
        if (!p) continue;
        const as = p.match(/^[\w$]+\s+as\s+([\w$]+)$/);
        names.push(as ? as[1] : p.split(/\s+/)[0]);
      }
    }
    if (names.includes(identifier)) return resolveSpec(fromFile, m[2]);
  }
  return null;
}

/**
 * Extract the settings-field catalog for one toolbox component.
 * Returns { source, mechanism, parseQuality, fields } (fields possibly []).
 */
function extractSettingsCatalog(file, text, objSrc) {
  // --- settingsFormMarkup ---
  let ident = null;
  const mm = objSrc.match(/settingsFormMarkup\s*:\s*([^,\n]+)/);
  if (mm) {
    const expr = mm[1].trim();
    const fnCall = expr.match(/^(?:\(?\s*[\w$]*\s*\)?\s*=>\s*)?([A-Za-z_$][\w$]*)\s*\(/);
    const bare = expr.match(/^([A-Za-z_$][\w$]*)\s*$/);
    ident = fnCall ? fnCall[1] : bare ? bare[1] : null;
  } else if (/(?:^|[,{\s])settingsFormMarkup\s*[,}]/.test(objSrc)) {
    ident = 'settingsFormMarkup';
  }

  if (ident) {
    // follow one local alias hop: const settingsForm = settingsFormJson as FormMarkup;
    let target = resolveImportedIdentifier(file, text, ident);
    if (!target) {
      const alias = text.match(new RegExp(`(?:const|let|var)\\s+${ident}\\s*(?::[^=]+)?=\\s*([A-Za-z_$][\\w$]*)\\s*(?:as\\b|;|,|\\n)`));
      if (alias) target = resolveImportedIdentifier(file, text, alias[1]);
    }
    if (target && target.endsWith('.json')) {
      try {
        const json = JSON.parse(readFile(target));
        return { source: rel(target), mechanism: 'json-markup', parseQuality: 'full', fields: fieldsFromMarkupJson(json) };
      } catch {
        return { source: rel(target), mechanism: 'json-markup', parseQuality: 'none', fields: [] };
      }
    }
    const chainText = target ? readFile(target) : text; // chain may be defined in the component file itself
    const fields = [...fieldsFromFluent(chainText), ...fieldsFromHelperCalls(chainText)];
    if (fields.length) {
      return { source: rel(target || file), mechanism: 'fluent-builder', parseQuality: 'full', fields };
    }
    // fall through to factory detection if the chain produced nothing
  }

  // --- settingsFormFactory ---
  const factorySnippet = extractPropSnippet(objSrc, 'settingsFormFactory');
  if (factorySnippet) {
    // find capitalized JSX components in the factory; resolve to a settings .tsx
    const jsxNames = [...new Set([...factorySnippet.matchAll(/<([A-Z][\w$]*)/g)].map((x) => x[1]))];
    for (const name of jsxNames) {
      const target = resolveImportedIdentifier(file, text, name);
      if (!target) continue;
      const fields = fieldsFromTsx(readFile(target));
      if (fields.length) return { source: rel(target), mechanism: 'react-factory', parseQuality: 'partial', fields };
    }
    // inline factory or same-file settings component
    const inline = fieldsFromTsx(factorySnippet.length > 200 ? factorySnippet : text);
    const fallback = inline.length ? inline : fieldsFromTsx(text);
    if (fallback.length) return { source: rel(file), mechanism: 'react-factory', parseQuality: 'partial', fields: fallback };
    return { source: rel(file), mechanism: 'react-factory', parseQuality: 'none', fields: [] };
  }

  // last resort: a settingsForm.json sitting in the component folder (covers
  // composite wrappers like notes/notesComponent.tsx building the markup object inline)
  if (ident) {
    const dirJson = path.join(path.dirname(file), 'settingsForm.json');
    if (fs.existsSync(dirJson)) {
      try {
        const json = JSON.parse(readFile(dirJson));
        const fields = fieldsFromMarkupJson(json);
        if (fields.length) return { source: rel(dirJson), mechanism: 'json-markup', parseQuality: 'full', fields };
      } catch { /* fall through */ }
    }
    return { source: rel(file), mechanism: 'fluent-builder', parseQuality: 'none', fields: [] };
  }
  return { source: null, mechanism: 'none', parseQuality: 'none', fields: [] };
}

/** Dedupe by path (first wins), then tag which paths are 0.45 appearance channels. */
function buildSettingsSection(catalog) {
  const seen = new Set();
  const fields = [];
  for (const f of catalog.fields) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    fields.push(f);
  }
  // Appearance fields stay INLINE in settingsFields — on 0.45 they are per-component,
  // not a shared panel, so there is nothing to factor out. `appearanceFieldPaths`
  // names them so gym-lib/groups.js can bucket them and the gym can add the
  // `desktop.` breakpoint prefix when generating variants.
  const appearanceFieldPaths = fields.filter((f) => isAppearancePath(f.path)).map((f) => f.path);
  return {
    settingsForm: { source: catalog.source, mechanism: catalog.mechanism, parseQuality: catalog.parseQuality },
    appearanceFieldPaths,
    settingsFields: fields,
  };
}

const SLOT_KEYS = ['components', 'childItems', 'tabs', 'columns', 'panels', 'steps', 'header', 'content', 'footer'];

function detectSlots(objSrc, componentDirFiles, propsResolved) {
  const slots = {
    hostsChildren: false,
    customContainerNames: null,
    detectedSlotKeys: [],
    usesComponentsContainer: false,
  };
  const ccn = extractPropSnippet(objSrc, 'customContainerNames');
  if (ccn && ccn.startsWith('[')) {
    const names = [...ccn.matchAll(/['"]([\w.]+)['"]/g)].map((x) => x[1]);
    if (names.length) slots.customContainerNames = names;
  }
  const dirText = componentDirFiles.map((f) => { try { return readFile(f); } catch { return ''; } }).join('\n');
  if (/ComponentsContainer\b/.test(dirText)) slots.usesComponentsContainer = true;
  for (const key of SLOT_KEYS) {
    const inProps = propsResolved && propsResolved.includes(key);
    const inModelUse = new RegExp(`model\\.${key}\\b`).test(dirText) ||
      new RegExp(`\\b${key}\\s*:\\s*I[\\w]*(Component|Tab|Column|Panel|Step)[\\w]*\\[\\]`).test(dirText);
    if (inProps || inModelUse) slots.detectedSlotKeys.push(key);
  }
  slots.hostsChildren = slots.usesComponentsContainer || !!slots.customContainerNames ||
    slots.detectedSlotKeys.some((k) => ['components', 'tabs', 'columns', 'panels', 'steps'].includes(k));
  return slots;
}

function processFile(file) {
  let text;
  try { text = readFile(file); } catch { return; }
  // generic content may nest (e.g. Omit<IWizardComponentProps, 'size'>) — anything but `=`/`{`/`;`
  // Two annotation styles: 0.43 `: IToolboxComponent<IProps>`, 0.45 `: XComponentDefinition`
  // (a per-component alias declared as `type XComponentDefinition = IToolboxComponent<IProps>`).
  const re = /(?:const|export\s+const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*(IToolboxComponent\s*(<[^={};]*>)?|[A-Za-z_$][\w$]*Definition)\s*=\s*\{/g;
  const UTILITY_TYPES = new Set(['Omit', 'Partial', 'Pick', 'Required', 'Readonly', 'any', 'unknown']);
  // 'dataContext' is registered by BOTH the app-context component (v2) and the
  // datatable wrapper (dataTable/tableContext, v8). Authored table markup uses
  // the wrapper — that definition wins the KB entry.
  const DUPLICATE_PREFERENCE = { dataContext: /tableContext/ };
  let m;
  while ((m = re.exec(text)) !== null) {
    const varName = m[1];
    const annotation = m[2];
    let propsInterface = null;
    if (m[3]) {
      const ids = [...m[3].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]).filter((x) => !UTILITY_TYPES.has(x));
      propsInterface = ids[0] || null;
    } else if (!annotation.startsWith('IToolboxComponent')) {
      // alias annotation — resolve generic via the alias index, else skip (not a toolbox def)
      propsInterface = toolboxAliasIndex.get(annotation.trim()) || null;
      if (!propsInterface && !toolboxAliasIndex.has(annotation.trim())) continue;
    }
    const braceIdx = m.index + m[0].length - 1;
    const objSrc = balancedSpan(text, braceIdx);
    if (!objSrc) {
      gaps.push({ file: rel(file), variable: varName, reason: 'Could not extract balanced object literal for IToolboxComponent definition' });
      continue;
    }

    const type = extractStringProp(objSrc, 'type');
    if (!type) {
      gaps.push({ file: rel(file), variable: varName, reason: 'IToolboxComponent object has no statically-readable type string' });
      continue;
    }
    if (entries.has(type)) {
      // Some type strings are registered by two components. Where the runtime
      // resolves a specific one for authored markup, prefer that definition.
      const preferred = DUPLICATE_PREFERENCE[type];
      if (preferred && preferred.test(rel(file))) {
        gaps.push({ file: rel(file), variable: varName, type, reason: `Duplicate type '${type}' — this definition PREFERRED over ${entries.get(type).sourceFiles[0]} (runtime resolves this one for authored markup)` });
        entries.delete(type);
      } else {
        gaps.push({ file: rel(file), variable: varName, type, reason: `Duplicate type '${type}' — first definition kept (${entries.get(type).sourceFiles[0]})` });
        continue;
      }
    }

    const componentDir = path.dirname(file);
    const componentDirFiles = walk(componentDir, ['.ts', '.tsx']);

    // --- version (migrator chain) ---
    let version = null;
    let migratorNote;
    if (/(?:^|[,{\s])migrator\s*:/m.test(objSrc)) {
      let max = highestAddIndex(objSrc);
      if (max < 0) {
        // chain may live in another file within the component folder (e.g. migrations/)
        for (const f of componentDirFiles) {
          if (f === file) continue;
          max = Math.max(max, highestAddIndex(readFile(f)));
        }
        migratorNote = max >= 0 ? 'migrator chain resolved from sibling file(s), not inline' : undefined;
      }
      if (max >= 0) version = max;
      else gaps.push({ file: rel(file), type, reason: 'migrator present but no .add(N, ...) indices found' });
    }
    if (version === null) {
      // No inline migrator at all — the chain may live in a sibling definition
      // (e.g. dataTable/tableContext keeps its .add chain in the legacy file).
      let max = -1;
      for (const f of componentDirFiles) {
        if (f === file) continue;
        max = Math.max(max, highestAddIndex(readFile(f)));
      }
      if (max >= 0) {
        version = max;
        gaps.push({ file: rel(file), type, reason: `version ${max} resolved from sibling file(s) — no inline migrator on the definition` });
      }
    }

    // --- initModel ---
    const initModelSnippet = extractPropSnippet(objSrc, 'initModel');
    const initModelDefaults = parseInitModelDefaults(initModelSnippet);
    if (initModelSnippet && !initModelDefaults && !/\.\.\.\s*model\s*[,}]?\s*\}?\s*\)?$/.test(initModelSnippet.replace(/\s+/g, ' '))) {
      // only flag when there was something to parse beyond spread
      if (!/^\(?\s*\(?model\)?\s*\)?\s*=>\s*\(\s*\{\s*\.\.\.model\s*,?\s*\}\s*\)$/.test(initModelSnippet.replace(/\s+/g, ' '))) {
        gaps.push({ file: rel(file), type, reason: 'initModel present but no statically-readable literal defaults parsed (raw snippet recorded)' });
      }
    }

    // --- settings props interface ---
    let settingsProps = null;
    if (propsInterface) {
      const decl = interfaceIndex.get(propsInterface);
      const resolved = resolveInterface(propsInterface);
      settingsProps = {
        interfaceName: propsInterface,
        interfaceFile: decl ? decl.file : null,
        ownProps: decl ? decl.props : [],
        extends: decl ? decl.extends : [],
        resolvedProps: resolved.props.sort(),
        unresolvedExtends: [...new Set(resolved.unresolved)].sort(),
      };
      if (!decl) gaps.push({ file: rel(file), type, reason: `Props interface '${propsInterface}' declaration not found in indexed sources` });
    } else {
      gaps.push({ file: rel(file), type, reason: 'IToolboxComponent has no generic props interface parameter' });
    }

    // --- slots ---
    const slots = detectSlots(objSrc, componentDirFiles, settingsProps ? settingsProps.resolvedProps : null);

    // --- settings-field catalog ---
    let settingsSection;
    try {
      const catalog = extractSettingsCatalog(file, text, objSrc);
      settingsSection = buildSettingsSection(catalog);
      if (catalog.parseQuality === 'none') {
        gaps.push({ file: rel(file), type, reason: `Settings catalog: no fields extracted (mechanism: ${catalog.mechanism})` });
      }
    } catch (err) {
      settingsSection = {
        settingsForm: { source: null, mechanism: 'error', parseQuality: 'none' },
        appearanceFieldPaths: [], settingsFields: [],
      };
      gaps.push({ file: rel(file), type, reason: `Settings catalog extraction threw: ${err.message}` });
    }

    // --- source files ---
    const sourceFiles = [rel(file)];
    if (settingsProps && settingsProps.interfaceFile) {
      const asDesignerRel = path.relative(SRC, path.join(SRC_ROOT, settingsProps.interfaceFile)).split(path.sep).join('/');
      if (!sourceFiles.includes(asDesignerRel)) sourceFiles.push(asDesignerRel);
    }

    const entry = {
      type,
      name: extractStringProp(objSrc, 'name') ?? null,
      isInput: extractBoolProp(objSrc, 'isInput') ?? null,
      isOutput: extractBoolProp(objSrc, 'isOutput') ?? null,
      canBeJsSetting: extractBoolProp(objSrc, 'canBeJsSetting') ?? null,
      icon: (objSrc.match(/(?:^|[,{\s])icon\s*:\s*<\s*([A-Za-z_$][\w$]*)/m) || [])[1] ?? null,
      version, // null => component has no migrator; OMIT the version prop in markup
      ...(migratorNote ? { migratorNote } : {}),
      initModel: initModelSnippet
        ? { defaults: initModelDefaults, raw: initModelSnippet.length > 2000 ? initModelSnippet.slice(0, 2000) + ' /* truncated */' : initModelSnippet }
        : null,
      settingsProps,
      ...settingsSection,
      slots,
      sourceFiles,
    };
    entries.set(type, entry);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
buildInterfaceIndex();

for (const file of walk(SRC, ['.ts', '.tsx'])) processFile(file);

// Folders with no toolbox component at all -> gaps
for (const e of fs.readdirSync(SRC, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!e.isDirectory() || e.name.startsWith('_') || e.name === '__tests__') continue;
  const folder = path.join(SRC, e.name);
  const hasEntry = [...entries.values()].some((en) => en.sourceFiles[0].startsWith(e.name + '/'));
  if (!hasEntry) {
    gaps.push({ file: e.name + '/', reason: 'No IToolboxComponent definition found in this component folder' });
  }
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true });

const sortedTypes = [...entries.keys()].sort();
const index = {};
for (const type of sortedTypes) {
  const entry = entries.get(type);
  const fileName = type.replace(/[^\w.-]/g, '_') + '.json';
  fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(entry, null, 2) + '\n');
  index[type] = {
    version: entry.version, name: entry.name, isInput: entry.isInput, file: fileName,
    settingsParseQuality: entry.settingsForm ? entry.settingsForm.parseQuality : 'none',
    settingsFieldCount: entry.settingsFields ? entry.settingsFields.length : 0,
    appearanceFieldCount: entry.appearanceFieldPaths ? entry.appearanceFieldPaths.length : 0,
  };
}
fs.writeFileSync(path.join(outDir, '_index.json'), JSON.stringify(index, null, 2) + '\n');

// No shared appearance catalog is emitted: on 0.45 there is no shared appearance
// panel to factor out — each component declares its own families inline, and they
// stay in that component's settingsFields (named by appearanceFieldPaths). The 0.43
// _shared-style-fields.json and its two readers are gone.

let commit = null;
let sourceBranch = null;
try {
  commit = execSync('git rev-parse HEAD', { cwd: SRC, encoding: 'utf8' }).trim();
  const b = execSync('git branch --show-current', { cwd: SRC, encoding: 'utf8' }).trim();
  sourceBranch = b || null;
  if (!sourceBranch) {
    // detached HEAD (worktree) — find a branch containing this commit
    const branches = execSync('git branch -a --contains HEAD', { cwd: SRC, encoding: 'utf8' })
      .split('\n').map((s) => s.replace(/^[*+\s]+/, '').trim()).filter(Boolean);
    sourceBranch = branches.find((x) => /releases\//.test(x)) || branches[0] || null;
  }
} catch { /* not a git repo */ }

let generatedAt = null;
try {
  generatedAt = execSync('git log -1 --format=%cI', { cwd: SRC, encoding: 'utf8' }).trim();
} catch { /* ignore */ }

fs.writeFileSync(path.join(outDir, '_meta.json'), JSON.stringify({
  sourceDir: SRC.split(path.sep).join('/'),
  sourceBranch,
  commit,
  sourceCommitDate: generatedAt,
  generatedAt: new Date().toISOString(),
  componentCount: sortedTypes.length,
  settingsCatalog: (() => {
    const all = [...entries.values()];
    const q = (x) => all.filter((e) => e.settingsForm && e.settingsForm.parseQuality === x).length;
    const totalFields = all.reduce((s, e) => s + (e.settingsFields ? e.settingsFields.length : 0), 0);
    return {
      full: q('full'), partial: q('partial'), none: q('none'),
      withAppearanceFields: all.filter((e) => (e.appearanceFieldPaths || []).length > 0).length,
      totalAppearanceFields: all.reduce((s, e) => s + (e.appearanceFieldPaths || []).length, 0),
      totalFields,
      avgFieldsPerComponent: Math.round((totalFields / all.length) * 10) / 10,
    };
  })(),
}, null, 2) + '\n');

fs.writeFileSync(path.join(outDir, '_gaps.json'), JSON.stringify(gaps, null, 2) + '\n');

console.log(`Extracted ${sortedTypes.length} toolbox components -> ${outDir}`);
console.log(`Gaps/warnings: ${gaps.length} (see _gaps.json)`);
