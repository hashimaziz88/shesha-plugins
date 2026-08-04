// SEMANTIC PROJECTION of a compiled Shesha form.
//
// Why this exists: the suite used to hold a FULL serialization snapshot of every
// fixture under every shipped theme — 27 files, 17k lines — to answer questions like
// "does the page still open with a band?", "is every binding still wired to the right
// component?", "is there still exactly one action group?". Those are questions about
// a handful of facts, and a 900-line byte-diff is the least legible way to ask them:
// a one-token theme change re-records thousands of lines and buries the fact that
// actually regressed.
//
// project(form) reduces a compiled form to the facts the tests assert on — hierarchy,
// component census, binding wiring, action wiring, page chrome, ids. Full snapshots
// survive only where COMPLETE output is genuinely the behaviour under test (see
// FULL_SNAPSHOTS in pipeline.test.mjs).
//
// One helper, reused across every fixture. Keep it dumb and total: it must never
// throw on a valid compiled form, because a projection that crashes hides the very
// regression it was written to catch.

/** the three ways a 0.45 component holds child components */
export const childrenOf = (n) => [
  ...(Array.isArray(n.components) ? n.components : []),
  ...(Array.isArray(n.columns) ? n.columns.flatMap((c) => (Array.isArray(c?.components) ? c.components : [])) : []),
  ...(Array.isArray(n.tabs) ? n.tabs.flatMap((t) => (Array.isArray(t?.components) ? t.components : [])) : []),
];

const isNode = (n) => Boolean(n) && typeof n === 'object' && typeof n.type === 'string';

/**
 * @param {object} form a compiled form document ({ components, formSettings })
 * @returns {{
 *   tree: string, rows: Array, census: Record<string, number>, types: string[],
 *   bindings: string[], groups: Array, chrome: object, ids: string[],
 *   find: (componentName: string) => object|null,
 *   ofType: (type: string) => object[],
 * }}
 */
export function project(form) {
  const rows = [];
  (function walk(list, depth, parent) {
    for (const n of list) {
      if (!isNode(n)) continue;
      rows.push({ depth, type: n.type, name: n.componentName ?? null, parent, node: n });
      walk(childrenOf(n), depth + 1, n);
    }
  })(Array.isArray(form?.components) ? form.components : [], 0, null);

  const census = {};
  for (const r of rows) census[r.type] = (census[r.type] ?? 0) + 1;

  // binding wiring: which entity property is rendered by which component type
  const bindings = rows
    .filter((r) => typeof r.node.propertyName === 'string' && r.node.propertyName)
    .map((r) => `${r.node.propertyName}:${r.type}`)
    .sort();

  // action wiring: one row per buttonGroup, with the facts R-007/R-020/R-057 are about
  const groups = rows.filter((r) => r.type === 'buttonGroup').map((r) => {
    const items = Array.isArray(r.node.items) ? r.node.items : [];
    return {
      name: r.name,
      parent: r.parent?.componentName ?? null,
      parentDesktop: r.parent?.desktop ?? null,
      isInline: r.node.isInline === true,
      labels: items.map((i) => i?.label ?? null),
      buttonTypes: items.map((i) => i?.buttonType ?? null),
      actions: items.map((i) => i?.actionConfiguration?.actionName ?? null),
      primaries: items.filter((i) => i?.buttonType === 'primary').length,
    };
  });

  // page anatomy, by the componentName the normalizer stamps
  const named = (cname) => rows.filter((r) => r.name === cname);
  const chrome = {
    band: named('pageHeaderBand').length,
    metaStrip: census.KeyInformationBar ?? 0,
    statTileRow: named('statTileRow').length,
    pageGround: rows[0]?.name ?? null,
  };

  return {
    rows,
    tree: rows.map((r) => `${'  '.repeat(r.depth)}${r.type}${r.name ? `:${r.name}` : ''}`).join('\n'),
    census,
    types: [...new Set(rows.map((r) => r.type))].sort(),
    bindings,
    groups,
    chrome,
    ids: rows.map((r) => r.node.id),
    find: (cname) => rows.find((r) => r.name === cname)?.node ?? null,
    ofType: (type) => rows.filter((r) => r.type === type).map((r) => r.node),
  };
}

export default project;
