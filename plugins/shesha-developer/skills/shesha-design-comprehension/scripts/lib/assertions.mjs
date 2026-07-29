/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/lib/assertions.mjs
 *
 * The typed placement-assertion grammar (Phase 3, Task 3). Replaces English
 * assertions ("left ≥ 2.5× right", graded by the model that wrote them) with
 * five typed predicates — exactly the dimensions references/verification-loop.md
 * already tabulates: split-cell membership, nesting/parent, split ratio (the
 * one quantitative predicate, and only ever a RANGE — never an absolute
 * pixel), row grouping, and tab assignment.
 *
 * GRAMMAR (exact accepted syntax)
 * ────────────────────────────────
 *   assertion := predicate "(" args ")"
 *
 *   same-cluster(a, b)        a and b sit in the same split column
 *   parent-of(a, b)           b is a descendant of a (any depth)
 *   ratio(a, b, min, max)     a's width ÷ b's width falls within [min, max]
 *   same-rowband(a, b)        a and b are siblings sharing a horizontal row band
 *   tab(a, key)               a sits under the tab with that key
 *
 *   ident  := [A-Za-z_][A-Za-z0-9_.-]*      (a blueprint node name, or a tab key)
 *   number := -?\d+(\.\d+)?
 *
 * Whitespace around commas/parens is ignored. Argument counts and shapes are
 * fixed per predicate — nothing else parses. There is NO English fallback:
 * an assertion that doesn't match one of these five forms is a parse error
 * naming the valid forms, on purpose — a permissive parser would silently
 * degrade back into the prose this grammar exists to replace.
 *
 * NODE RESOLUTION (how `a`/`b` in an assertion resolve against a probe)
 * ────────────────────────────────────────────────────────────────────
 * `evaluate()` takes the assertions plus a `probe` — the JSON produced by
 * scripts/layout-probe.js against a rendered page (see cluster.mjs for how
 * `colIndex`/`rowBand`/`parentId`/`multiColumnContainers[].childWidths` are
 * computed). Assertion args are blueprint node identifiers (e.g. "toolbar",
 * "detailRail"), not probe node ids — a probe node is resolved by trying, in
 * order: an exact `node.name` match (the identifier a build/capture step
 * should stamp onto each measured node — e.g. via a `data-blueprint-node`
 * hook read into `name` by whatever produces the probe), then an exact
 * string match against `node.id`, then a case-insensitive match against
 * `node.label` (the probe's best-effort visible text/aria-label). The first
 * two are exact and unambiguous; label matching is a best-effort fallback
 * for probes that don't yet stamp blueprint node names onto the DOM — same
 * ambiguity the routed-fix prose in verification-loop.md already lived with.
 *
 * TAB IDENTITY is a known open gap: layout-probe.js's three Task 2 fixes
 * (childWidths / no 24-unit grid / row-band clustering) do not add tab-key
 * capture to the DOM walk. `tab(a, key)` here checks for a `tabKey` field on
 * `a` or any of its ancestors (by `parentId` chain) — real captures need a
 * future probe extension to populate `tabKey` (e.g. reading `aria-controls`/
 * `data-tab-key`) for this predicate to resolve against a genuine build;
 * synthetic/test probes can set `tabKey` directly.
 * ───────────────────────────────────────────────────────────────────────── */

'use strict';

var IDENT = '[A-Za-z_][A-Za-z0-9_.-]*';
var NUM = '-?\\d+(?:\\.\\d+)?';

var FORMS = [
  {
    predicate: 'same-cluster',
    re: new RegExp('^same-cluster\\(\\s*(' + IDENT + ')\\s*,\\s*(' + IDENT + ')\\s*\\)$'),
    args: ['a', 'b']
  },
  {
    predicate: 'parent-of',
    re: new RegExp('^parent-of\\(\\s*(' + IDENT + ')\\s*,\\s*(' + IDENT + ')\\s*\\)$'),
    args: ['a', 'b']
  },
  {
    predicate: 'same-rowband',
    re: new RegExp('^same-rowband\\(\\s*(' + IDENT + ')\\s*,\\s*(' + IDENT + ')\\s*\\)$'),
    args: ['a', 'b']
  },
  {
    predicate: 'tab',
    re: new RegExp('^tab\\(\\s*(' + IDENT + ')\\s*,\\s*(' + IDENT + ')\\s*\\)$'),
    args: ['a', 'key']
  },
  {
    predicate: 'ratio',
    re: new RegExp('^ratio\\(\\s*(' + IDENT + ')\\s*,\\s*(' + IDENT + ')\\s*,\\s*(' + NUM + ')\\s*,\\s*(' + NUM + ')\\s*\\)$'),
    args: ['a', 'b', 'min', 'max']
  }
];

var VALID_FORMS_MESSAGE =
  'same-cluster(a, b) | parent-of(a, b) | ratio(a, b, min, max) | same-rowband(a, b) | tab(a, key)';

// parseAssertion(str) => { predicate, args, raw }
// Throws on anything that doesn't match one of the five forms above — no
// English fallback, by design (see file header).
export function parseAssertion(str) {
  var raw = String(str);
  var trimmed = raw.trim();
  for (var i = 0; i < FORMS.length; i++) {
    var form = FORMS[i];
    var m = trimmed.match(form.re);
    if (m) {
      var args = {};
      form.args.forEach(function (name, idx) {
        var value = m[idx + 1];
        args[name] = (name === 'min' || name === 'max') ? Number(value) : value;
      });
      return { predicate: form.predicate, args: args, raw: raw };
    }
  }
  throw new Error(
    'Unparseable assertion: "' + trimmed + '". Valid forms: ' + VALID_FORMS_MESSAGE
  );
}

/* ── node resolution ──────────────────────────────────────────────────── */

function findNode(probe, ref) {
  var nodes = (probe && probe.nodes) || [];
  var i;
  for (i = 0; i < nodes.length; i++) {
    if (nodes[i].name === ref) return nodes[i];
  }
  for (i = 0; i < nodes.length; i++) {
    if (String(nodes[i].id) === ref) return nodes[i];
  }
  var lower = ref.toLowerCase();
  for (i = 0; i < nodes.length; i++) {
    if (nodes[i].label != null && String(nodes[i].label).toLowerCase() === lower) return nodes[i];
  }
  return null;
}

function nodeById(probe, id) {
  var nodes = (probe && probe.nodes) || [];
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return nodes[i];
  }
  return null;
}

function ancestorChain(probe, node) {
  var chain = [];
  var cur = node;
  var guard = 0;
  while (cur && cur.parentId != null && guard++ < 10000) {
    var parent = nodeById(probe, cur.parentId);
    if (!parent) break;
    chain.push(parent);
    cur = parent;
  }
  return chain;
}

function describeNode(ref, node) {
  if (!node) return ref + ' (not found in probe)';
  return ref + ' (id=' + node.id + ', label=' + JSON.stringify(node.label || '') + ')';
}

/* ── per-predicate evaluators ─────────────────────────────────────────── */
/* Each returns { pass, actual, message }. `evaluate()` wraps these with the
 * original raw assertion text. */

function evalSameCluster(parsed, probe) {
  var a = findNode(probe, parsed.args.a);
  var b = findNode(probe, parsed.args.b);
  if (!a || !b) {
    return {
      pass: false,
      actual: null,
      message: 'could not resolve ' + describeNode(parsed.args.a, a) + ' and/or ' + describeNode(parsed.args.b, b)
    };
  }
  var actual = 'colIndex(' + parsed.args.a + ')=' + a.colIndex + ', colIndex(' + parsed.args.b + ')=' + b.colIndex +
    ', parentId(' + parsed.args.a + ')=' + a.parentId + ', parentId(' + parsed.args.b + ')=' + b.parentId;
  var pass = a.parentId != null && a.parentId === b.parentId && a.colIndex != null && a.colIndex === b.colIndex;
  return {
    pass: pass,
    actual: actual,
    message: pass
      ? parsed.args.a + ' and ' + parsed.args.b + ' share split column ' + a.colIndex
      : parsed.args.a + ' (colIndex ' + a.colIndex + ', parent ' + a.parentId + ') is not in the same split ' +
        'column as ' + parsed.args.b + ' (colIndex ' + b.colIndex + ', parent ' + b.parentId + ')'
  };
}

function evalParentOf(parsed, probe) {
  var a = findNode(probe, parsed.args.a);
  var b = findNode(probe, parsed.args.b);
  if (!a || !b) {
    return {
      pass: false,
      actual: null,
      message: 'could not resolve ' + describeNode(parsed.args.a, a) + ' and/or ' + describeNode(parsed.args.b, b)
    };
  }
  var chain = ancestorChain(probe, b);
  var ancestorIds = chain.map(function (n) { return n.id; });
  var pass = ancestorIds.indexOf(a.id) !== -1;
  var actual = parsed.args.b + '\'s ancestor chain = [' + ancestorIds.join(', ') + '] (looking for id=' + a.id + ')';
  return {
    pass: pass,
    actual: actual,
    message: pass
      ? parsed.args.b + ' is a descendant of ' + parsed.args.a
      : parsed.args.b + ' (id=' + b.id + ') is not a descendant of ' + parsed.args.a + ' (id=' + a.id +
        '); measured ancestor chain: [' + ancestorIds.join(', ') + ']'
  };
}

function evalSameRowband(parsed, probe) {
  var a = findNode(probe, parsed.args.a);
  var b = findNode(probe, parsed.args.b);
  if (!a || !b) {
    return {
      pass: false,
      actual: null,
      message: 'could not resolve ' + describeNode(parsed.args.a, a) + ' and/or ' + describeNode(parsed.args.b, b)
    };
  }
  var actual = 'rowBand(' + parsed.args.a + ')=' + a.rowBand + ', rowBand(' + parsed.args.b + ')=' + b.rowBand +
    ', parentId(' + parsed.args.a + ')=' + a.parentId + ', parentId(' + parsed.args.b + ')=' + b.parentId;
  var pass = a.parentId != null && a.parentId === b.parentId && a.rowBand != null && a.rowBand === b.rowBand;
  return {
    pass: pass,
    actual: actual,
    message: pass
      ? parsed.args.a + ' and ' + parsed.args.b + ' share row band ' + a.rowBand
      : parsed.args.a + ' (rowBand ' + a.rowBand + ', parent ' + a.parentId + ') does not share a row band with ' +
        parsed.args.b + ' (rowBand ' + b.rowBand + ', parent ' + b.parentId + ')'
  };
}

function evalTab(parsed, probe) {
  var a = findNode(probe, parsed.args.a);
  if (!a) {
    return { pass: false, actual: null, message: 'could not resolve ' + describeNode(parsed.args.a, a) };
  }
  var key = parsed.args.key;
  var candidates = [a].concat(ancestorChain(probe, a));
  var found = null;
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].tabKey != null) { found = candidates[i].tabKey; break; }
  }
  var pass = found === key;
  var actual = 'measured tabKey=' + JSON.stringify(found == null ? null : found) + ' (asserted "' + key + '")';
  return {
    pass: pass,
    actual: actual,
    message: pass
      ? parsed.args.a + ' sits under tab "' + key + '"'
      : parsed.args.a + ' is under tab ' + JSON.stringify(found) + ', not the asserted "' + key + '"'
  };
}

function evalRatio(parsed, probe) {
  var a = findNode(probe, parsed.args.a);
  var b = findNode(probe, parsed.args.b);
  if (!a || !b) {
    return {
      pass: false,
      actual: null,
      message: 'could not resolve ' + describeNode(parsed.args.a, a) + ' and/or ' + describeNode(parsed.args.b, b)
    };
  }
  var containers = (probe && probe.multiColumnContainers) || [];
  var container = null;
  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    if (c.childIds && c.childIds.indexOf(a.id) !== -1 && c.childIds.indexOf(b.id) !== -1) { container = c; break; }
  }
  if (!container) {
    return {
      pass: false,
      actual: null,
      message: parsed.args.a + ' and ' + parsed.args.b + ' are not both split-children of the same ' +
        'multi-column container — ratio() only applies to siblings measured in one row\'s childWidths'
    };
  }
  if (!container.childWidths) {
    return {
      pass: false,
      actual: null,
      message: 'the multi-column container for ' + parsed.args.a + '/' + parsed.args.b +
        ' has no childWidths (probe not produced by the fixed layout-probe.js?)'
    };
  }
  var idxA = container.childIds.indexOf(a.id);
  var idxB = container.childIds.indexOf(b.id);
  var widthA = container.childWidths[idxA];
  var widthB = container.childWidths[idxB];
  var measuredRatio = widthB === 0 ? Infinity : widthA / widthB;
  var pass = measuredRatio >= parsed.args.min && measuredRatio <= parsed.args.max;
  var actual = 'width(' + parsed.args.a + ')=' + widthA + 'px, width(' + parsed.args.b + ')=' + widthB +
    'px, ratio=' + measuredRatio.toFixed(3);
  return {
    pass: pass,
    actual: actual,
    message: pass
      ? parsed.args.a + ':' + parsed.args.b + ' ratio ' + measuredRatio.toFixed(3) + ' is within [' +
        parsed.args.min + ', ' + parsed.args.max + ']'
      : parsed.args.a + ' (' + widthA + 'px) ÷ ' + parsed.args.b + ' (' + widthB + 'px) = ' +
        measuredRatio.toFixed(3) + ', outside the asserted range [' + parsed.args.min + ', ' + parsed.args.max + ']'
  };
}

var EVALUATORS = {
  'same-cluster': evalSameCluster,
  'parent-of': evalParentOf,
  'same-rowband': evalSameRowband,
  'tab': evalTab,
  'ratio': evalRatio
};

// evaluate(assertions, probe) => Array<{ assertion, pass, actual, message }>
// `assertions` is an array of raw assertion strings (as authored in a
// blueprint's `assertions[]`). A string that fails to parse is reported as
// a failing result (message = the parse error) rather than throwing, so one
// bad assertion doesn't abort evaluation of the rest.
export function evaluate(assertions, probe) {
  return (assertions || []).map(function (raw) {
    var parsed;
    try {
      parsed = parseAssertion(raw);
    } catch (err) {
      return { assertion: raw, pass: false, actual: null, message: err.message };
    }
    var evaluator = EVALUATORS[parsed.predicate];
    var result = evaluator(parsed, probe);
    return { assertion: raw, pass: result.pass, actual: result.actual, message: result.message };
  });
}
