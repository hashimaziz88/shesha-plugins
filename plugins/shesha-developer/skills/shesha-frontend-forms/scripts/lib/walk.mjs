/**
 * THE ONE TREE WALKER.
 *
 * 0.45 has no generic `children`. Container slots are per-type and are read from ground
 * truth (`customContainerNames`), but a walker also has to cope with files it did not
 * author — fetched markup, hand edits — so the shapes below are handled unconditionally.
 *
 * The old form-auditor annotated its own list of shapes with "misses here caused real
 * false-PASSes", which is the entire reason this is one function used by every rule
 * rather than a walk re-implemented per validator.
 *
 * Covered:
 *   components[]                 root and nested containers
 *   content.components[]         card, collapsiblePanel
 *   header.components[]          card, collapsiblePanel
 *   customHeader.components[]    collapsiblePanel (third slot, easy to miss)
 *   footer.components[]          defensive
 *   columns[i].components[]      columns, sizableColumns, KeyInformationBar
 *   tabs[i].components[]         tabs, searchableTabs
 *   steps[i].components[]        wizard
 *   panels[i].components[]       defensive
 *   items[]                      buttonGroup items, and nested item children
 *   <any>.components[]           last-resort sweep so a new container shape degrades to
 *                                "walked anyway" instead of "silently skipped"
 */

/** Slot keys whose value is an object carrying its own `components` array. */
const OBJECT_SLOTS = ['content', 'header', 'customHeader', 'footer'];

/** Slot keys whose value is an array of objects each carrying `components`. */
const ARRAY_SLOTS = ['columns', 'tabs', 'steps', 'panels'];

function isComponentLike(node) {
  return !!node && typeof node === 'object' && !Array.isArray(node) && typeof node.type === 'string';
}

/**
 * Depth-first walk yielding { node, parent, path, depth, slot }.
 *
 * `path` is a JSON-pointer-ish string suitable for a fixPointer in a rule violation, so
 * a report can name the exact node rather than "somewhere in the form".
 */
export function* walkComponents(components, { parent = null, path = 'components', depth = 0, slot = null } = {}) {
  if (!Array.isArray(components)) return;

  for (let i = 0; i < components.length; i += 1) {
    const node = components[i];
    if (!node || typeof node !== 'object') continue;
    const nodePath = `${path}/${i}`;

    if (isComponentLike(node)) {
      yield { node, parent, path: nodePath, depth, slot };
    }

    // Direct nesting.
    if (Array.isArray(node.components)) {
      yield* walkComponents(node.components, {
        parent: node,
        path: `${nodePath}/components`,
        depth: depth + 1,
        slot: null,
      });
    }

    // Object slots: card.content, card.header, collapsiblePanel.customHeader, ...
    for (const key of OBJECT_SLOTS) {
      const s = node[key];
      if (s && typeof s === 'object' && !Array.isArray(s) && Array.isArray(s.components)) {
        yield* walkComponents(s.components, {
          parent: node,
          path: `${nodePath}/${key}/components`,
          depth: depth + 1,
          slot: key,
        });
      }
    }

    // Array slots: tabs[i].components, columns[i].components, steps[i].components, ...
    for (const key of ARRAY_SLOTS) {
      const arr = node[key];
      if (!Array.isArray(arr)) continue;
      for (let j = 0; j < arr.length; j += 1) {
        const entry = arr[j];
        if (entry && typeof entry === 'object' && Array.isArray(entry.components)) {
          yield* walkComponents(entry.components, {
            parent: node,
            path: `${nodePath}/${key}/${j}/components`,
            depth: depth + 1,
            slot: key,
          });
        }
      }
    }

    // buttonGroup items (and any nested item children).
    if (Array.isArray(node.items)) {
      for (let j = 0; j < node.items.length; j += 1) {
        const item = node.items[j];
        if (!item || typeof item !== 'object') continue;
        const itemPath = `${nodePath}/items/${j}`;
        // Items are not full components (no `type` in the component sense) but they do
        // carry actionConfiguration and nested childItems, both of which rules inspect.
        yield { node: item, parent: node, path: itemPath, depth: depth + 1, slot: 'items', isItem: true };
        for (const childKey of ['childItems', 'components']) {
          if (Array.isArray(item[childKey])) {
            yield* walkComponents(item[childKey], {
              parent: node,
              path: `${itemPath}/${childKey}`,
              depth: depth + 2,
              slot: 'items',
            });
          }
        }
      }
    }

    // Last-resort sweep: any other key holding an object with a `components` array.
    // A container shape we have never seen degrades to "walked" rather than "skipped".
    for (const key of Object.keys(node)) {
      if (key === 'components' || OBJECT_SLOTS.includes(key) || ARRAY_SLOTS.includes(key) || key === 'items') continue;
      const v = node[key];
      if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.components)) {
        yield* walkComponents(v.components, {
          parent: node,
          path: `${nodePath}/${key}/components`,
          depth: depth + 1,
          slot: key,
        });
      }
    }
  }
}

/** Every real component (excludes buttonGroup items). */
export function allComponents(markup) {
  const out = [];
  for (const hit of walkComponents(markup?.components)) {
    if (!hit.isItem) out.push(hit);
  }
  return out;
}

/** Every buttonGroup item. */
export function allItems(markup) {
  const out = [];
  for (const hit of walkComponents(markup?.components)) {
    if (hit.isItem) out.push(hit);
  }
  return out;
}

/** Everything, components and items alike. */
export function allNodes(markup) {
  return [...walkComponents(markup?.components)];
}

/** First ancestor satisfying a predicate, walking up via the parent chain we recorded. */
export function findAncestor(markup, target, predicate) {
  const parents = new Map();
  for (const { node, parent } of walkComponents(markup?.components)) {
    parents.set(node, parent);
  }
  let cur = parents.get(target);
  while (cur) {
    if (predicate(cur)) return cur;
    cur = parents.get(cur);
  }
  return null;
}

/** Parent lookup for the whole tree, built once. */
export function parentMap(markup) {
  const m = new Map();
  for (const { node, parent } of walkComponents(markup?.components)) m.set(node, parent);
  return m;
}

/**
 * Collect every string value in a node's own props (not its children), with its key path.
 * Used by the script and template rules, which must inspect strings wherever they hide.
 */
export function ownStrings(node, { maxDepth = 4 } = {}) {
  const out = [];
  /**
   * `content` / `header` are BOTH container-slot names and ordinary prop names, depending
   * on the component type: card.content is a slot object, text.content is the text itself.
   * Skipping the key outright hid every text component's content from the mustache and
   * script rules, so a slot key is only skipped when its value really is a slot.
   */
  const isSlotValue = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.components);
  const visit = (v, p, d) => {
    if (d > maxDepth || v === null || v === undefined) return;
    if (typeof v === 'string') {
      out.push({ path: p, value: v });
      return;
    }
    if (Array.isArray(v)) {
      // Do not descend into child-component arrays; the walker handles those.
      if (p.endsWith('components') || p.endsWith('items')) return;
      v.forEach((x, i) => visit(x, `${p}/${i}`, d + 1));
      return;
    }
    if (typeof v === 'object') {
      if (typeof v.type === 'string' && p !== '') return; // a nested component
      for (const k of Object.keys(v)) {
        if (k === 'components' || k === 'items') continue;
        visit(v[k], `${p}/${k}`, d + 1);
      }
    }
  };
  for (const k of Object.keys(node || {})) {
    if (k === 'components' || k === 'items') continue;
    if (ARRAY_SLOTS.includes(k) && Array.isArray(node[k])) continue;
    if (OBJECT_SLOTS.includes(k) && isSlotValue(node[k])) continue;
    visit(node[k], k, 0);
  }
  return out;
}

/** The three responsive style blocks, when present. */
export function styleBlocks(node) {
  const out = [];
  for (const bp of ['desktop', 'tablet', 'mobile']) {
    if (node && node[bp] && typeof node[bp] === 'object') out.push({ breakpoint: bp, block: node[bp] });
  }
  return out;
}

/** Datatable / datalist column entries. The array key is `items`, not `columns`. */
export function tableColumns(node) {
  return Array.isArray(node?.items) ? node.items : [];
}
