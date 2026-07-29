/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/lib/cluster.mjs
 *
 * Pure, dependency-free clustering logic for the layout probe
 * (../layout-probe.js). Extracted into its own module so it is directly
 * unit-testable (tests/layout-probe.test.mjs) WITHOUT a browser.
 *
 * layout-probe.js's PROBE_FN runs inside a page (via browser_evaluate /
 * page.evaluate) and must stay self-contained — it cannot `import` this
 * file at runtime. Instead layout-probe.js reads this file's source TEXT
 * at build time and splices it into PROBE_FN's body (see
 * `loadClusterSource()` there), so the shipped browser logic and the
 * tested logic are byte-identical — one source of truth, two consumers.
 *
 * Because of that splicing, keep this file ES5-style (var, function
 * expressions, no arrow functions/destructuring/template strings) so it
 * remains valid when embedded inside another function's body, and export
 * every function with a plain `export function` declaration (no separate
 * `export { ... }` block) so the textual `export ` strip is trivial.
 * ───────────────────────────────────────────────────────────────────────── */

// 1-D interval overlap: > 0 means the two ranges actually overlap.
export function overlap1d(aStart, aEnd, bStart, bEnd) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

// Group a set of siblings into row bands by VERTICAL (y) overlap, not by
// left-edge (x) distinctness. Two children land in the same row band if
// their vertical extents actually overlap, or their top edges are within
// `yTolerance` of each other (near-miss due to differing line-heights).
// This is transitive (union-find) so a chain of overlapping children ends
// up in one group even if the first and last don't directly overlap.
//
// This is what fixes defect #3: a vertically-stacked pair at DIFFERENT x
// indents (Shesha's outer/inner div nesting) no longer counts as two
// columns, because they don't share a row band — each ends up alone in
// its own single-member group, contributing a column count of 1.
export function groupByRowBand(children, yTolerance) {
  var n = children.length;
  var parent = [];
  for (var i = 0; i < n; i++) parent.push(i);

  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(i, j) {
    var ri = find(i), rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (var a = 0; a < n; a++) {
    for (var b = a + 1; b < n; b++) {
      var ca = children[a], cb = children[b];
      var ov = overlap1d(ca.rect.y, ca.rect.y + ca.rect.h, cb.rect.y, cb.rect.y + cb.rect.h);
      var closeEdge = Math.abs(ca.rect.y - cb.rect.y) <= yTolerance;
      if (ov > 0 || closeEdge) union(a, b);
    }
  }

  var groupsByRoot = {};
  for (var k = 0; k < n; k++) {
    var r = find(k);
    (groupsByRoot[r] = groupsByRoot[r] || []).push(children[k]);
  }
  var groups = Object.keys(groupsByRoot).map(function (key) { return groupsByRoot[key]; });
  groups.sort(function (g1, g2) {
    var y1 = Math.min.apply(null, g1.map(function (c) { return c.rect.y; }));
    var y2 = Math.min.apply(null, g2.map(function (c) { return c.rect.y; }));
    return y1 - y2;
  });
  return groups;
}

// Cluster a set of children ASSUMED to already share one row band into
// x-bands by left-edge proximity (within xTolerance). Distinct bands,
// sorted ascending.
export function clusterXBands(group, xTolerance) {
  var edges = group.map(function (c) { return c.rect.x; }).sort(function (a, b) { return a - b; });
  var bands = [];
  edges.forEach(function (x) {
    var found = false;
    for (var i = 0; i < bands.length; i++) {
      if (Math.abs(bands[i] - x) <= xTolerance) { found = true; break; }
    }
    if (!found) bands.push(x);
  });
  bands.sort(function (a, b) { return a - b; });
  return bands;
}

export function nearestBandIndex(bands, x) {
  var idx = 0, best = Infinity;
  bands.forEach(function (b, i) {
    var d = Math.abs(b - x);
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

// Cluster one parent's direct children into row bands, then into columns
// within each row band. Returns the container-level summary (columnCount /
// columnEdges taken from whichever row band produced the most columns —
// i.e. the actual split row) plus a per-child assignment of
// { rowBand, colIndex, colCount }.
export function clusterContainerChildren(children, opts) {
  opts = opts || {};
  var xTol = opts.xTolerance == null ? 16 : opts.xTolerance;
  var yTol = opts.yTolerance == null ? 14 : opts.yTolerance;

  if (!children || !children.length) {
    return { columnCount: 0, columnEdges: [], assignments: {} };
  }

  var rowGroups = groupByRowBand(children, yTol);
  var assignments = {};
  var bestBands = [];

  rowGroups.forEach(function (group, rowIdx) {
    var bands = clusterXBands(group, xTol);
    group.forEach(function (child) {
      assignments[child.id] = {
        rowBand: rowIdx,
        colIndex: nearestBandIndex(bands, child.rect.x),
        colCount: bands.length
      };
    });
    if (bands.length > bestBands.length) bestBands = bands;
  });

  return { columnCount: bestBands.length, columnEdges: bestBands, assignments: assignments };
}

// Full per-parent pass over a flat `nodes[]` array (as produced by
// layout-probe.js's walk()): groups nodes by parentId, clusters each
// parent's direct children, writes rowBand/colIndex/colCount onto each
// child (mutates the node objects — same contract as the pre-fix probe),
// and returns the `multiColumnContainers[]` entries (only for parents
// whose columnCount >= 2), each carrying `childWidths` — every split
// child's own measured width (`rect.w`, native px), index-aligned with
// `childIds`. NEVER normalises to a 24-unit grid (defect #2 removed —
// there is no colSpan24 anywhere in this module).
export function buildMultiColumnContainers(nodes, opts) {
  var byParent = {};
  var byId = {};
  nodes.forEach(function (n) { byId[n.id] = n; });
  nodes.forEach(function (n) {
    if (n.parentId == null) return;
    (byParent[n.parentId] = byParent[n.parentId] || []).push(n);
  });

  var containers = [];
  Object.keys(byParent).forEach(function (pid) {
    var kids = byParent[pid];
    var result = clusterContainerChildren(kids, opts);
    kids.forEach(function (k) {
      var a = result.assignments[k.id] || { rowBand: 0, colIndex: 0, colCount: 1 };
      k.rowBand = a.rowBand;
      k.colIndex = a.colIndex;
      k.colCount = a.colCount;
    });
    if (result.columnCount >= 2) {
      var parent = byId[pid];
      var parentIdNum = isNaN(+pid) ? pid : +pid;
      containers.push({
        parentId: parentIdNum,
        parentLabel: parent ? parent.label : undefined,
        parentRole: parent ? parent.role : undefined,
        columnCount: result.columnCount,
        columnEdges: result.columnEdges,
        childIds: kids.map(function (k) { return k.id; }),
        childWidths: kids.map(function (k) { return k.rect.w; })
      });
    }
  });

  return containers;
}
