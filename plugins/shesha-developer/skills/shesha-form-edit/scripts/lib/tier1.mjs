import { flatten, CHILD_KEYS } from './walk.mjs';

/**
 * Tier 1 — renderability checks.
 *
 * Every check here corresponds to a real render-crash signature observed in
 * telemetry (e.g. `e.match is not a function`, `Cannot read properties of
 * undefined (reading 'migrator'/'version')`). These are hard fails: markup
 * that trips one of these WILL crash or silently misbehave in the Shesha
 * renderer, so every finding is `severity: 'fail'`.
 *
 * @param {object} markup - A form's markup object ({ components: [...] , ... }).
 * @param {{registry: object}} opts - The component registry (assets/registry/registry-*.json).
 * @returns {Finding[]}
 */
export function tier1(markup, { registry }) {
  const out = [];
  const components = Array.isArray(markup?.components) ? markup.components : [];
  const entries = flatten(components);

  for (const { node, ctx } of entries) {
    const comp = registry.components[node.type];

    checkTypeUnknown(node, ctx, registry, out);
    if (comp) {
      checkPropUnknown(node, ctx, comp, out);
      checkVersion(node, ctx, comp, out);
    }
    checkIdNotUuid(node, ctx, out);
    checkParentMissing(node, ctx, out);
    checkDefaultValueNonString(node, ctx, out);
    checkEditComponentShape(node, ctx, out);
    checkDoubleSlot(node, ctx, out);
    checkScriptSyntax(node, ctx, out);
    checkJsonUnsafe(node, ctx, out);
  }

  checkIdDuplicate(entries, out);

  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function finding(code, path, message, expected, actual) {
  return { tier: 1, code, severity: 'fail', path, message, expected, actual };
}

const STRUCTURAL_KEYS = new Set(CHILD_KEYS);

// Base wire-format fields that exist on (almost) every component regardless
// of type and are NOT tracked as per-type "props" in the registry. Verified
// empirically: none of the 116 registry entries declare these, yet all of
// them appear routinely on real markup nodes (id/type/parentId/version are
// framework plumbing; componentName/label/labelAlign/isDynamic/defaultValue
// etc. are base component-model fields the registry's prop scraper doesn't
// capture because they're not "settings").
const UNIVERSAL_KEYS = new Set([
  'id', 'type', 'parentId', 'version', 'componentName', 'name', 'label', 'labelAlign',
  'isDynamic', 'hidden', 'editMode', 'hideLabel', 'propertyName', 'description',
  'customVisibility', 'customEnabled', 'settingsValidationErrors', 'jsSetting',
  'tooltip', 'visibility', 'permissions', 'size', 'defaultValue',
]);

const BREAKPOINT_KEYS = new Set(['desktop', 'tablet', 'mobile']);

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// T1-TYPE-UNKNOWN
// ---------------------------------------------------------------------------

function checkTypeUnknown(node, ctx, registry, out) {
  if (!registry.components[node.type]) {
    const known = Object.keys(registry.components).length;
    out.push(finding(
      'T1-TYPE-UNKNOWN',
      ctx.path,
      `Component type "${node.type}" is not one of the ${known} known types in the registry — an unknown type renders nothing.`,
      'a type key present in registry.components',
      node.type,
    ));
  }
}

// ---------------------------------------------------------------------------
// T1-PROP-UNKNOWN
//
// Reconciliation of dotted/breakpoint-nested prop paths (see report):
// the registry's `props` array lists paths that are (a) dotted for nested
// style settings (e.g. `border.border.all.color`, `dimensions.width`) and
// (b) breakpoint-RELATIVE — real markup nests the same style keys one level
// deeper under `desktop`/`tablet`/`mobile`. We flatten each node's own
// (non-structural, non-universal) keys into dotted leaf paths, treating
// `desktop`/`tablet`/`mobile` wrappers as transparent (their contents are
// flattened WITHOUT a breakpoint prefix, so `desktop.border.border.all.color`
// reduces to `border.border.all.color` and is checked exactly like a
// non-breakpointed value). A path is "known" if it, or any ancestor prefix
// of it, is declared in the type's props — this handles both fully
// decomposed style props (border.border.all.color) and props the registry
// declares as a single opaque object name (e.g. `referenceListId`, whose
// real value is `{ module, name }`, decomposed by us into
// `referenceListId.module`/`referenceListId.name` but matched against the
// ancestor `referenceListId`).
// ---------------------------------------------------------------------------

function collectOwnPropPaths(node) {
  const paths = new Set();

  function visit(obj, prefix) {
    for (const key of Object.keys(obj)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      if (!prefix && UNIVERSAL_KEYS.has(key)) continue;

      const value = obj[key];

      if (!prefix && BREAKPOINT_KEYS.has(key) && isPlainObject(value)) {
        // Breakpoint wrappers are transparent: recurse without prefixing.
        visit(value, '');
        continue;
      }

      const path = prefix ? `${prefix}.${key}` : key;

      if (isPlainObject(value)) {
        visit(value, path);
      } else {
        // Leaf value (string, number, boolean, null, array) — this is what
        // gets checked against the registry's prop paths.
        paths.add(path);
      }
    }
  }

  visit(node, '');
  return paths;
}

function isKnownProp(path, validProps) {
  const parts = path.split('.');
  for (let i = parts.length; i >= 1; i--) {
    if (validProps.has(parts.slice(0, i).join('.'))) return true;
  }
  return false;
}

function checkPropUnknown(node, ctx, comp, out) {
  const validProps = new Set(comp.props);
  const paths = collectOwnPropPaths(node);
  for (const path of paths) {
    if (!isKnownProp(path, validProps)) {
      out.push(finding(
        'T1-PROP-UNKNOWN',
        ctx.path,
        `Property "${path}" is not a recognized setting for type "${node.type}" — unknown props are stripped at render time, so the setting silently does nothing.`,
        `a prop declared for "${node.type}" (e.g. ${comp.props.slice(0, 3).join(', ')}${comp.props.length > 3 ? ', …' : ''})`,
        path,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T1-VERSION-MISSING / T1-VERSION-STALE
// ---------------------------------------------------------------------------

function checkVersion(node, ctx, comp, out) {
  // version: null means the type genuinely has no migrator (e.g. dataContext).
  // Test `=== null`, never falsiness — validationErrors has a real version: 0.
  if (comp.version === null) return;

  if (!Number.isInteger(node.version)) {
    out.push(finding(
      'T1-VERSION-MISSING',
      ctx.path,
      `Component "${node.type}" has no integer version (got ${JSON.stringify(node.version)}) — an absent version is treated as -1, re-running the entire legacy migration chain and throwing at render time.`,
      `an integer version (registry says "${node.type}" is at ${comp.version})`,
      node.version,
    ));
    return;
  }

  if (node.version !== comp.version) {
    out.push(finding(
      'T1-VERSION-STALE',
      ctx.path,
      `Component "${node.type}" version ${node.version} is stale — registry says "${node.type}" is at ${comp.version}. A stale version can silently drop the component's whole style block.`,
      comp.version,
      node.version,
    ));
  }
}

// ---------------------------------------------------------------------------
// T1-ID-NOT-UUID
// ---------------------------------------------------------------------------

function checkIdNotUuid(node, ctx, out) {
  if (typeof node.id !== 'string' || !UUID_V4_RE.test(node.id)) {
    out.push(finding(
      'T1-ID-NOT-UUID',
      ctx.path,
      `Component id "${node.id}" is not a v4 UUID — the renderer ignores components with non-UUID ids, blanking the form.`,
      'a v4-shaped UUID (e.g. xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)',
      node.id,
    ));
  }
}

// ---------------------------------------------------------------------------
// T1-ID-DUPLICATE
// ---------------------------------------------------------------------------

function checkIdDuplicate(entries, out) {
  const byId = new Map();
  for (const { node, ctx } of entries) {
    if (typeof node.id !== 'string') continue;
    if (!byId.has(node.id)) byId.set(node.id, []);
    byId.get(node.id).push(ctx.path);
  }
  for (const [id, paths] of byId) {
    if (paths.length > 1) {
      // Flag every occurrence after the first — the first is the "original".
      for (let i = 1; i < paths.length; i++) {
        out.push(finding(
          'T1-ID-DUPLICATE',
          paths[i],
          `Id "${id}" is reused at ${paths[i]} — it also appears at ${paths[0]}. The renderer keys by id: one copy renders twice, the other vanishes.`,
          'a unique id tree-wide',
          id,
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T1-PARENT-MISSING
// ---------------------------------------------------------------------------

function checkParentMissing(node, ctx, out) {
  const expected = ctx.parent ? ctx.parent.id : 'root';
  if (node.parentId == null || node.parentId !== expected) {
    out.push(finding(
      'T1-PARENT-MISSING',
      ctx.path,
      `Component "${node.type}" has parentId ${JSON.stringify(node.parentId)}, which does not resolve to its containing ancestor — missing/incorrect parentId crashes the renderer with no useful error.`,
      expected,
      node.parentId ?? null,
    ));
  }
}

// ---------------------------------------------------------------------------
// T1-DEFAULTVALUE-NONSTRING
// ---------------------------------------------------------------------------

function checkDefaultValueNonString(node, ctx, out) {
  if ('defaultValue' in node && node.defaultValue !== undefined && typeof node.defaultValue !== 'string') {
    out.push(finding(
      'T1-DEFAULTVALUE-NONSTRING',
      ctx.path,
      `defaultValue on "${node.type}" is ${Array.isArray(node.defaultValue) ? 'an array' : typeof node.defaultValue} (${JSON.stringify(node.defaultValue)}), not a string — the resolver calls .match() on it, so a literal array/number/object throws.`,
      'a string (a literal or a {{mustache}} expression)',
      node.defaultValue,
    ));
  }
}

// ---------------------------------------------------------------------------
// T1-EDITCOMPONENT-SHAPE
// ---------------------------------------------------------------------------

function isValidEditComponentShape(value) {
  if (!isPlainObject(value) || typeof value.type !== 'string' || value.type.length === 0) return false;
  if (value.type === '[not-editable]') return true;
  if (value.type === '[default]') return false;
  return isPlainObject(value.settings);
}

function checkEditComponentShape(node, ctx, out) {
  if (!Array.isArray(node.items)) return;

  node.items.forEach((item, idx) => {
    if (!isPlainObject(item)) return;
    for (const slot of ['editComponent', 'createComponent']) {
      if (!(slot in item)) continue;
      const value = item[slot];
      if (!isValidEditComponentShape(value)) {
        const path = `${ctx.path}.items[${idx}].${slot}`;
        const reason = isPlainObject(value) && value.type === '[default]'
          ? '"[default]" is not a valid edit/create shape (crashes with "reading \'migrator\'")'
          : isPlainObject(value) && typeof value.type === 'string' && !isPlainObject(value.settings)
            ? 'a flat model with no "settings" wrapper crashes with "reading \'version\'"'
            : 'shape is neither "[not-editable]" nor { type, settings }';
        out.push(finding(
          'T1-EDITCOMPONENT-SHAPE',
          path,
          `Column "${item.propertyName ?? idx}" ${slot} is ${JSON.stringify(value)} — ${reason}.`,
          '{ "type": "[not-editable]" } or { "type": "<editorType>", "settings": { …full model… } }',
          value,
        ));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// T1-DOUBLE-SLOT
// ---------------------------------------------------------------------------

const DOUBLE_SLOT_TYPES = new Set(['card', 'collapsiblePanel']);

function checkDoubleSlot(node, ctx, out) {
  if (!DOUBLE_SLOT_TYPES.has(node.type)) return;
  const contentChildren = Array.isArray(node.content?.components) ? node.content.components : [];
  const directChildren = Array.isArray(node.components) ? node.components : [];
  if (contentChildren.length > 0 && directChildren.length > 0) {
    out.push(finding(
      'T1-DOUBLE-SLOT',
      ctx.path,
      `"${node.type}" has ${contentChildren.length} child(ren) in content.components AND ${directChildren.length} in components[] — it renders its body twice, often with colliding ids.`,
      'children in exactly one of content.components or components[]',
      { contentCount: contentChildren.length, componentsCount: directChildren.length },
    ));
  }
}

// ---------------------------------------------------------------------------
// T1-SCRIPT-SYNTAX / T1-JSON-UNSAFE
//
// Both checks scan the same set of "script-shaped" and "endpoint-shaped"
// string fields, found by key NAME anywhere in the node's own subtree
// (stopping at structural/child boundaries — we never descend into a
// child component's own tree here, that happens on its own visit).
// ---------------------------------------------------------------------------

const SCRIPT_KEY_NAMES = new Set([
  'onBlurCustom', 'onChangeCustom', 'onFocusCustom', 'onClickCustom', 'onCustomSubmit',
  'customVisibility', 'customEnabled', 'customValidate',
  'onPrepareSubmitData', 'onBeforeDataLoad', 'onDataLoaded',
  'onCreated', 'onUpdated', 'onBeforeRowReorder', 'onAfterRowReorder',
  'expression', 'filterValueExpression', 'validator',
]);

const ENDPOINT_KEY_NAMES = new Set([
  'endpoint', 'customCreateUrl', 'customUpdateUrl', 'customDeleteUrl', 'customUrl', 'apiEndpoint',
]);

function collectStringFieldsByName(node, names) {
  const found = [];

  function visit(obj, path) {
    if (!isPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      const value = obj[key];
      const path2 = path ? `${path}.${key}` : key;

      if (typeof value === 'string') {
        if (names.has(key)) found.push({ path: path2, key, value });
      } else if (isPlainObject(value)) {
        visit(value, path2);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          const path3 = `${path2}[${i}]`;
          if (typeof v === 'string' && names.has(key)) found.push({ path: path3, key, value: v });
          else if (isPlainObject(v)) visit(v, path3);
        });
      }
    }
  }

  visit(node, '');
  return found;
}

function checkScriptSyntax(node, ctx, out) {
  for (const { path, key, value } of collectStringFieldsByName(node, SCRIPT_KEY_NAMES)) {
    if (!value.trim()) continue;
    try {
      // eslint-disable-next-line no-new-func
      new Function(value);
    } catch (err) {
      out.push(finding(
        'T1-SCRIPT-SYNTAX',
        `${ctx.path}.${path}`,
        `Script "${key}" on "${node.type}" does not parse as JavaScript (${err.message}) — a broken script string produces a JSON parse error in the browser.`,
        'syntactically valid JavaScript',
        value,
      ));
    }
  }
}

function checkJsonUnsafe(node, ctx, out) {
  const names = new Set([...SCRIPT_KEY_NAMES, ...ENDPOINT_KEY_NAMES]);
  for (const { path, key, value } of collectStringFieldsByName(node, names)) {
    const hasTemplateLiteral = value.includes('`');
    const hasRawNewline = value.includes('\n') || value.includes('\r');
    if (hasTemplateLiteral || hasRawNewline) {
      const problem = hasTemplateLiteral && hasRawNewline
        ? 'a template literal and a raw newline'
        : hasTemplateLiteral ? 'a template literal (backtick string)' : 'a raw newline';
      out.push(finding(
        'T1-JSON-UNSAFE',
        `${ctx.path}.${path}`,
        `Field "${key}" on "${node.type}" contains ${problem} — this breaks the outer JSON.stringify on push.`,
        'no backtick characters and no raw newlines (escape as \\n)',
        value,
      ));
    }
  }
}
