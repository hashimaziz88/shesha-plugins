export const CHILD_KEYS = ['components', 'columns', 'tabs', 'content', 'header', 'customHeader', 'items'];

/**
 * Depth-first tree walk over a form's component tree.
 * Visits only nodes with a `type` property.
 *
 * @param {Array} components - Root component array
 * @param {Function} visit - Callback(node, ctx) where ctx = {depth, parent, path, slot}
 */
export function walk(components, visit) {
  const entries = flatten(components);
  for (const { node, ctx } of entries) {
    visit(node, ctx);
  }
}

/**
 * Flatten the tree into an array of {node, ctx} entries.
 * One entry per typed node, in depth-first order.
 *
 * @param {Array} components - Root component array
 * @returns {Array<{node, ctx}>}
 */
export function flatten(components) {
  const result = [];

  function walkNode(node, depth, parent, path, slot) {
    // Skip null/undefined
    if (!node || typeof node !== 'object') {
      return;
    }

    // Only visit if node has a type property
    if (node.type) {
      result.push({
        node,
        ctx: { depth, parent: parent ?? null, path, slot }
      });
    }

    // Descend into children regardless of whether this node has a type
    descend(node, depth + 1, node.type ? node : parent, path, slot);
  }

  function descend(obj, depth, parent, parentPath, slot) {
    // Handle 'components' array (normal case)
    if (Array.isArray(obj.components)) {
      obj.components.forEach((child, idx) => {
        const path = parentPath ? `${parentPath}.components[${idx}]` : `components[${idx}]`;
        walkNode(child, depth, parent, path, slot);
      });
    }

    // Handle 'columns' array - contains slot objects with {flex, components}
    if (Array.isArray(obj.columns)) {
      obj.columns.forEach((slot, idx) => {
        if (slot && typeof slot === 'object' && Array.isArray(slot.components)) {
          slot.components.forEach((child, childIdx) => {
            const path = parentPath
              ? `${parentPath}.columns[${idx}].components[${childIdx}]`
              : `columns[${idx}].components[${childIdx}]`;
            walkNode(child, depth, parent, path, undefined);
          });
        }
      });
    }

    // Handle 'tabs' array - contains {key, components}
    if (Array.isArray(obj.tabs)) {
      obj.tabs.forEach((tab, idx) => {
        if (tab && typeof tab === 'object') {
          const tabKey = tab.key;
          if (Array.isArray(tab.components)) {
            tab.components.forEach((child, childIdx) => {
              const path = parentPath
                ? `${parentPath}.tabs[${idx}].components[${childIdx}]`
                : `tabs[${idx}].components[${childIdx}]`;
              walkNode(child, depth, parent, path, tabKey);
            });
          }
        }
      });
    }

    // Handle 'content' object slot
    if (obj.content && typeof obj.content === 'object' && Array.isArray(obj.content.components)) {
      obj.content.components.forEach((child, idx) => {
        const path = parentPath
          ? `${parentPath}.content.components[${idx}]`
          : `content.components[${idx}]`;
        walkNode(child, depth, parent, path, slot);
      });
    }

    // Handle 'header' object slot
    if (obj.header && typeof obj.header === 'object' && Array.isArray(obj.header.components)) {
      obj.header.components.forEach((child, idx) => {
        const path = parentPath
          ? `${parentPath}.header.components[${idx}]`
          : `header.components[${idx}]`;
        walkNode(child, depth, parent, path, slot);
      });
    }

    // Handle 'customHeader' object slot
    if (obj.customHeader && typeof obj.customHeader === 'object' && Array.isArray(obj.customHeader.components)) {
      obj.customHeader.components.forEach((child, idx) => {
        const path = parentPath
          ? `${parentPath}.customHeader.components[${idx}]`
          : `customHeader.components[${idx}]`;
        walkNode(child, depth, parent, path, slot);
      });
    }

    // Handle 'items' array (used by buttonGroup)
    if (Array.isArray(obj.items)) {
      obj.items.forEach((child, idx) => {
        const path = parentPath ? `${parentPath}.items[${idx}]` : `items[${idx}]`;
        walkNode(child, depth, parent, path, slot);
      });
    }
  }

  // Process root components array
  if (Array.isArray(components)) {
    components.forEach((node, idx) => {
      const path = `components[${idx}]`;
      walkNode(node, 0, null, path, undefined);
    });
  }

  return result;
}
