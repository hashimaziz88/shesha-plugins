/**
 * Blueprint -> raw component tree assembly. This is compile-spec's main
 * recursive walk: for every blueprint node it resolves the concrete
 * registry `type` (type-registry.mjs), delegates to the matching per-kind
 * builder (container-style.mjs / actions.mjs / datacontext.mjs /
 * columns.mjs / leaf.mjs), and recurses into children.
 *
 * Deliberately produces NO `id`/`parentId`/`version` on any node — those are
 * `normalize-form.mjs`'s Phase B job (id minting is seeded from the node's
 * tree PATH, exactly the same mechanism this module's `path` argument
 * exists to feed) and compile-spec's own final step runs every node through
 * `normalize()` (see compile-spec.mjs), so duplicating that logic here would
 * both violate "reuse, don't reimplement" and risk disagreeing with it.
 *
 * `role` is deliberately dropped for any non-container node (see
 * container-style.mjs's own header comment for containers; a role name is
 * simply not one of the container-style prop paths any OTHER component's
 * registry entry declares, so leaving it would trip T1-PROP-UNKNOWN).
 */
import { resolveComponentType } from './type-registry.mjs';
import { resolveContainerStyle } from './container-style.mjs';
import { buildButtonGroupItems } from './actions.mjs';
import { buildDataContext } from './datacontext.mjs';
import { buildColumns } from './columns.mjs';
import { buildLeafComponent } from './leaf.mjs';
import { deterministicId } from './ids.mjs';
import { isPlainObject, flexPropsOf, BREAKPOINTS } from '../expand-style.mjs';

// Types whose children live in a separate slot object (content.components /
// header.components / customHeader.components) rather than a top-level
// `components[]` — tier1.mjs's own DOUBLE_SLOT_TYPES. Slot NAMES themselves
// are never hardcoded here; see buildSlottedNode below, which reads
// `registry.components[type].customContainerNames`.
const SLOTTED_TYPES = new Set(['card', 'collapsiblePanel']);

function toKebab(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function deriveDependsOnForms(blueprint) {
  const entityKebab = blueprint.entity?.modelType?.name ? toKebab(blueprint.entity.modelType.name) : null;
  const out = {};
  for (const dep of blueprint.dependencies ?? []) {
    let name = dep.naming ?? dep.id;
    if (entityKebab) name = name.replace('{entity-kebab}', entityKebab);
    out[dep.id] = { module: blueprint.form?.module, name };
  }
  return out;
}

/**
 * @param {object} blueprint - blueprint with `.nodes` already flow-completed
 * @param {{registry, roles, tokens, isDetailForm: boolean}} opts
 * @returns {{ components: object[], report: object[] }}
 */
export function buildTree(blueprint, opts) {
  const { registry, roles, tokens, isDetailForm } = opts;
  const nodesByName = new Map(blueprint.nodes.map((n) => [n.node, n]));
  const bindingsByContent = new Map((blueprint.bindings ?? []).map((b) => [b.label, b]));
  const dependsOnFormsByTarget = deriveDependsOnForms(blueprint);
  const report = [];
  const built = new Set();

  function childrenOf(bpNode) {
    if (Array.isArray(bpNode.children)) return bpNode.children;
    return blueprint.nodes.filter((n) => n.slot === bpNode.node).map((n) => n.node);
  }

  function buildChildren(names, path) {
    return names.map((name, idx) => buildNode(name, `${path}.child[${idx}]`));
  }

  function buildNode(name, path) {
    const bpNode = nodesByName.get(name);
    if (!bpNode) {
      throw new Error(`compileSpec: "${name}" is referenced by a slot/children/tabs entry but no blueprint node defines it.`);
    }
    built.add(name);
    const { type: resolvedType, aliasedFrom } = resolveComponentType(bpNode.type, registry);
    report.push({
      node: name,
      type: resolvedType,
      blueprintType: bpNode.type,
      aliasedFrom,
      source: bpNode.addedBy === 'flow-manifest' ? 'flow-manifest' : 'blueprint',
      path,
    });

    if (resolvedType === 'container') {
      const style = resolveContainerStyle(bpNode, { roles, tokens });
      const childNames = childrenOf(bpNode);
      const node = { type: 'container', componentName: name, ...style };
      if (childNames.length) node.components = buildChildren(childNames, path);
      return node;
    }

    // -------------------------------------------------------------------
    // card / collapsiblePanel ("slotted" components — SLOTTED_TYPES above).
    //
    // Slot names come from the registry entry itself
    // (`customContainerNames`, e.g. card: ["header","content"],
    // collapsiblePanel: ["header","content","customHeader"]) rather than
    // being hardcoded here, so a framework change to which slots a type
    // exposes surfaces as an explicit error below, not a silent
    // misplacement. `children`/slot-derived children all target the
    // "content" slot (the one real fixture that exercises this —
    // assets/blocks/rail-panel.block.json — puts its real body in content
    // and leaves header empty; the blueprint schema has no per-child way to
    // target header/customHeader instead, so every OTHER declared slot is
    // built as present-but-empty, matching that same real shape). Never
    // stamps a top-level `components[]` alongside `content` — that
    // combination is exactly T1-DOUBLE-SLOT.
    //
    // Layout-style split (the defect-2 fix): display/flexDirection/
    // flexWrap/gap/justifyContent/alignItems are NOT declared props for
    // either type in the registry — confirmed empirically: stamping them
    // directly on a card node (exactly tests/fixtures/
    // t2-slot-style-mismatch.json's shape, the real pushed defect) trips
    // T1-PROP-UNKNOWN for all six. Real children are laid out by whatever
    // style sits on the SLOT OBJECT ITSELF, a separate prop surface
    // tier1.mjs never validates (a slot object carries no `type`, so
    // walk.mjs never visits it as a node). So: any genuinely-declared box
    // style this node resolves (border/background/shadow/font/dimensions —
    // all real card/collapsiblePanel props) stays on the node; the six
    // flex props go on the slot instead. This mirrors normalize-form.mjs's
    // propagateSlotStyle()/tier2.mjs's T2-SLOT-STYLE-MISMATCH mechanism
    // exactly (same six props, same flat/no-breakpoint shape on the slot)
    // rather than reimplementing it — building it correctly here means
    // that pass runs as idempotent confirmation, not a repair.
    if (SLOTTED_TYPES.has(resolvedType)) {
      const comp = registry.components[resolvedType];
      const slotNames = Array.isArray(comp?.customContainerNames) ? comp.customContainerNames : [];
      if (!slotNames.length) {
        throw new Error(`compileSpec: registry entry for "${resolvedType}" declares no customContainerNames — cannot place "${name}"'s children into any slot.`);
      }
      const targetSlot = slotNames.includes('content') ? 'content' : slotNames[0];
      const childNames = childrenOf(bpNode);
      const hasRoleOrStyle = (typeof bpNode.role === 'string' && bpNode.role.length > 0) || isPlainObject(bpNode.style);

      const node = { type: resolvedType, componentName: name };
      let slotFlexProps = {};

      if (hasRoleOrStyle) {
        const resolved = resolveContainerStyle(bpNode, { roles, tokens });
        const flex = flexPropsOf(resolved.desktop);
        for (const [k, v] of Object.entries(flex)) {
          if (v !== undefined) slotFlexProps[k] = v;
        }
        for (const bp of BREAKPOINTS) {
          const {
            display, flexDirection, flexWrap, gap, justifyContent, alignItems, ...boxStyle
          } = resolved[bp];
          node[bp] = boxStyle;
        }
        if (resolved.overrides) node.overrides = resolved.overrides;
      } else if (childNames.length >= 2) {
        // No role/style authored at all: give a 2+-child slot a minimal
        // neutral stacked layout so its children never collapse into one
        // run-on string by default — the exact real symptom ("StatusFlight
        // status") this branch exists to prevent.
        slotFlexProps = {
          display: 'flex', flexDirection: 'column', flexWrap: 'nowrap', gap: 0, justifyContent: 'flex-start', alignItems: 'stretch',
        };
      }

      for (const slotName of slotNames) {
        if (slotName === targetSlot) {
          const slotChildren = childNames.length ? buildChildren(childNames, `${path}.${targetSlot}`) : [];
          node[slotName] = { components: slotChildren, ...slotFlexProps };
        } else {
          node[slotName] = { components: [] };
        }
      }
      return node;
    }

    if (resolvedType === 'tabs') {
      const childNames = childrenOf(bpNode);
      const builtByName = new Map(childNames.map((cn, idx) => [cn, buildNode(cn, `${path}.child[${idx}]`)]));
      const tabs = (bpNode.tabs ?? []).map((tab, tIdx) => ({
        id: deterministicId(`${path}.tabs[${tIdx}]`),
        key: tab.key,
        title: tab.title,
        components: (tab.children ?? []).map((cn) => builtByName.get(cn)).filter(Boolean),
      }));
      return { type: 'tabs', componentName: name, tabs };
    }

    if (resolvedType === 'buttonGroup') {
      const items = buildButtonGroupItems(bpNode.items, path, { form: blueprint.form, dependsOnFormsByTarget });
      return { type: 'buttonGroup', componentName: name, items };
    }

    if (resolvedType === 'dataContext') {
      const props = buildDataContext(bpNode, { blueprint });
      return { type: 'dataContext', ...props };
    }

    if (resolvedType === 'datatable') {
      const node = { type: 'datatable', componentName: name };
      if (Array.isArray(bpNode.columns)) node.items = buildColumns(bpNode.columns, path);
      if (bpNode.content) node.label = bpNode.content;
      return node;
    }

    if (resolvedType === 'datalist') {
      const node = { type: 'datalist', componentName: name };
      if (bpNode.rowTemplate) node.formId = { module: blueprint.form?.module, name: bpNode.rowTemplate };
      return node;
    }

    if (resolvedType === 'wizard') {
      const childNames = childrenOf(bpNode);
      const node = { type: 'wizard', componentName: name, showBackButton: true, showDoneButton: true, buttonsLayout: 'right' };
      if (childNames.length) {
        node.components = buildChildren(childNames, path);
        node.steps = childNames.map((cn, idx) => ({
          id: deterministicId(`${path}.steps[${idx}]`),
          key: cn,
          title: nodesByName.get(cn)?.content ?? `Step ${idx + 1}`,
        }));
      }
      return node;
    }

    // Everything else is a leaf: text, textField, numberField, dateField,
    // attachmentsEditor, dropdown, barChart, validationErrors,
    // datatable.quickSearch, datatable.pager, ...
    const binding = bindingsByContent.get(bpNode.content);
    return { type: resolvedType, ...buildLeafComponent(bpNode, resolvedType, { binding, isDetailForm }) };
  }

  const roots = blueprint.nodes.filter((n) => n.slot === undefined || n.slot === null).map((n) => n.node);
  const components = roots.map((name, idx) => buildNode(name, `components[${idx}]`));

  const unreached = blueprint.nodes.map((n) => n.node).filter((name) => !built.has(name));
  if (unreached.length) {
    throw new Error(`compileSpec: blueprint node(s) [${unreached.join(', ')}] are defined but never reachable from a root (no slot/children/tabs path to them).`);
  }

  return { components, report };
}
