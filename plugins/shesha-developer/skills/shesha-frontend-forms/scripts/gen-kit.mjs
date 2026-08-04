#!/usr/bin/env node
/**
 * gen-kit — generate the mirror kit.
 *
 * THE HEART OF THE REBUILD. The spec a model writes is runnable JSX, because a model has a
 * reliable forward model for React and none for Shesha JSON. The kit is the straitjacket
 * that keeps that freedom inside Shesha's expressive envelope.
 *
 * TWO INPUTS, BOTH ALREADY KNOWN:
 *   ground-truth.json          what Shesha can honour  (props, versions, container slots)
 *   assets/house-anatomy.json  the fixed anatomy        (structure, transcribed)
 *   assets/tokens/<brand>.json appearance               (colour, type, geometry, transcribed)
 *
 * Nothing here designs anything. If this file ever contains a hex literal or a px font
 * size, the generator has started making design decisions and the token boundary is gone.
 *
 * THE BET THIS PHASE TESTS: every line in the emitted kit is generated. If the kit needs
 * meaningful hand-written per-component code it will drift from the framework within one
 * release, and we will have rebuilt the capability matrix with extra steps. The test is
 * blunt — count hand-written lines in .shesha/kit/. It should be zero.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(HERE, '..');

export const BANNER = '// GENERATED from ground-truth.json + house-anatomy.json + tokens — do not edit.';

/** Style channels the mirror kit may express, and the ground-truth settings key each needs. */
const CHANNEL_REQUIREMENTS = {
  font: ['font'],
  background: ['background'],
  border: ['border'],
  shadow: ['shadow'],
  dimensions: ['dimensions', 'pnlDimensions'],
};

export class KitError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'KitError';
    this.exitCode = exitCode;
  }
}

export function loadTheme(name) {
  const p = join(SKILL_ROOT, 'assets', 'tokens', `${name}.tokens.json`);
  if (!existsSync(p)) {
    const available = readdirSync(join(SKILL_ROOT, 'assets', 'tokens'))
      .filter((f) => f.endsWith('.tokens.json'))
      .map((f) => f.replace('.tokens.json', ''));
    throw new KitError(`no theme "${name}". Available: ${available.join(', ')}`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function loadAnatomy() {
  return JSON.parse(readFileSync(join(SKILL_ROOT, 'assets', 'house-anatomy.json'), 'utf8'));
}

/**
 * Resolve a @token.path reference against the active theme.
 *
 * A NULL token is a deleted role, not a missing value — WCG deletes sage, accentBlue and
 * accentTeal outright. A deleted role resolves to its documented fallback; it never
 * resolves to a colour this generator picked.
 */
export function resolveToken(ref, theme, { fallback = null } = {}) {
  if (typeof ref !== 'string' || !ref.startsWith('@')) return ref;
  const path = ref.slice(1);
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = theme;
  for (const part of parts) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[part];
  }
  if (cur === null || cur === undefined) return fallback;
  return cur;
}

/** Resolve every @ref inside a style object, including inside composite strings. */
export function resolveStyle(styleSpec, theme, ctx = {}) {
  const out = {};
  for (const [prop, value] of Object.entries(styleSpec || {})) {
    out[prop] = resolveValue(value, theme, ctx);
  }
  return out;
}

function resolveValue(value, theme, ctx) {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, theme, ctx));
  if (typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = resolveValue(v, theme, ctx);
    return o;
  }
  if (typeof value !== 'string') return value;

  // Render-time sentinels. These are NOT theme paths and must be recognised before the
  // token branch, or they resolve to undefined -> null and are silently dropped.
  if (value === '@emphasis') return '__EMPHASIS__';
  if (value === '@emphasisBg') return '__EMPHASIS_BG__';
  if (value.startsWith('@@')) return value;

  if (value.startsWith('@') && !/\s/.test(value)) {
    const r = resolveToken(value, theme, { fallback: null });
    return r === null ? null : r;
  }
  // Composite strings such as "1px solid @line.border" or "3px solid @emphasis".
  // The emphasis placeholders must survive this pass: they are not theme paths, they are
  // resolved from a PROP at render time. Letting resolveToken see them yielded undefined ->
  // 'transparent', which silently erased every left accent in the kit.
  return value.replace(/@[A-Za-z0-9_.[\]]+/g, (m) => {
    if (m === '@emphasis') return '__EMPHASIS__';
    if (m === '@emphasisBg') return '__EMPHASIS_BG__';
    const r = resolveToken(m, theme, { fallback: null });
    return r === null ? 'transparent' : String(r);
  });
}

/** The emphasis -> token mapping, derived from the theme rather than chosen. */
export function emphasisMap(theme) {
  const s = theme.semantic || {};
  return {
    default: { fg: theme.ink.default, bg: theme.surface.surfaceAlt, accent: theme.line.borderStrong },
    primary: { fg: theme.brand.primary, bg: theme.brand.tint, accent: theme.brand.primary },
    // sage is nullable — WCG deletes it, so success falls back to primary rather than to
    // a green this generator invented.
    success: { fg: s.sage || theme.brand.primary, bg: theme.brand.tint, accent: s.sage || theme.brand.primary },
    warning: { fg: s.warningFg || s.warning, bg: s.warningBg, accent: s.warning },
    danger: { fg: s.danger, bg: s.dangerBg, accent: s.danger },
    info: { fg: s.info, bg: s.infoBg, accent: s.info },
    muted: { fg: theme.ink.soft, bg: theme.surface.surfaceAlt, accent: theme.line.borderStrong },
  };
}

/**
 * Decide which style channels a Shesha component can actually honour, from its own
 * settings surface in ground truth.
 *
 * This is R-053 enforced BY CONSTRUCTION: a prop mapping to a channel the component does
 * not expose is never generated, so authoring one becomes a compile error rather than a
 * silent runtime no-op. It is also how the 586KB measured-capability-matrix is replaced by
 * a derived signal.
 */
export function supportedChannels(sheshaType, groundTruth) {
  const def = groundTruth.registry[sheshaType];
  if (!def || !def.settings || !Array.isArray(def.settings.propertyNames)) {
    return { known: false, channels: null, reason: def ? 'no settings markup' : 'type not in registry' };
  }
  const names = def.settings.propertyNames.map((n) => n.toLowerCase());
  const channels = {};
  for (const [channel, keys] of Object.entries(CHANNEL_REQUIREMENTS)) {
    channels[channel] = keys.some((k) => names.some((n) => n.includes(k.toLowerCase())));
  }
  return { known: true, channels, reason: null };
}

/** Which style properties in a resolved style object belong to which channel. */
const PROP_CHANNEL = [
  [/^(font|letterSpacing|textTransform|lineHeight|color|textAlign|whiteSpace)/, 'font'],
  [/^background/, 'background'],
  [/^(border|outline)/, 'border'],
  [/^boxShadow/, 'shadow'],
  [/^(width|height|minWidth|minHeight|maxWidth|maxHeight|flex)/, 'dimensions'],
];

function channelOf(prop) {
  for (const [re, ch] of PROP_CHANNEL) if (re.test(prop)) return ch;
  return null; // layout/padding/gap: always available on a container
}

const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Split a resolved style object into module-scope constants and render-time values.
 *
 * An emphasis placeholder cannot live in a module-scope const: emphasis is a PROP, so it is
 * only known inside the component. Emitting E.accent into BASE produced "E is not defined".
 * They are separated here and merged at render time.
 */
function splitEmphasis(obj) {
  const staticStyle = {};
  const dynamic = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (v === '@@repeatColumns') {
      // An equal-column grid whose count is a prop. Emitted as a render-time expression
      // because the count is not known until the spec supplies it.
      dynamic.push([k, "'repeat(' + (props.columns || 4) + ', minmax(0, 1fr))'"]);
    } else if (v === '__EMPHASIS__') {
      dynamic.push([k, 'E.accent']);
    } else if (v === '__EMPHASIS_BG__') {
      dynamic.push([k, 'E.bg']);
    } else if (typeof v === 'string' && (v.includes('__EMPHASIS__') || v.includes('__EMPHASIS_BG__'))) {
      // Composite such as "3px solid __EMPHASIS__".
      const expr = JSON.stringify(v)
        .replace(/__EMPHASIS_BG__/g, '" + E.bg + "')
        .replace(/__EMPHASIS__/g, '" + E.accent + "');
      dynamic.push([k, expr]);
    } else {
      staticStyle[k] = v;
    }
  }
  return { staticStyle, dynamic };
}

function emitObject(obj, indent = 2) {
  const pad = ' '.repeat(indent);
  const entries = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${pad}${JS_IDENT.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return entries.length ? `{\n${entries.join(',\n')}\n${' '.repeat(indent - 2)}}` : '{}';
}

/**
 * Emit one kit component.
 *
 * The emitted component is intentionally dumb: it resolves its own style object at module
 * scope from already-resolved token values and renders. There is no logic here that could
 * drift from the framework, because there is no framework knowledge in it — that lives in
 * the compiler, which reads ground truth.
 */
function emitComponent(name, spec, theme, groundTruth, report) {
  const support = supportedChannels(spec.sheshaType, groundTruth);
  const resolved = resolveStyle(spec.style, theme);

  /**
   * The mock keeps EVERY anatomy style. It must, or preview shows the model something the
   * design does not say and the whole forward-model premise collapses — a Page that drops
   * its fontFamily renders in the browser default and looks like a bug.
   *
   * What the channel-support signal actually constrains is the COMPILER: if the Shesha
   * type cannot carry a channel directly, the compiler has to reach that appearance another
   * way (inherit from the app theme, push it down to the text nodes, or let the Ant
   * component's own styling own it). Those are recorded per component as a compile
   * constraint, not silently deleted here.
   *
   * R-053-by-construction still holds, because it is about AUTHOR PROPS: a prop mapping to
   * a channel the component cannot honour is never generated, so authoring one is a compile
   * error rather than a silent runtime no-op.
   */
  const kept = resolved;
  for (const [prop] of Object.entries(resolved)) {
    const ch = channelOf(prop);
    if (ch && support.known && support.channels[ch] === false) {
      report.compileConstraints.push({ component: name, sheshaType: spec.sheshaType, prop, channel: ch });
    }
  }

  const parts = {};
  for (const [partName, partSpec] of Object.entries(spec.parts || {})) {
    parts[partName] = resolveStyle(partSpec, theme);
  }
  const variants = {};
  for (const [vName, vSpec] of Object.entries(spec.variants || {})) {
    variants[vName] = resolveStyle(vSpec, theme);
  }
  const roles = {};
  for (const [rName, rSpec] of Object.entries(spec.roles || {})) {
    roles[rName] = resolveStyle(rSpec, theme);
  }

  /**
   * The author prop surface, filtered by what this Shesha type can honour.
   *
   * A prop declared in the anatomy whose channel the component cannot carry is NOT
   * generated, so writing it in a spec throws from allowProps rather than compiling into a
   * dead style block. That is R-053 enforced by construction rather than by a validator
   * reading a measured corpus.
   */
  const PROP_CHANNEL_NEED = { emphasis: 'background', density: 'dimensions', width: 'dimensions' };
  const propNames = [];
  for (const pName of Object.keys(spec.props || {})) {
    const need = PROP_CHANNEL_NEED[pName];
    if (need && support.known && support.channels[need] === false) {
      report.droppedProps.push({ component: name, sheshaType: spec.sheshaType, prop: pName, channel: need });
      continue;
    }
    propNames.push(pName);
  }
  const allowed = new Set([...propNames, 'children']);
  // Structural props every container accepts; they compile to layout, not to a style channel.
  if (spec.children) for (const p of ['justify', 'align', 'gap']) allowed.add(p);

  const lines = [];
  lines.push(BANNER);
  lines.push(`// component: ${name}   ->  shesha type: ${spec.sheshaType}`);
  if (spec.note) lines.push(`// ${spec.note.replace(/\n/g, ' ')}`);
  lines.push(`import React from 'react';`);
  lines.push(`import { EMPHASIS, allowProps } from './_runtime.js';`);
  lines.push('');
  lines.push(`export const __meta = ${JSON.stringify({
    name,
    sheshaType: spec.sheshaType,
    props: spec.props || {},
    children: spec.children || null,
    sheshaSlots: spec.sheshaSlots || null,
    compileFlags: spec.compileFlags || null,
    requiresWrapper: spec.requiresWrapper || null,
    supportedChannels: support.channels,
    allowedProps: [...allowed],
  })};`);
  lines.push('');
  const { staticStyle, dynamic } = splitEmphasis(kept);
  lines.push(`const BASE = ${emitObject(staticStyle, 2)};`);
  if (Object.keys(parts).length) lines.push(`const PARTS = ${JSON.stringify(parts, null, 2)};`);
  if (Object.keys(variants).length) lines.push(`const VARIANTS = ${JSON.stringify(variants, null, 2)};`);
  if (Object.keys(roles).length) lines.push(`const ROLES = ${JSON.stringify(roles, null, 2)};`);
  lines.push('');
  lines.push(`export function ${name}(props) {`);
  lines.push(`  allowProps('${name}', props, __meta.allowedProps);`);
  lines.push(`  const E = EMPHASIS[props.emphasis || '${(spec.props && spec.props.emphasis && spec.props.emphasis.default) || 'default'}'] || EMPHASIS.default;`);
  lines.push(`  const style = { ...BASE };`);
  for (const [prop, expr] of dynamic) {
    lines.push(`  style[${JSON.stringify(prop)}] = ${expr};`);
  }
  if (Object.keys(variants).length) {
    lines.push(`  Object.assign(style, VARIANTS[props.variant || '${(spec.props && spec.props.variant && spec.props.variant.default) || 'secondary'}'] || {});`);
  }
  if (Object.keys(roles).length) {
    lines.push(`  Object.assign(style, ROLES[props.role || '${(spec.props && spec.props.role && spec.props.role.default) || 'body'}'] || {});`);
  }
  lines.push(`  if (props.width && props.width !== 'fill') style.width = props.width;`);
  lines.push(`  if (props.width === 'fill') style.flex = '1 1 0%';`);
  lines.push(`  if (props.justify) style.justifyContent = ({start:'flex-start',end:'flex-end',between:'space-between',center:'center'})[props.justify] || props.justify;`);
  lines.push(`  if (props.align) style.alignItems = ({start:'flex-start',end:'flex-end',center:'center',stretch:'stretch'})[props.align] || props.align;`);
  lines.push(`  if (props.gap !== undefined) style.gap = props.gap;`);
  lines.push('');
  lines.push(emitRenderBody(name, spec, parts));
  lines.push(`}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * The render body. Shapes are chosen from the anatomy's declared parts, not invented:
 * a component with a headerBand part renders a band, one with a label part renders a label.
 */
function emitRenderBody(name, spec, parts) {
  const has = (p) => Object.prototype.hasOwnProperty.call(parts, p);
  const L = [];
  L.push(`  return (`);
  L.push(`    <div data-kit="${name}" data-shesha-type="${spec.sheshaType}" style={style}>`);

  if (has('headerBand')) {
    L.push(`      {(props.title || props.meta) && (`);
    L.push(`        <div data-part="headerBand" style={PARTS.headerBand}>`);
    L.push(`          <span style={PARTS.headerTitle}>{props.title}</span>`);
    L.push(`          {props.meta ? <span>{props.meta}</span> : null}`);
    L.push(`        </div>`);
    L.push(`      )}`);
    L.push(`      <div data-part="body" style={PARTS.body}>{props.children}</div>`);
  } else if (name === 'StatCard') {
    L.push(`      <div data-part="label" style={PARTS.label}>{props.label}</div>`);
    L.push(`      <div data-part="value" style={PARTS.value}>{props.value ?? (props.bind ? '\\u2014' : '')}</div>`);
    L.push(`      {props.caption ? <div data-part="caption" style={PARTS.caption}>{props.caption}</div> : null}`);
  } else if (name === 'PageHeader') {
    L.push(`      <div>`);
    L.push(`        <div data-part="title" style={PARTS.title}>{props.title}</div>`);
    L.push(`        {props.subtitle ? <div data-part="subtitle" style={PARTS.subtitle}>{props.subtitle}</div> : null}`);
    L.push(`      </div>`);
    L.push(`      {props.actions ? <div>{props.actions}</div> : null}`);
    L.push(`      {props.children}`);
  } else if (name === 'Breadcrumbs') {
    L.push(`      {(props.items || []).map((c, i, a) => (`);
    L.push(`        <React.Fragment key={i}>`);
    L.push(`          <span style={i === a.length - 1 ? PARTS.last : PARTS.crumb}>{c}</span>`);
    L.push(`          {i < a.length - 1 ? <span style={PARTS.chevron}>{'\\u203a'}</span> : null}`);
    L.push(`        </React.Fragment>`);
    L.push(`      ))}`);
  } else if (name === 'KeyFactsStrip') {
    L.push(`      {React.Children.map(props.children, (child, i) => (`);
    L.push(`        <div data-part="tile" key={i} style={PARTS.tile}>`);
    L.push(`          <div style={PARTS.label}>{child && child.props ? child.props.label : ''}</div>`);
    L.push(`          <div style={PARTS.value}>{child && child.props ? (child.props.value ?? '\\u2014') : ''}</div>`);
    L.push(`        </div>`);
    L.push(`      ))}`);
  } else if (name === 'DataTable') {
    L.push(`      {props.toolbar ? <div data-part="toolbar" style={PARTS.toolbar}>{props.toolbar}</div> : null}`);
    L.push(`      <table style={{ width: '100%', borderCollapse: 'collapse' }}>`);
    L.push(`        <thead><tr>`);
    L.push(`          {React.Children.map(props.children, (col, i) => (`);
    L.push(`            <th key={i} style={{ ...PARTS.head, textAlign: (col && col.props && col.props.align) || PARTS.head.textAlign, width: col && col.props && col.props.width !== 'fill' ? col.props.width : undefined }}>`);
    L.push(`              {(col && col.props && (col.props.caption || col.props.bind)) || ''}`);
    L.push(`            </th>`);
    L.push(`          ))}`);
    L.push(`        </tr></thead>`);
    L.push(`        <tbody>`);
    L.push(`          {[0, 1, 2, 3, 4].map((r) => (`);
    L.push(`            <tr key={r}>`);
    L.push(`              {React.Children.map(props.children, (col, i) => (`);
    L.push(`                <td key={i} style={{ ...PARTS.cell, textAlign: (col && col.props && col.props.align) || PARTS.cell.textAlign }}>`);
    L.push(`                  {col && col.props && col.props.children ? col.props.children : <span style={{ color: PARTS.cell.color, opacity: 0.55 }}>{'sample'}</span>}`);
    L.push(`                </td>`);
    L.push(`              ))}`);
    L.push(`            </tr>`);
    L.push(`          ))}`);
    L.push(`        </tbody>`);
    L.push(`      </table>`);
    L.push(`      <div data-part="pager" style={PARTS.pager}>{'1 2 3'}</div>`);
  } else if (has('input')) {
    L.push(`      <label data-part="label" style={PARTS.label}>{props.label}{props.required ? ' *' : ''}</label>`);
    L.push(`      <div data-part="input" style={{ ...PARTS.input, ...(props.readOnly ? PARTS.readOnly : {}) }}>`);
    L.push(`        <span style={{ opacity: 0.45 }}>{props.bind || ''}</span>`);
    L.push(`      </div>`);
  } else if (has('track') && name === 'Switch') {
    L.push(`      <div data-part="track" style={{ ...PARTS.track, position: 'relative' }}>`);
    L.push(`        <div data-part="knob" style={{ ...PARTS.knob, position: 'absolute', top: 2, left: 2, background: '#fff' }} />`);
    L.push(`      </div>`);
    L.push(`      <span>{props.label}</span>`);
  } else if (has('track')) {
    L.push(`      {props.label ? <div data-part="labelRow" style={PARTS.labelRow}><span>{props.label}</span></div> : null}`);
    L.push(`      <div data-part="track" style={PARTS.track}><div style={{ ...PARTS.fill, width: '60%' }} /></div>`);
  } else if (has('box')) {
    L.push(`      <div data-part="box" style={PARTS.box} />`);
    L.push(`      <span>{props.label}</span>`);
  } else if (has('title') && name === 'EmptyState') {
    L.push(`      <div data-part="title" style={PARTS.title}>{props.title}</div>`);
    L.push(`      {props.hint ? <div data-part="hint" style={PARTS.hint}>{props.hint}</div> : null}`);
  } else if (has('item') && name === 'Tabs') {
    L.push(`      {React.Children.map(props.children, (t, i) => (`);
    L.push(`        <div key={i} data-part="item" style={i === 0 ? { ...PARTS.item, ...PARTS.itemActive } : PARTS.item}>`);
    L.push(`          {t && t.props ? t.props.title : ''}`);
    L.push(`        </div>`);
    L.push(`      ))}`);
  } else if (name === 'StatusPill') {
    L.push(`      <span style={{ padding: '4px 10px', background: E.accent, color: '#ffffff' }}>{props.bind || props.children || 'STATUS'}</span>`);
  } else if (name === 'Badge' || name === 'CountBadge') {
    L.push(`      <span style={{ background: E.accent, color: '#ffffff' }}>{props.children}</span>`);
  } else {
    L.push(`      {props.children ?? null}`);
  }

  L.push(`    </div>`);
  L.push(`  );`);
  return L.join('\n');
}

/** The shared runtime: emphasis table plus the prop allow-list that makes the kit a straitjacket. */
function emitRuntime(theme) {
  const E = emphasisMap(theme);
  return `${BANNER}
// The kit runtime. EMPHASIS is derived from the active theme, so a deleted role
// (WCG removes sage, accentBlue and accentTeal) falls back to a documented token
// rather than to a colour the generator invented.

export const THEME_NAME = ${JSON.stringify(theme.name)};
export const STATUS_MODEL = ${JSON.stringify(theme.statusModel)};
export const EMPHASIS = ${JSON.stringify(E, null, 2)};

const FORBIDDEN = ${JSON.stringify(['style', 'className', 'css', 'sx', 'dangerouslySetInnerHTML'])};

/**
 * Reject anything outside a component's generated prop surface.
 *
 * This is what makes the kit a straitjacket rather than a suggestion: styling is
 * emphasis / surface / role / density only, with NO override channel. There is no way to
 * smuggle a hex value or a px font size into a spec, which is what kept the previous
 * stack's IR honest while destroying the model's ability to see the result.
 */
export function allowProps(component, props, allowed) {
  for (const key of Object.keys(props || {})) {
    if (FORBIDDEN.includes(key)) {
      throw new Error(
        '[kit] <' + component + '> does not accept a "' + key + '" prop. ' +
        'Appearance comes from the active theme via emphasis/surface/role/density. ' +
        'If the design cannot be expressed that way, that is a kit gap to log, not a reason to paint.'
      );
    }
    if (!allowed.includes(key) && key !== 'key' && key !== 'ref') {
      throw new Error(
        '[kit] <' + component + '> has no prop "' + key + '". Allowed: ' + allowed.join(', ')
      );
    }
  }
}
`;
}

/** Components the spec author may NOT use, with the reason, so exit 15 can explain itself. */
function emitForbidden() {
  return `${BANNER}
// Components deliberately absent from the kit, with the reason. preview/compile exit 15
// naming the component, and this map supplies the explanation. That error log is the
// v1.1 backlog.

export const FORBIDDEN_COMPONENTS = {
  columns: 'The Shesha columns component is excluded by design [R-028]. Use Row with per-child width instead: a flex child is sized only by desktop.dimensions.width.',
  htmlRender: 'Layout can only be BUILT, never PAINTED. A whole page faked out of html blocks is the failure this kit exists to prevent.',
  markdown: 'Same reason as htmlRender — it is a painting channel.',
  div: 'Raw elements bypass the kit and therefore bypass the compiler. Use Stack, Row or Card.',
  span: 'Raw elements bypass the kit. Use Text.',
  p: 'Raw elements bypass the kit. Use Text.',
  img: 'Use an image kit component; a raw img renders inside an unsized ant-image wrapper [R-055].',
};
`;
}

export function generateKit({ groundTruthPath, outDir, themeName }) {
  if (!existsSync(groundTruthPath)) {
    throw new KitError(`no ground truth at ${groundTruthPath} — run \`probe --app <path>\` first`, 2);
  }
  const groundTruth = JSON.parse(readFileSync(groundTruthPath, 'utf8'));
  const anatomy = loadAnatomy();
  const theme = loadTheme(themeName);

  const report = {
    theme: themeName,
    frameworkVersion: groundTruth.framework.version,
    generatedAt: new Date().toISOString(),
    components: [],
    // Style channels the Shesha type cannot carry directly. The mock renders them; the
    // COMPILER must reach the same appearance another way. This list is Phase 4's job list,
    // and it replaces the 586KB measured-capability-matrix with a derived signal.
    compileConstraints: [],
    // Author props dropped because they map to a channel the component cannot honour —
    // R-053 enforced by construction.
    droppedProps: [],
    excluded: [],
    generatorSha256: createHash('sha256').update(readFileSync(join(HERE, 'gen-kit.mjs'))).digest('hex'),
    anatomySha256: createHash('sha256')
      .update(readFileSync(join(SKILL_ROOT, 'assets', 'house-anatomy.json')))
      .digest('hex'),
    themeSha256: createHash('sha256')
      .update(readFileSync(join(SKILL_ROOT, 'assets', 'tokens', `${themeName}.tokens.json`)))
      .digest('hex'),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, '_runtime.js'), emitRuntime(theme), 'utf8');
  writeFileSync(join(outDir, '_forbidden.js'), emitForbidden(), 'utf8');

  const names = [];
  for (const [name, spec] of Object.entries(anatomy.components)) {
    // A kit component whose Shesha type is not registered in THIS app cannot be compiled,
    // so it is excluded rather than generated and left to fail later.
    const synthetic = spec.sheshaType.startsWith('__');
    if (!synthetic && !groundTruth.registry[spec.sheshaType]) {
      report.excluded.push({ component: name, sheshaType: spec.sheshaType, reason: 'type not registered in this app' });
      continue;
    }
    writeFileSync(join(outDir, `${name}.jsx`), emitComponent(name, spec, theme, groundTruth, report), 'utf8');
    names.push(name);
    report.components.push({ name, sheshaType: spec.sheshaType });
  }

  const index = [
    BANNER,
    '// The mirror kit. Import from here in a spec:',
    "//   import { Page, Card, DataTable, Column } from '@shesha-mirror/kit';",
    '',
    ...names.map((n) => `export { ${n}, __meta as __meta_${n} } from './${n}.jsx';`),
    `export { EMPHASIS, THEME_NAME, STATUS_MODEL, allowProps } from './_runtime.js';`,
    `export { FORBIDDEN_COMPONENTS } from './_forbidden.js';`,
    `export const KIT_COMPONENTS = ${JSON.stringify(names)};`,
    `export const KIT_THEME = ${JSON.stringify(themeName)};`,
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'index.js'), index, 'utf8');
  writeFileSync(join(outDir, 'kit-manifest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  // The kit is generated output living in the target app; never commit it.
  writeFileSync(join(outDir, '.gitignore'), '# GENERATED mirror kit. Never commit.\n*\n', 'utf8');

  return report;
}

// CLI use: node gen-kit.mjs --ground-truth <f> --out <dir> --theme <name>
if (process.argv[1] && process.argv[1].endsWith('gen-kit.mjs')) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i > -1 ? args[i + 1] : def;
  };
  try {
    const report = generateKit({
      groundTruthPath: get('--ground-truth'),
      outDir: get('--out'),
      themeName: get('--theme', 'shesha'),
    });
    process.stdout.write(JSON.stringify({ ok: true, components: report.components.length, dropped: report.droppedProps.length, constraints: report.compileConstraints.length, excluded: report.excluded.length }, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`gen-kit: ${(e && e.message) || e}\n`);
    process.exit(e.exitCode || 1);
  }
}
