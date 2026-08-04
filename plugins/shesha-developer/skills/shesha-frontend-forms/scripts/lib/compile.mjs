/**
 * compile — mirror-kit JSX spec -> Shesha 0.45 form JSON.
 *
 * A STRUCTURAL TRANSFORM OVER A CLOSED VOCABULARY. There is no judgement here and no
 * design decision: the spec says what to build, the anatomy says its shape, ground truth
 * says what Shesha will honour, and the theme says what colour it is. If this file ever
 * needs a special case for a particular form, the kit is the wrong shape.
 *
 * Every fact comes from ground truth:
 *   component type      dataTypeSupported, the framework's OWN matcher
 *   version             that type's own migrator chain
 *   container slots     customContainerNames
 *   reference lists     live metadata, copied verbatim [R-015]
 *   style channels      only what the component's settings surface exposes [R-053]
 *
 * The spec is EVALUATED, not parsed. esbuild bundles it against a capture shim whose
 * components return plain descriptors, so the real prop tree arrives in Node with no
 * browser and no React. Parsing JSX with a regex would lose exactly the nesting the
 * compiler needs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadAnatomy, loadTheme, resolveStyle, emphasisMap, supportedChannels } from '../gen-kit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const COMPILE_EXIT = { OK: 0, SPEC_INVALID: 6, UNSATISFIABLE: 7 };

export class CompileError extends Error {
  constructor(message, exitCode, detail = null) {
    super(message);
    this.name = 'CompileError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/**
 * nanoid(30), matching the framework's own utils/uuid.ts.
 *
 * getNanoId is not a runtime export, so the alphabet is reproduced rather than imported.
 * It is nanoid's default url alphabet; the LENGTH (30) is the framework's choice and is
 * what matters, because the flat structure is keyed by id and collisions silently
 * overwrite.
 */
const NANOID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
export function nanoid(size = 30) {
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i += 1) out += NANOID_ALPHABET[bytes[i] & 63];
  return out;
}

/**
 * Deterministic ids, for a diffable golden snapshot.
 *
 * A compile that emits fresh random ids every run produces a snapshot that can never be
 * compared, and a re-push that orphans every reference [R-025]. Ids are therefore derived
 * from the form identity plus the node's path in the tree, so the same spec always yields
 * the same ids while two different forms never collide.
 */
export function stableId(seed, path) {
  const h = createHash('sha256').update(`${seed}::${path}`).digest();
  let out = '';
  for (let i = 0; i < 30; i += 1) out += NANOID_ALPHABET[h[i % h.length] & 63];
  return out;
}

/** camelCase the first character of every dotted segment [R-004]. */
export function camelCasePath(name) {
  return String(name)
    .split('.')
    .map((seg) => (seg ? seg[0].toLowerCase() + seg.slice(1) : seg))
    .join('.');
}

/**
 * Evaluate the spec and return its descriptor tree.
 * Runs allowProps, so a forbidden prop fails at compile time exactly as it does at preview.
 */
export async function captureSpec({ specPath, kitDir, nodeModulesDir, tmpDir }) {
  const esbuild = await import('esbuild');
  const spec = resolve(specPath);
  if (!existsSync(spec)) throw new CompileError(`no such spec: ${spec}`, COMPILE_EXIT.SPEC_INVALID);
  if (!existsSync(join(kitDir, 'kit-manifest.json'))) {
    throw new CompileError(`no mirror kit at ${kitDir} — generate it first`, COMPILE_EXIT.UNSATISFIABLE);
  }
  const manifest = JSON.parse(readFileSync(join(kitDir, 'kit-manifest.json'), 'utf8'));

  mkdirSync(tmpDir, { recursive: true });

  // The capture shim: one function per kit component, returning a descriptor. It reuses the
  // kit's OWN __meta and allowProps so the compiler cannot accept a prop preview rejects.
  const shim = [
    `import { allowProps } from ${JSON.stringify(join(kitDir, '_runtime.js').replace(/\\/g, '/'))};`,
    ...manifest.components.map(
      (c) =>
        `import { __meta as m_${c.name} } from ${JSON.stringify(join(kitDir, `${c.name}.jsx`).replace(/\\/g, '/'))};`
    ),
    'const META = {',
    ...manifest.components.map((c) => `  ${c.name}: m_${c.name},`),
    '};',
    'export const __META = META;',
    ...manifest.components.map(
      (c) => `export function ${c.name}(props) { return { __kit: '${c.name}', props: props || {} }; }`
    ),
    `export function h(type, props, ...children) {`,
    `  const name = typeof type === 'function' ? type.name : String(type);`,
    `  const meta = META[name];`,
    `  if (!meta) throw new Error('[compile] <' + name + '> is not a kit component');`,
    `  const p = Object.assign({}, props);`,
    `  delete p.children;`,
    `  allowProps(name, p, meta.allowedProps);`,
    `  const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);`,
    `  return { __kit: name, props: p, children: flat };`,
    `}`,
    `export const Fragment = 'Fragment';`,
    '',
  ].join('\n');
  const shimPath = join(tmpDir, '_capture.mjs');
  writeFileSync(shimPath, shim, 'utf8');

  const entry = join(tmpDir, '_entry.mjs');
  writeFileSync(
    entry,
    [
      `import Spec from ${JSON.stringify(spec.replace(/\\/g, '/'))};`,
      `export const tree = Spec({});`,
      '',
    ].join('\n'),
    'utf8'
  );

  const bundlePath = join(tmpDir, 'captured.mjs');
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      outfile: bundlePath,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      // The spec's JSX becomes h(...) calls against the capture shim, so evaluating the
      // spec yields the prop tree directly.
      jsx: 'transform',
      jsxFactory: 'h',
      jsxFragment: 'Fragment',
      inject: [shimPath],
      alias: { '@shesha-mirror/kit': shimPath },
      nodePaths: nodeModulesDir ? [nodeModulesDir] : [],
      logLevel: 'silent',
      logLimit: 0,
      absWorkingDir: tmpDir,
    });
  } catch (e) {
    const detail = (e && e.errors ? e.errors : []).map((x) => ({
      why: x.text,
      at: x.location ? `${x.location.file}:${x.location.line}:${x.location.column}` : null,
    }));
    throw new CompileError('the spec did not bundle', COMPILE_EXIT.SPEC_INVALID, detail.length ? detail : [{ why: (e && e.message) || String(e) }]);
  }

  let tree;
  try {
    const mod = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
    tree = mod.tree;
  } catch (e) {
    throw new CompileError(
      `the spec threw while being evaluated: ${(e && e.message) || e}`,
      COMPILE_EXIT.SPEC_INVALID,
      [{ why: (e && e.stack) || String(e) }]
    );
  }
  if (!tree || !tree.__kit) {
    throw new CompileError('the spec did not return a kit element', COMPILE_EXIT.SPEC_INVALID);
  }
  return { tree, manifest };
}

/**
 * Resolve the Shesha component type for a bound property.
 *
 * IMPORTANT DESIGN NOTE, arrived at by measurement rather than preference.
 *
 * dataTypeSupported CANNOT select a default control, and pretending otherwise produces
 * absurd results. It is a compatibility filter: most components ignore dataFormat entirely,
 * so several match any given property. Ranking them by how narrow their declared support is
 * picks `slider` for every int32; ranking the other way picks `radio` over `dropdown` for
 * every reference list. The signal that WOULD settle it is the component's toolbox group,
 * and that is not derivable — `IToolboxComponent` has no `group` and neither
 * getToolboxComponents nor useFormDesignerComponentGroups is a runtime export. It is
 * recorded as the `componentGroup` gap in ground truth.
 *
 * So the kit DECLARES the type (Field -> textField, Textarea -> textArea, Select ->
 * dropdown, ...) and the framework's matcher is used for what it is actually for:
 * VALIDATING that the declared type can bind this property. A mismatch is a compile error
 * naming both sides, rather than a silent substitution.
 *
 * Inference survives only as a last resort, and says so in `why`.
 */
export function chooseType(property, registry, { preferred = null } = {}) {
  if (preferred && registry[preferred]) {
    const def = registry[preferred];
    // Validate rather than substitute. dataTypeSupported is the framework's own matcher.
    if (property && property.dataType && def.dataTypeSupported) {
      const key = property.dataFormat ? `${property.dataType}:${property.dataFormat}` : property.dataType;
      const ok = def.dataTypeSupported.includes(key) || def.dataTypeSupported.includes(property.dataType);
      if (!ok) {
        return {
          type: null,
          why: `the kit component compiles to "${preferred}", but the framework's own dataTypeSupported says it cannot bind ${key}`,
          incompatible: true,
          declared: preferred,
        };
      }
    }
    return { type: preferred, why: `declared by the kit component; validated against dataTypeSupported` };
  }
  if (!property) return { type: 'textField', why: 'no metadata available; defaulted to textField' };

  const key = property.dataFormat ? `${property.dataType}:${property.dataFormat}` : property.dataType;
  const matched = [];
  for (const [type, def] of Object.entries(registry)) {
    if (!def.dataTypeSupported) continue;
    if (def.dataTypeSupported.includes(key) || def.dataTypeSupported.includes(property.dataType)) {
      matched.push(type);
    }
  }
  if (matched.length === 0) {
    return { type: null, why: `no registered component declares support for ${key}` };
  }

  /**
   * dataTypeSupported is a FILTER, not a selector: most components ignore dataFormat, so
   * checkbox reports support for boolean:emailAddress and several types match one property.
   * Two derived signals resolve it, in order.
   *
   * 1. AUTHORABLE. A component with no settingsFormMarkup cannot be configured by an
   *    author, so it is designer plumbing rather than a field. This is what separates
   *    textField from dataContextSelector: both declare string:singleline, but only
   *    textField has a settings form. Without this filter the narrowest-wins rule picks
   *    "DataContext selector" for every single-line string on the form.
   * 2. SPECIFICITY. A component naming the exact dataType:dataFormat pair beats one that
   *    accepts the bare dataType, and among equals the narrowest declared surface wins —
   *    which is how string:password resolves to passwordCombo over textField.
   *
   * Both come from the framework. Neither is a list maintained here.
   */
  const authorable = matched.filter((t) => {
    const s = registry[t].settings;
    return s && s.source !== 'absent';
  });
  const excluded = matched.filter((t) => !authorable.includes(t));
  const candidates = authorable.length ? authorable : matched;

  const exact = candidates.filter((t) => registry[t].dataTypeSupported.includes(key));
  const pool = (exact.length ? exact : candidates).slice();
  pool.sort((a, b) => registry[a].dataTypeSupported.length - registry[b].dataTypeSupported.length);

  const why =
    `INFERRED (no kit component declared a type): ${exact.length ? `matched ${key} exactly` : `matched dataType ${property.dataType}`}` +
    `; narrowest authorable of ${pool.length}` +
    (excluded.length ? `; excluded ${excluded.join(', ')} for having no settings form` : '') +
    (authorable.length === 0 ? '; NONE were authorable, so the filter was ignored' : '') +
    (pool.length > 1 ? `; alternatives ${pool.slice(1).join(', ')} — this choice is a heuristic, not a derivation` : '');

  return { type: pool[0], why, inferred: true, alternatives: pool.slice(1), excluded };
}

/** Emit only the style channels this Shesha type can actually carry [R-053]. */
function styleFor(sheshaType, styleSpec, theme, registry, report, label) {
  const support = supportedChannels(sheshaType, registry ? { registry } : { registry: {} });
  const resolved = resolveStyle(styleSpec || {}, theme);
  const desktop = {};

  const put = (channel, value) => {
    if (value === null || value === undefined) return;
    if (support.known && support.channels[channel] === false) {
      report.suppressedChannels.push({ node: label, sheshaType, channel });
      return;
    }
    Object.assign(desktop, value);
  };

  // Layout is always available on a container and is what R-029 requires in the desktop
  // block: without display:"flex" the flex props are silently ignored and children stack.
  const layout = {};
  for (const k of ['display', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'flexWrap']) {
    if (resolved[k] !== undefined && resolved[k] !== null) layout[k] = resolved[k];
  }
  if (Object.keys(layout).length) Object.assign(desktop, layout);

  if (resolved.background) put('background', { background: { type: 'color', color: resolved.background } });

  const borderColor = resolved.border && String(resolved.border).split(' ').pop();
  const accent = resolved.borderLeft && String(resolved.borderLeft).split(' ').pop();
  if (borderColor || accent || resolved.borderRadius !== undefined) {
    const border = { borderType: accent ? 'custom' : 'all', radiusType: 'all', border: {}, radius: {} };
    if (borderColor) border.border.all = { width: 1, style: 'solid', color: borderColor };
    // borderType "custom" is REQUIRED for a per-side border; without it the left accent is
    // dropped and the card reads as a plain white box.
    if (accent) border.border.left = { width: 3, style: 'solid', color: accent };
    if (resolved.borderRadius !== undefined) border.radius.all = resolved.borderRadius;
    put('border', { border });
  }

  const font = {};
  if (resolved.fontSize !== undefined) font.size = resolved.fontSize;
  if (resolved.fontWeight !== undefined) font.weight = String(resolved.fontWeight);
  if (resolved.color !== undefined) font.color = resolved.color;
  if (Object.keys(font).length) put('font', { font });

  return Object.keys(desktop).length ? desktop : null;
}

/** stylingBox is a STRINGIFIED JSON string in 0.45 — stylingBoxJson does not exist. */
function stylingBox(styleSpec, theme) {
  const r = resolveStyle(styleSpec || {}, theme);
  const box = {};
  const map = {
    paddingTop: 'paddingTop',
    paddingBottom: 'paddingBottom',
    paddingLeft: 'paddingLeft',
    paddingRight: 'paddingRight',
    marginTop: 'marginTop',
    marginBottom: 'marginBottom',
  };
  for (const [from, to] of Object.entries(map)) {
    if (r[from] !== undefined && r[from] !== null) box[to] = String(r[from]);
  }
  return Object.keys(box).length ? JSON.stringify(box) : null;
}

/**
 * The transform.
 * Walks the captured descriptor tree and emits Shesha components.
 */
export function transform({ tree, anatomy, theme, groundTruth, formName, modelType, modelProperties, modelTypeRef }) {
  const registry = groundTruth.registry;
  const report = {
    formName,
    theme: theme.name,
    suppressedChannels: [],
    typeChoices: [],
    warnings: [],
    counts: {},
  };
  const seed = `${formName}|${theme.name}`;
  const propIndex = new Map((modelProperties || []).map((p) => [String(p.path).toLowerCase(), p]));

  const versionOf = (type) => {
    const def = registry[type];
    if (!def) throw new CompileError(`type "${type}" is not registered in this app`, COMPILE_EXIT.UNSATISFIABLE);
    return def.lastVersion === null ? undefined : def.lastVersion;
  };

  const mk = (type, path, extra = {}) => {
    const node = { id: stableId(seed, path), type, parentId: null };
    const v = versionOf(type);
    if (v !== undefined) node.version = v;
    return Object.assign(node, extra);
  };

  const bump = (k) => {
    report.counts[k] = (report.counts[k] || 0) + 1;
  };

  /** Emit one descriptor. Returns an array, because some kit nodes expand to several. */
  function emit(desc, path, parentId) {
    if (!desc || !desc.__kit) return [];
    const name = desc.__kit;
    const spec = anatomy.components[name];
    if (!spec) throw new CompileError(`kit component "${name}" has no anatomy entry`, COMPILE_EXIT.UNSATISFIABLE);
    const props = desc.props || {};
    const kids = desc.children || [];
    bump(name);

    // ---- Column: not a component; a datatable items[] entry ------------------------
    if (name === 'Column') return [];

    // ---- Tab: not a component; a tabs[] entry --------------------------------------
    if (name === 'Tab') return [];

    const commonStyle = () => {
      const d = styleFor(spec.sheshaType, spec.style, theme, registry, report, `${name}@${path}`);
      const sb = stylingBox(spec.style, theme);
      const out = {};
      if (d) out.desktop = d;
      if (sb) out.stylingBox = sb;
      return out;
    };

    // ---- Text-ish -------------------------------------------------------------------
    if (['MicroLabel', 'SectionLabel', 'Text', 'Badge', 'CountBadge', 'Fact'].includes(name)) {
      const roleStyle = name === 'Text' && spec.roles ? spec.roles[props.role || 'body'] : null;
      const merged = { ...spec.style, ...(roleStyle || {}) };
      const node = mk(spec.sheshaType, path, {
        componentName: `${name.toLowerCase()}${path.replace(/\W/g, '')}`.slice(0, 40),
        parentId,
        // contentType "custom" is forced: a text component's font colour renders ONLY with
        // it, and otherwise antd presets win and the colour is a pure no-op [R-052].
        contentType: 'custom',
        content: typeof props.children === 'string' ? props.children : props.value ?? props.label ?? '',
      });
      const d = styleFor(spec.sheshaType, merged, theme, registry, report, `${name}@${path}`);
      if (d) node.desktop = d;
      const sb = stylingBox(merged, theme);
      if (sb) node.stylingBox = sb;
      if (name === 'MicroLabel' || name === 'SectionLabel') {
        node.desktop = node.desktop || {};
        node.desktop.font = node.desktop.font || {};
        // The uppercase micro-label: 11px/600/.04em. 153 instances in the reference corpus
        // and zero in the current Shesha output.
        node.desktop.font.size = theme.microLabel.size;
        node.desktop.font.weight = String(theme.microLabel.weight);
        node.desktop.font.color = theme.microLabel.color;
      }
      return [node];
    }

    // ---- StatCard --------------------------------------------------------------------
    if (name === 'StatCard') {
      const E = emphasisMap(theme)[props.emphasis || 'default'];
      const cardStyle = { ...spec.style, borderLeft: `3px solid ${E.accent}` };
      const card = mk('card', path, { componentName: `stat${path.replace(/\W/g, '')}`.slice(0, 40), parentId });
      const d = styleFor('card', cardStyle, theme, registry, report, `StatCard@${path}`);
      if (d) card.desktop = d;
      const sb = stylingBox(cardStyle, theme);
      if (sb) card.stylingBox = sb;

      const contentId = stableId(seed, `${path}/content`);
      const label = mk('text', `${path}/label`, {
        componentName: `statLabel${path.replace(/\W/g, '')}`.slice(0, 40),
        parentId: contentId,
        contentType: 'custom',
        content: props.label || '',
        desktop: {
          font: {
            size: theme.microLabel.size,
            weight: String(theme.microLabel.weight),
            color: theme.ink.soft,
          },
        },
      });
      const value = mk('text', `${path}/value`, {
        componentName: `statValue${path.replace(/\W/g, '')}`.slice(0, 40),
        parentId: contentId,
        contentType: 'custom',
        content: props.value !== undefined ? String(props.value) : props.bind ? `{{${camelCasePath(props.bind)}}}` : '',
        desktop: { font: { size: theme.type.kpiNumeral, weight: String(theme.type.weights.emphasis), color: theme.ink.default } },
      });
      const parts = [label, value];
      if (props.caption) {
        parts.push(
          mk('text', `${path}/caption`, {
            componentName: `statCaption${path.replace(/\W/g, '')}`.slice(0, 40),
            parentId: contentId,
            contentType: 'custom',
            content: props.caption,
            desktop: { font: { size: 12, color: theme.ink.soft } },
          })
        );
      }
      // card slots come from customContainerNames, which for card is ["header","content"].
      card.header = { id: stableId(seed, `${path}/header`), components: [] };
      card.content = { id: contentId, components: parts };
      return [card];
    }

    // ---- Containers ------------------------------------------------------------------
    const CONTAINERS = ['Page', 'PageHeader', 'Row', 'Stack', 'KeyInfoBar', 'KeyFactsStrip', 'ActionRow', 'EmptyState', 'Modal'];
    if (CONTAINERS.includes(name)) {
      const node = mk('container', path, {
        componentName: name === 'Page' ? 'pageRoot' : `${name[0].toLowerCase()}${name.slice(1)}${path.replace(/\W/g, '')}`.slice(0, 40),
        parentId,
        ...commonStyle(),
      });
      // R-029: a flex container must declare display in the desktop block or the flex props
      // are inert and children stack full-width.
      node.desktop = node.desktop || {};
      if (spec.style && (spec.style.display === 'flex' || spec.style.display === 'grid')) {
        node.desktop.display = 'flex';
        if (spec.style.flexDirection) node.desktop.flexDirection = spec.style.flexDirection;
        if (spec.style.display === 'grid') node.desktop.flexDirection = 'row';
      }
      if (props.justify) {
        node.desktop.display = 'flex';
        node.desktop.justifyContent = { start: 'flex-start', end: 'flex-end', between: 'space-between', center: 'center' }[props.justify] || props.justify;
      }
      if (props.gap !== undefined) node.desktop.gap = String(props.gap);
      if (Object.keys(node.desktop).length === 0) delete node.desktop;

      const children = [];
      // PageHeader carries its title/subtitle as props, so they become real text nodes.
      if (name === 'PageHeader') {
        if (props.title) {
          children.push(
            mk('text', `${path}/title`, {
              componentName: 'pageTitle',
              parentId: node.id,
              contentType: 'custom',
              content: props.title,
              desktop: { font: { size: theme.type.pageH1, weight: String(theme.type.weights.emphasis), color: theme.ink.default } },
            })
          );
        }
        if (props.subtitle) {
          children.push(
            mk('text', `${path}/subtitle`, {
              componentName: 'pageSubtitle',
              parentId: node.id,
              contentType: 'custom',
              content: props.subtitle,
              desktop: { font: { size: theme.type.body, color: theme.ink.muted } },
            })
          );
        }
      }
      kids.forEach((k, i) => children.push(...emit(k, `${path}/${i}`, node.id)));
      node.components = children;
      return [node];
    }

    // ---- Card ------------------------------------------------------------------------
    if (name === 'Card') {
      const node = mk('card', path, { componentName: `card${path.replace(/\W/g, '')}`.slice(0, 40), parentId, ...commonStyle() });
      const headerId = stableId(seed, `${path}/header`);
      const contentId = stableId(seed, `${path}/content`);
      const header = [];
      if (props.title) {
        header.push(
          mk('text', `${path}/title`, {
            componentName: `cardTitle${path.replace(/\W/g, '')}`.slice(0, 40),
            parentId: headerId,
            contentType: 'custom',
            content: props.title,
            // THE SECTION BAND title: 15px/600 in the brand primary. 52 occurrences in the
            // corpus; the shipped PBF form leaves this slot empty.
            desktop: { font: { size: theme.type.cardTitle, weight: String(theme.type.weights.emphasis), color: theme.brand.primary } },
          })
        );
      }
      if (props.meta) {
        header.push(
          mk('text', `${path}/meta`, {
            componentName: `cardMeta${path.replace(/\W/g, '')}`.slice(0, 40),
            parentId: headerId,
            contentType: 'custom',
            content: String(props.meta),
            desktop: { font: { size: 12, color: theme.ink.soft } },
          })
        );
      }
      const content = [];
      kids.forEach((k, i) => content.push(...emit(k, `${path}/${i}`, contentId)));
      node.header = { id: headerId, components: header };
      node.content = { id: contentId, components: content };
      return [node];
    }

    // ---- DataTable -------------------------------------------------------------------
    if (name === 'DataTable') {
      const entity = props.entity || modelType || null;
      if (!entity) {
        throw new CompileError(
          'DataTable needs an entity: put it on <DataTable entity="..."> or <Page entity="...">',
          COMPILE_EXIT.UNSATISFIABLE
        );
      }
      // R-005: the wrapper is required and carries an explicit entityType string; it does
      // not inherit formSettings.modelType and a bare table 500s on page load.
      const ctxId = stableId(seed, `${path}/ctx`);
      const ctx = mk('datatableContext', `${path}/ctx`, {
        componentName: `${formName.replace(/\W/g, '')}Ctx`.slice(0, 40),
        propertyName: `${formName.replace(/\W/g, '')}Ctx`.slice(0, 40),
        parentId,
        entityType: entity,
        sourceType: 'Entity',
        dataFetchingMode: 'paging',
        defaultPageSize: props.pageSize || 10,
      });
      ctx.id = ctxId;

      const columns = kids.filter((k) => k && k.__kit === 'Column');
      const items = columns.map((col, i) => {
        const bind = camelCasePath(col.props.bind);
        const meta = propIndex.get(bind.toLowerCase()) || propIndex.get(bind.split('.')[0].toLowerCase());
        if (!meta && propIndex.size) {
          report.warnings.push(`column "${bind}" is not a property of ${modelType} — the cell will render blank [R-034]`);
        }
        /**
         * A StatusPill inside a Column does NOT compile to a pill in v1.0.
         *
         * Status pills are out of v1.0 by scope decision: v1.0 is pure configuration, with
         * no React and no install step in the target app. A reference-list column renders
         * the item's LABEL, not a chip. Saying so is the point — silently dropping the
         * StatusPill would leave the spec author believing they had pills.
         *
         * The cheap v1.1 path is not a custom renderer: Shesha's own refListStatus paints a
         * chip from the reference-list item's OWN colour [R-036], so seeding those colours
         * buys real pills with zero React wherever the bound property is a reflist.
         */
        const pill = (col.children || []).find((c) => c && c.__kit === 'StatusPill');
        if (pill) {
          report.warnings.push(
            `column "${bind}" declares a <StatusPill>, which v1.0 does not compile — status pills are out of scope for a pure-configuration release. ` +
              `The column renders the reference-list label instead. For real pills without React, seed the reference list's item colours [R-036].`
          );
          report.deferred = report.deferred || [];
          report.deferred.push({ feature: 'StatusPill', at: `column ${bind}`, plannedFor: 'v1.1', rule: 'R-036' });
        }
        const width = col.props.width && col.props.width !== 'fill' ? parseInt(col.props.width, 10) : null;
        return {
          id: stableId(seed, `${path}/col/${i}`),
          itemType: 'item',
          sortOrder: i,
          caption: col.props.caption || bind,
          columnType: 'data',
          isVisible: true,
          chosen: false,
          selected: false,
          propertyName: bind,
          description: null,
          // Pinned widths: unpinned columns make Ant distribute evenly and the table reads
          // as uniform grey.
          minWidth: width,
          maxWidth: width,
          allowSorting: col.props.sortable !== false,
          defaultSorting: null,
        };
      });

      const table = mk('datatable', path, {
        componentName: `${formName.replace(/\W/g, '')}Table`.slice(0, 40),
        propertyName: `${formName.replace(/\W/g, '')}Table`.slice(0, 40),
        parentId: ctxId,
        items,
        flexibleHeight: props.flexibleHeight !== false,
        useMultiselect: false,
        crud: false,
        canEditInline: 'no',
        canAddInline: 'no',
        canDeleteInline: 'no',
      });
      ctx.components = [table];
      return [ctx];
    }

    // ---- ButtonGroup -----------------------------------------------------------------
    if (name === 'ButtonGroup') {
      const buttons = kids.filter((k) => k && k.__kit === 'Button');
      const node = mk('buttonGroup', path, {
        componentName: `actions${path.replace(/\W/g, '')}`.slice(0, 40),
        parentId,
        // R-057: without isInline the whole group collapses to an overflow "..." menu.
        isInline: true,
        items: buttons.map((b, i) => {
          const variant = b.props.variant || 'secondary';
          const item = {
            id: stableId(seed, `${path}/btn/${i}`),
            itemType: 'item',
            sortOrder: i,
            itemSubType: 'button',
            name: `btn${i}`,
            label: typeof b.props.children === 'string' ? b.props.children : b.props.action || 'Action',
            buttonType: variant === 'primary' ? 'primary' : 'default',
            actionConfiguration: actionFor(b.props, stableId(seed, `${path}/ctxref`)),
          };
          return item;
        }),
      });
      return [node];
    }

    // ---- Button on its own -----------------------------------------------------------
    if (name === 'Button') {
      report.warnings.push(
        `a standalone <Button> at ${path} was wrapped in a buttonGroup: form actions live in one group [R-007]`
      );
      return emit({ __kit: 'ButtonGroup', props: {}, children: [desc] }, path, parentId);
    }

    // ---- Inputs ----------------------------------------------------------------------
    if (['Field', 'Select', 'Textarea', 'Checkbox', 'Switch', 'SegmentedControl', 'NumberField', 'DatePicker'].includes(name)) {
      const bind = camelCasePath(props.bind);
      const meta = propIndex.get(bind.toLowerCase());
      if (!meta && propIndex.size) {
        throw new CompileError(
          `<${name} bind="${props.bind}"> is not a property of ${modelType}. A bound value renders only when propertyName is a real entity property [R-034].`,
          COMPILE_EXIT.UNSATISFIABLE
        );
      }
      const declared = spec.sheshaType.startsWith('__') ? null : spec.sheshaType;
      const chosen = chooseType(meta, registry, { preferred: declared });
      if (!chosen.type) {
        throw new CompileError(`no component can bind ${meta && meta.dataType}: ${chosen.why}`, COMPILE_EXIT.UNSATISFIABLE);
      }
      report.typeChoices.push({ bind, dataType: meta && meta.dataType, dataFormat: meta && meta.dataFormat, chose: chosen.type, why: chosen.why });

      const node = mk(chosen.type, path, {
        componentName: bind.replace(/\./g, '_'),
        propertyName: bind,
        parentId,
        label: props.label,
        editMode: props.readOnly ? 'readOnly' : 'editable',
        hideLabel: false,
      });
      if (props.required) node.validate = { required: true };
      // R-015: reference-list identity is copied VERBATIM from the property metadata.
      // Deriving it from the property name renders a silently EMPTY dropdown.
      if (meta && meta.referenceListName) {
        node.referenceListId = { module: meta.referenceListModule || null, name: meta.referenceListName };
        node.dataSourceType = 'referenceList';
      }
      if (props.width && props.width !== 'fill') {
        node.desktop = { dimensions: { width: props.width } };
      }
      return [node];
    }

    // ---- StatusPill ------------------------------------------------------------------
    if (name === 'StatusPill') {
      const bind = props.bind ? camelCasePath(props.bind) : null;
      const meta = bind ? propIndex.get(bind.toLowerCase()) : null;
      const node = mk('refListStatus', path, {
        componentName: `status${path.replace(/\W/g, '')}`.slice(0, 40),
        propertyName: bind || undefined,
        parentId,
        desktop: { border: { borderType: 'all', radiusType: 'all', radius: { all: theme.statusPill.radius } } },
      });
      if (meta && meta.referenceListName) {
        node.referenceListId = { module: meta.referenceListModule || null, name: meta.referenceListName };
      }
      // R-036: the fill comes ONLY from the reference-list item's own colour.
      report.warnings.push(
        `refListStatus at ${path} renders grey unless the reference list's items carry their own colour [R-036]`
      );
      return [node];
    }

    // ---- Tabs ------------------------------------------------------------------------
    if (name === 'Tabs') {
      const tabs = kids.filter((k) => k && k.__kit === 'Tab');
      const node = mk('tabs', path, { componentName: `tabs${path.replace(/\W/g, '')}`.slice(0, 40), parentId, ...commonStyle() });
      node.tabs = tabs.map((t, i) => {
        const tabId = stableId(seed, `${path}/tab/${i}`);
        const comps = [];
        (t.children || []).forEach((k, j) => comps.push(...emit(k, `${path}/tab/${i}/${j}`, tabId)));
        return { id: tabId, key: String(i + 1), title: t.props.title, components: comps };
      });
      return [node];
    }

    // ---- Everything else: a plain typed component with its style ---------------------
    const node = mk(spec.sheshaType, path, {
      componentName: `${name[0].toLowerCase()}${name.slice(1)}${path.replace(/\W/g, '')}`.slice(0, 40),
      parentId,
      ...commonStyle(),
    });
    if (props.children && typeof props.children === 'string') node.content = props.children;
    if (kids.length) {
      const inner = [];
      kids.forEach((k, i) => inner.push(...emit(k, `${path}/${i}`, node.id)));
      if (inner.length) node.components = inner;
    }
    return [node];
  }

  function actionFor(props, ctxId) {
    const action = props.action;
    if (action === 'submit') return { actionName: 'Submit', actionOwner: 'shesha.form', handleSuccess: false, handleFail: false };
    if (action === 'refresh') {
      // R-044: a refresh targets the dataContext component by id; there is no owner "table".
      return { actionName: 'Refresh table', actionOwner: ctxId, handleSuccess: false, handleFail: false };
    }
    if (action === 'navigate' || action === 'cancel') {
      return {
        actionName: 'Navigate',
        actionOwner: 'shesha.common',
        actionArguments: { target: props.target || '/' },
        handleSuccess: false,
        handleFail: false,
      };
    }
    if (action === 'add') {
      return {
        actionName: 'Show Dialog',
        actionOwner: 'shesha.common',
        actionArguments: { modalTitle: 'New', showModalFooter: true, formMode: 'edit' },
        handleSuccess: false,
        handleFail: false,
      };
    }
    return { actionName: 'Execute Script', actionOwner: 'shesha.common', actionArguments: { expression: 'return true;' }, handleSuccess: false, handleFail: false };
  }

  const roots = emit(tree, 'r', 'root');
  for (const r of roots) r.parentId = 'root';

  // R-006: a validationErrors component is required whenever anything is required, or a
  // failed submit renders nothing at all. The compiler inserts it so a spec author does not
  // have to remember.
  const anyRequired = JSON.stringify(roots).includes('"required":true');
  if (anyRequired && !JSON.stringify(roots).includes('"validationErrors"')) {
    const root = roots[0];
    if (root && Array.isArray(root.components)) {
      root.components.push(
        mk('validationErrors', 'r/validation', { componentName: 'validationErrors', parentId: root.id })
      );
      bump('ValidationSummary');
    }
  }

  const formSettings = {
    layout: 'vertical',
    colon: false,
    labelCol: { span: 0 },
    wrapperCol: { span: 24 },
    /**
     * The runtime form-settings migration chain ends at .add(8). Stamping 8 avoids replaying
     * it, matching R-003's logic for components.
     *
     * NOTE the typings declare version?: -1 | 1 | null | undefined, so 8 violates the
     * declared type — a 0.45 typing bug already recorded in ground-truth.gaps. It is not
     * load-bearing either way here: migration 8 only FILLS absent layout/labelCol/wrapperCol
     * via ??, and the compiler sets all three explicitly, so every migration is a no-op.
     */
    version: 8,
    access: 3,
    dataLoaderType: 'gql',
    dataSubmitterType: 'none',
    dataLoadersSettings: { gql: { endpointType: 'default' } },
    dataSubmittersSettings: { gql: { endpointType: 'default' } },
  };
  /**
   * formSettings.modelType is the {name, module} OBJECT resolved from live EntityConfig,
   * while dataContext.entityType stays the fullClassName STRING [R-016]. Conflating them
   * 500s at runtime. The object is DERIVED from the entity list, never split off the class
   * name by string surgery — the last dotted segment is not reliably the entity name and
   * the module is not derivable from the namespace at all.
   */
  if (modelTypeRef) {
    formSettings.modelType = modelTypeRef;
  } else if (modelType) {
    formSettings.modelType = modelType;
    report.warnings.push(
      `formSettings.modelType was left as the string "${modelType}" because no EntityConfig entry matched it — 0.45 expects {name, module} [R-016]`
    );
  }

  return { markup: { formSettings, components: roots }, report };
}

/** Full pipeline: capture -> transform. */
export async function compileSpec({ specPath, kitDir, nodeModulesDir, groundTruth, themeName, formName, tmpDir, keepTmp = false }) {
  const anatomy = loadAnatomy();
  const theme = loadTheme(themeName);
  const { tree } = await captureSpec({ specPath, kitDir, nodeModulesDir, tmpDir });

  // The archetype is required so the stock-config-form fallback has nowhere to hide.
  if (tree.__kit !== 'Page') {
    throw new CompileError('a spec must return a <Page> at its root', COMPILE_EXIT.SPEC_INVALID);
  }
  if (!tree.props.archetype) {
    throw new CompileError('<Page> requires an archetype', COMPILE_EXIT.SPEC_INVALID);
  }
  const known = Object.keys(anatomy.archetypes);
  if (!known.includes(tree.props.archetype)) {
    throw new CompileError(
      `archetype "${tree.props.archetype}" is not implemented. Available: ${known.join(', ')}`,
      COMPILE_EXIT.UNSATISFIABLE
    );
  }

  const modelType = tree.props.entity || null;
  let modelProperties = null;
  let modelTypeRef = null;
  if (modelType && groundTruth.backend && groundTruth.backend.reachable) {
    const md = groundTruth.backend.metadata[modelType];
    if (md && !md.error) modelProperties = md.properties;
    // Resolve the {name, module} pair from the authoritative entity list.
    const ent = (groundTruth.backend.entities || []).find((e) => e.fullClassName === modelType);
    if (ent && ent.name && ent.module) modelTypeRef = { name: ent.name, module: ent.module };
  }

  const out = transform({ tree, anatomy, theme, groundTruth, formName, modelType, modelProperties, modelTypeRef });
  out.report.archetype = tree.props.archetype;
  out.report.modelType = modelType;
  out.report.metadataAvailable = !!modelProperties;
  if (!modelProperties && modelType) {
    out.report.warnings.push(
      `no live metadata for ${modelType}, so bindings were NOT verified — run probe against a reachable backend [R-034]`
    );
  }
  if (!keepTmp) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* a leftover temp dir is not worth failing a compile over */
    }
  }
  return out;
}
