// T4b — DOM residue (§3.2.5). Asserts over a RECORDED layout probe; the probe itself
// (src/probe/layout-probe.mjs) measures and asserts nothing. Only emergent residue lives
// here: things that depend on rendered text metrics and the browser's box model, which no
// tree predicate over the compiled form can compute. Everything a predicate CAN compute
// is T3's (D-014), so this tier is deliberately four checks wide, not forty.
//
// Three rules exist to stop it being evadable, each closing a hole an adversarial pass
// actually exploited before it was written:
//
//  * NOTHING IS SKIPPED FOR WANT OF A NAME. Every visible node is checked. A node with no
//    `data-sha-c-name` self-or-ancestor is still measured and still fails; it is merely
//    reported by node id instead of by component. An earlier draft disposed such nodes
//    `notApplicable`, and because a notApplicable note is never printed, stripping ONE
//    ancestor's attribute turned a 500px clip and a 23,880px^2 overlap into a silent pass.
//  * CAPABILITIES ARE VALIDATED, NOT TRUSTED. The `capabilities` block may name only the
//    keys the instrument declares (CAPABILITY_KEYS). A probe carrying any other key is a
//    FAILURE, not a licence: without that rule, a probe could assert
//    `{"geometry": false}` and downgrade every real defect to uninspectable — the exact
//    escape hatch that downgrades failures (banned behaviour T14).
//  * OVERLAP IS NOT LIMITED TO DOM SIBLINGS. Two form controls painted on top of each
//    other are a defect whether or not they share a parent; a columns-collide or
//    card-overflows-its-section defect is between subtrees.
//
// T4b never enters `result` (D-015). It reports into T4's tier entry, because the verdict
// envelope's `tiers` object is additionalProperties:false over T1..T5 and there is no
// legal T4b key (§4.2.4).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, EXIT } from '@shesha/registry/coverage';
import { CAPABILITY_KEYS } from '../probe/layout-probe.mjs';

export const id = 't4b-residue';
export const describe = 'overflow clipping, painted overlap, unintended wrap and text truncation over a recorded layout probe';

export const checks = [
  { id: 'T4b.01', family: 'overflow', dimension: null, describe: 'no container clips its own content: scrollWidth/Height within clientWidth/Height + 1' },
  { id: 'T4b.02', family: 'overlap', dimension: null, describe: 'no painted overlap between two in-flow nodes, whether or not they share a parent' },
  { id: 'T4b.03', family: 'wrap', dimension: null, describe: 'a declared single-row container keeps its children in one parent-relative y-band' },
  { id: 'T4b.04', family: 'truncation', dimension: null, describe: 'no text-bearing node is truncated: scrollWidth within clientWidth' },
];

/** Roles whose content is text, so a horizontal scroll overflow means visible truncation. */
const TEXT_ROLES = new Set(['label', 'heading', 'col-header', 'link', 'button']);
/** Positions that take a node out of normal flow. */
const OUT_OF_FLOW = new Set(['absolute', 'fixed', 'sticky']);
/**
 * Rects are recorded to 2dp, not rounded to integers, so two boxes that abut exactly
 * intersect by 0 rather than by a full-width pixel. A tenth of a pixel is below anything
 * a browser paints distinguishably, so that is the floor — not the 1px the integer form
 * needed, which made a genuine 1440x1 double-paint invisible.
 */
const MIN_OVERLAP_PX = 0.1;
const MIN_OVERLAP_AREA = 1;

/**
 * @typedef {{id:number, parentId:number|null, name:string|null, role:string, position:string,
 *            zIndex?:string, rect:{x:number,y:number,w:number,h:number},
 *            scroll:{w:number,h:number,cw:number,ch:number},
 *            flexDirection:string|null, isContainer:boolean, rowBand:number}} ProbeNode
 */

/**
 * T4b over one recorded probe.
 * @param {any} probe the parsed layout-probe output
 * @returns {import('@shesha/registry/coverage').Family[]}
 */
export function t4bResidue(probe) {
  const fams = families([
    { name: 'overflow', unit: 'container', required: false },
    { name: 'overlap', unit: 'node-pair', required: false },
    { name: 'wrap', unit: 'row-container', required: false },
    { name: 'truncation', unit: 'text-node', required: false },
    { name: 'instrument', unit: 'declaration' },
  ]);
  const F = {
    overflow: fams.get('overflow'), overlap: fams.get('overlap'),
    wrap: fams.get('wrap'), truncation: fams.get('truncation'),
    instrument: fams.get('instrument'),
  };

  const nodes = /** @type {ProbeNode[]} */ (Array.isArray(probe && probe.nodes) ? probe.nodes : []);
  const caps = (probe && typeof probe.capabilities === 'object' && probe.capabilities) || {};
  const reasons = (probe && typeof probe.capabilityReasons === 'object' && probe.capabilityReasons) || {};

  // ---- the instrument declaration ------------------------------------------
  // A probe is only readable if it says what instrument produced it and that
  // instrument's blind spots are the ones this tier knows about. An unrecognised
  // capability key is a malformed probe, never a licence to stop checking.
  const declared = Object.keys(caps);
  const unknown = declared.filter((k) => !CAPABILITY_KEYS.includes(/** @type {any} */ (k)));
  F.instrument.pointer('probe#capability-keys').assert(unknown.length === 0,
    `the probe declares capability key(s) ${JSON.stringify(unknown)} that layout-probe.mjs does not define (${CAPABILITY_KEYS.join(', ')}); an unrecognised capability cannot silence a check`);
  F.instrument.pointer('probe#nodes').assert(nodes.length > 0,
    'the recorded probe carries no measured nodes; a residue tier over an empty document is not a pass');

  const needs = /** @type {const} */ ([
    ['overflow', 'scroll', (/** @type {ProbeNode} */ n) => n.scroll && typeof n.scroll.cw === 'number'],
    ['overlap', 'rect+position', (/** @type {ProbeNode} */ n) => n.rect && typeof n.rect.x === 'number' && typeof n.position === 'string'],
    ['wrap', 'flexDirection+rowBand', (/** @type {ProbeNode} */ n) => 'flexDirection' in n && typeof n.rowBand === 'number'],
    ['truncation', 'role+scroll', (/** @type {ProbeNode} */ n) => typeof n.role === 'string' && n.scroll && typeof n.scroll.w === 'number'],
  ]);
  /** @type {Set<string>} */
  const readable = new Set();
  for (const [family, fields, ok] of needs) {
    const present = nodes.length > 0 && nodes.every((n) => ok(n));
    F.instrument.pointer(`probe#fields:${family}`).assert(present,
      `the recorded probe does not carry ${fields} on every node, so ${family} cannot be evaluated from it`);
    if (present) readable.add(family);
  }
  if (nodes.length === 0) return fams.list;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** @type {Map<number, ProbeNode[]>} */
  const kidsOf = new Map();
  for (const n of nodes) {
    if (n.parentId === null || n.parentId === undefined) continue;
    const bucket = kidsOf.get(n.parentId);
    if (bucket) bucket.push(n); else kidsOf.set(n.parentId, [n]);
  }

  /** The nearest data-sha-c-name at or above `n` — the handle back to a form component. */
  const ownerOf = (/** @type {ProbeNode} */ n) => {
    /** @type {ProbeNode|undefined} */
    let c = n;
    while (c) {
      if (c.name) return c.name;
      c = c.parentId === null || c.parentId === undefined ? undefined : byId.get(c.parentId);
    }
    return null;
  };
  const anyNamed = nodes.some((n) => Boolean(n.name));
  /** How a node is referred to in a finding: by component when one owns it, else by node. */
  const at = (/** @type {ProbeNode} */ n) => n.name || ownerOf(n) || `${n.role}#${n.id}`;
  const ancestors = (/** @type {ProbeNode} */ n) => {
    /** @type {Set<number>} */
    const set = new Set();
    let c = n.parentId === null || n.parentId === undefined ? undefined : byId.get(n.parentId);
    while (c) { set.add(c.id); c = c.parentId === null || c.parentId === undefined ? undefined : byId.get(c.parentId); }
    return set;
  };
  /** An out-of-flow node excuses painting over a neighbour only with a DELIBERATE z-index. */
  const layered = (/** @type {ProbeNode} */ n) => OUT_OF_FLOW.has(n.position) && n.zIndex !== undefined && n.zIndex !== 'auto';

  /**
   * Dispose one pointer for one check over one node. The dimension rule runs first, then
   * the identity rule; neither can skip a node, only turn it uninspectable.
   * @param {import('@shesha/registry/coverage').Pointer} p
   * @param {{id:string, dimension:string|null}} check
   * @param {() => {ok:boolean, reason:string}} evaluate
   */
  const dispose = (p, check, evaluate) => {
    if (check.dimension !== null && caps[check.dimension] === false) {
      p.cannot(`instrument cannot see ${check.dimension}: ${reasons[check.dimension] || 'declared false in the probe capabilities block'}`, check.id);
      return;
    }
    const r = evaluate();
    p.assert(r.ok, r.reason);
  };

  // Attribution is reported per check, and it is the ONLY thing a missing name costs.
  // The geometry is measured either way — residue on an unnamed node still fails — but
  // with no `data-sha-c-name` anywhere this cannot be confirmed to be a probe of the
  // intended Shesha screen rather than of a blank or error page, and that is a genuine
  // "I could not look", not a pass.
  for (const c of checks) {
    const p = F[/** @type {keyof typeof F} */ (c.family)].pointer(`probe#attribution:${c.id}`);
    if (anyNamed) p.check();
    else p.cannot(`attribution unavailable for ${c.id}: the probe captured no data-sha-c-name, so neither the screen nor any finding on it can be tied to a form component`, c.id);
  }

  const [c1, c2, c3, c4] = /** @type {[any, any, any, any]} */ (checks);

  // ---- T4b.01 overflow clipping ---------------------------------------------
  // The only observable of the `height: 30px` page-shell defect class in a rendered
  // document: content laid out taller or wider than the box that paints it.
  if (readable.has('overflow')) {
    for (const n of nodes) {
      if (!n.isContainer) continue;
      dispose(F.overflow.pointer(`${at(n)}#${n.id}#T4b.01`), c1, () => ({
        ok: n.scroll.w <= n.scroll.cw + 1 && n.scroll.h <= n.scroll.ch + 1,
        reason: `T4b.01 ${at(n)} (node ${n.id}) clips its content: scroll ${n.scroll.w}x${n.scroll.h} against client ${n.scroll.cw}x${n.scroll.ch}`,
      }));
    }
  }

  // ---- T4b.02 painted overlap ------------------------------------------------
  // Named nodes are compared against every other named node that is not an ancestor or
  // descendant of them, so a collision across two subtrees is visible; unnamed nodes are
  // compared against their in-flow siblings, which is where their geometry is meaningful.
  if (readable.has('overlap')) {
    /** @type {[ProbeNode, ProbeNode][]} */
    const pairs = [];
    const named = nodes.filter((n) => n.name);
    for (let i = 0; i < named.length; i += 1) {
      for (let j = i + 1; j < named.length; j += 1) {
        const a = named[i]; const b = named[j];
        if (!a || !b) continue;
        if (ancestors(a).has(b.id) || ancestors(b).has(a.id)) continue;
        pairs.push([a, b]);
      }
    }
    for (const kids of kidsOf.values()) {
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          const a = kids[i]; const b = kids[j];
          if (!a || !b || (a.name && b.name)) continue; // already paired above
          pairs.push([a, b]);
        }
      }
    }
    for (const [a, b] of pairs) {
      dispose(F.overlap.pointer(`${at(a)}#${a.id}|${at(b)}#${b.id}#T4b.02`), c2, () => {
        if (layered(a) || layered(b)) return { ok: true, reason: '' };
        const w = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
        const h = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
        const painted = w > MIN_OVERLAP_PX && h > MIN_OVERLAP_PX && w * h > MIN_OVERLAP_AREA;
        return { ok: !painted, reason: `T4b.02 ${at(a)} (node ${a.id}) and ${at(b)} (node ${b.id}) paint over each other by ${w.toFixed(2)}x${h.toFixed(2)}px (${(w * h).toFixed(2)}px^2)` };
      });
    }
  }

  // ---- T4b.03 unintended wrap at the target viewport -------------------------
  // Bands are parent-relative (§3.2.5 change 5), so two children in different bands
  // really did wrap; the old viewport-absolute quantisation could not tell.
  if (readable.has('wrap')) {
    for (const n of nodes) {
      if (n.flexDirection !== 'row') continue;
      const kids = kidsOf.get(n.id) || [];
      if (kids.length < 2) continue;
      dispose(F.wrap.pointer(`${at(n)}#${n.id}#T4b.03`), c3, () => {
        const bands = new Set(kids.map((k) => k.rowBand));
        return {
          ok: bands.size <= 1,
          reason: `T4b.03 ${at(n)} (node ${n.id}) is declared a single row but its ${kids.length} children occupy ${bands.size} y-bands [${[...bands].sort((x, y) => x - y).join(',')}]`,
        };
      });
    }
  }

  // ---- T4b.04 text truncation on labels and captions -------------------------
  if (readable.has('truncation')) {
    for (const n of nodes) {
      if (!TEXT_ROLES.has(n.role)) continue;
      dispose(F.truncation.pointer(`${at(n)}#${n.id}#T4b.04`), c4, () => ({
        ok: n.scroll.w <= n.scroll.cw,
        reason: `T4b.04 ${at(n)} (node ${n.id}) truncates its text: scrollWidth ${n.scroll.w} against clientWidth ${n.scroll.cw}`,
      }));
    }
  }

  return fams.list;
}

/**
 * Tier mutations (§3.5.2). The first four inject one real residue defect each. The rest
 * are the evasions an adversarial pass found: a defect hidden by stripping an ancestor's
 * name, a collision across two subtrees, and a probe inventing a capability key to
 * silence a check. Each must be CAUGHT, not tolerated.
 */
export const mutations = [
  { name: 'a container whose content is taller than its box', covers: ['T4b.01'], expect: 'fail', expectFamily: 'overflow', apply: (/** @type {any} */ c) => { const n = c.probe.nodes.find((/** @type {any} */ x) => x.isContainer && x.name); if (n) n.scroll = { ...n.scroll, h: n.scroll.ch + 47 }; } },
  { name: 'two in-flow siblings painted over each other', covers: ['T4b.02'], expect: 'fail', expectFamily: 'overlap', apply: (/** @type {any} */ c) => { const pair = siblingPair(c.probe); if (pair) pair[1].rect = { ...pair[1].rect, x: pair[0].rect.x, y: pair[0].rect.y + pair[0].rect.h / 2 }; } },
  { name: 'a declared single-row container whose children wrap to a second band', covers: ['T4b.03'], expect: 'fail', expectFamily: 'wrap', apply: (/** @type {any} */ c) => { const n = rowContainer(c.probe); if (n) { const kids = c.probe.nodes.filter((/** @type {any} */ x) => x.parentId === n.id); const last = kids[kids.length - 1]; if (last) { last.rect = { ...last.rect, y: last.rect.y + 42 }; last.rowBand = 3; } } } },
  { name: 'a text node whose content is wider than its box', covers: ['T4b.04'], expect: 'fail', expectFamily: 'truncation', apply: (/** @type {any} */ c) => { const n = c.probe.nodes.find((/** @type {any} */ x) => TEXT_ROLES.has(x.role)); if (n) n.scroll = { ...n.scroll, w: n.scroll.cw + 63 }; } },
  { name: 'a real clip hidden by stripping the one ancestor that named it', covers: [], expect: 'fail', expectFamily: 'overflow', apply: (/** @type {any} */ c) => { const n = c.probe.nodes.find((/** @type {any} */ x) => x.isContainer && !x.name && x.parentId !== null); if (n) { n.scroll = { ...n.scroll, h: n.scroll.ch + 500 }; for (const a of c.probe.nodes) if (a.name) a.name = null; const keep = c.probe.nodes.find((/** @type {any} */ x) => x.id !== n.id && x.isContainer); if (keep) keep.name = 'survivingName'; } } },
  { name: 'two named controls in different subtrees painted on top of each other', covers: [], expect: 'fail', expectFamily: 'overlap', apply: (/** @type {any} */ c) => { const cousins = crossSubtreePair(c.probe); if (cousins) cousins[1].rect = { ...cousins[0].rect }; } },
  { name: 'a probe inventing a capability key to silence a check', covers: [], expect: 'fail', expectFamily: 'instrument', apply: (/** @type {any} */ c) => { c.probe.capabilities = { ...c.probe.capabilities, geometry: false }; } },
  { name: 'the probe captured no data-sha-c-name anywhere', covers: [], expect: 'partial', expectFamily: 'overflow', apply: (/** @type {any} */ c) => { for (const n of c.probe.nodes) n.name = null; } },
];

/** First parent with two in-flow children, for the sibling-overlap mutation. @param {any} probe */
function siblingPair(probe) {
  /** @type {Map<number, any[]>} */
  const kids = new Map();
  for (const n of probe.nodes) {
    if (n.parentId === null || n.parentId === undefined) continue;
    const b = kids.get(n.parentId);
    if (b) b.push(n); else kids.set(n.parentId, [n]);
  }
  for (const ks of kids.values()) {
    if (ks.length >= 2 && ks[0] && ks[1] && !OUT_OF_FLOW.has(ks[0].position) && !OUT_OF_FLOW.has(ks[1].position)) return [ks[0], ks[1]];
  }
  return null;
}

/** First row-flex container with two or more children, for the wrap mutation. @param {any} probe */
function rowContainer(probe) {
  return probe.nodes.find((/** @type {any} */ n) => n.flexDirection === 'row'
    && probe.nodes.filter((/** @type {any} */ x) => x.parentId === n.id).length >= 2) || null;
}

/** Two named nodes with no ancestor relation, for the cross-subtree overlap mutation. @param {any} probe */
function crossSubtreePair(probe) {
  const byId = new Map(probe.nodes.map((/** @type {any} */ n) => [n.id, n]));
  const chain = (/** @type {any} */ n) => { const s = new Set(); let c = byId.get(n.parentId); while (c) { s.add(c.id); c = byId.get(c.parentId); } return s; };
  const named = probe.nodes.filter((/** @type {any} */ n) => n.name);
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const a = named[i]; const b = named[j];
      if (a.parentId === b.parentId) continue;
      if (chain(a).has(b.id) || chain(b).has(a.id)) continue;
      return [a, b];
    }
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--'));
    if (!file) {
      console.error('usage: t4b-residue.mjs <probe.json> [--json]');
      return EXIT.usage;
    }
    const fams = t4bResidue(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(report(fams, { title: id, json: args.includes('--json') }));
    return exitFor(verdictOf(fams));
  }));
}
