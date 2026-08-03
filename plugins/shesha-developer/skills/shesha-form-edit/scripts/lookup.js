#!/usr/bin/env node
/**
 * lookup.js — mandatory retrieval router for shesha-form-edit.
 *
 * Usage:
 *   node scripts/lookup.js <query> [<query> ...]
 *   node scripts/lookup.js --plan <form.json>      # resolve every component type in a markup file
 *
 * Queries match (case-insensitive): component types, topics, symptoms (substring).
 * Prints, per hit: the reference files to read, bundled assets, always-apply rules.
 * Exit 1 if any query has NO hit — an unknown component type must be checked
 * against assets/groups/index.json before authoring.
 *
 * A miss that assets/component-registry.json KNOWS as a non-authorable component is
 * answered rather than dismissed: the registry's authorableReason plus one line of
 * guidance says WHY the router has no route for it. Still exit 1 — the answer is
 * "don't author this", not "here is how".
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOOKUP = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', '_lookup.json'), 'utf8'));

// The typed registry says what EXISTS; it does NOT say what renders (that is
// assets/measured-capability-matrix.json + R-053). Here it is used for one thing
// only: turning a bare UNRESOLVED into a reasoned answer. Absent → old behaviour.
const REGISTRY = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'component-registry.json'), 'utf8').replace(/^﻿/, '')); }
  catch { return null; }
})();

// One line of guidance per registry reason. Each says what to do INSTEAD, because a
// non-authorable type is a routing dead end, not a gap in the reference set.
const REASON_GUIDANCE = {
  'hidden': 'the renderer marks this component definition isHidden — it is not in the designer toolbox at all; it only ever appears as machinery inside another component.',
  'no-settings-form': 'the component ships no settings form, so it has no authorable props — it exists only as a preset/template another component instantiates. Author the component it wraps instead (e.g. datatable inside a dataContext) and configure that.',
  'not-in-toolbox-allowlist': 'the type is real but outside this skill\'s toolbox allowlist (assets/groups/index.json) — nothing in the pipeline types or gates it. Pick an allowlisted equivalent, or add it to the allowlist deliberately and regenerate.',
};

/** Answer a miss from the registry. Returns true when it could. */
function explainFromRegistry(q) {
  const entry = REGISTRY?.components?.[q]
    ?? Object.values(REGISTRY?.components ?? {}).find((c) => String(c.type).toLowerCase() === q.toLowerCase());
  if (!entry || entry.authorable !== false) return false;
  const reason = entry.authorableReason ?? 'unknown';
  console.log(`## ${q}  →  registry: NOT AUTHORABLE (${reason})`);
  console.log(`   component: ${entry.name} (${entry.type})${entry.hostsChildren ? ' — hosts children' : ''}`);
  console.log(`   why: ${REASON_GUIDANCE[reason] ?? 'the registry records it as non-authorable without a reason code.'}`);
  console.log(`   registry: assets/component-registry.json (props: ${entry.props.length}, typed: ${Object.keys(entry.propTypes ?? {}).length})`);
  console.log('');
  return true;
}

function collectTypes(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out));
  if (typeof node.type === 'string' && typeof node.id === 'string' && node.id.length >= 8) out.add(node.type); // real components carry a uuid id; style objects also have a "type" key
  for (const k of Object.keys(node)) collectTypes(node[k], out);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: lookup.js <componentType|topic|symptom> ... | --plan <form.json>');
  process.exit(1);
}

let queries = [];
if (args[0] === '--plan') {
  const markup = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const types = new Set();
  collectTypes(markup, types);
  queries = [...types];
  console.log(`# lookup --plan: ${queries.length} component types found in ${args[1]}\n`);
} else {
  queries = args;
}

const files = new Set();
const assets = new Set();
const rules = new Set();
let misses = [];
const explained = [];   // misses the registry could account for

for (const q of queries) {
  const ql = q.toLowerCase();
  let hit = null;
  let kind = null;
  for (const [k, v] of Object.entries(LOOKUP.componentTypes)) {
    if (k.toLowerCase() === ql) { hit = v; kind = `component:${k}`; break; }
  }
  if (!hit) for (const [k, v] of Object.entries(LOOKUP.topics)) {
    if (k === ql || ql.includes(k)) { hit = v; kind = `topic:${k}`; break; }
  }
  if (!hit) for (const [k, v] of Object.entries(LOOKUP.symptoms)) {
    if (ql.includes(k) || k.includes(ql)) { hit = v; kind = `symptom:${k}`; break; }
  }
  if (!hit) {
    misses.push(q);
    if (explainFromRegistry(q)) explained.push(q);
    continue;
  }

  console.log(`## ${q}  →  ${kind}`);
  (hit.files || []).forEach((f) => { files.add(f); console.log(`   read: references/${f}`); });
  (hit.assets || []).forEach((a) => { assets.add(a); console.log(`   asset: assets/${a}`); });
  (hit.scripts || []).forEach((s) => console.log(`   script: scripts/${s}`));
  if (hit.kb) console.log(`   kb: assets/components-kb/${q}.json (settings shape + current version)`);
  if (hit.handoff) console.log(`   handoff: Skill(${hit.handoff})`);
  if (hit.hint) console.log(`   hint: ${hit.hint}`);
  (hit.rules || []).forEach((r) => { rules.add(r); });
  console.log('');
}

if (rules.size) {
  console.log('# ALWAYS-APPLY RULES for this authoring pass');
  [...rules].forEach((r) => console.log(`- ${r}`));
  console.log('');
}
console.log(`# summary: ${files.size} reference files, ${assets.size} assets, ${rules.size} rules, ${misses.length} unresolved${explained.length ? ` (${explained.length} answered from the registry as non-authorable)` : ''}`);
if (misses.length) {
  // An explained miss is still a miss (exit 1 — nothing here is authorable), but it
  // is reported as a verdict, not as a hole in the reference set.
  const unexplained = misses.filter((q) => !explained.includes(q));
  if (explained.length) {
    console.error(`\nNOT AUTHORABLE (registry answered — see above, do not author these): ${explained.join(', ')}`);
  }
  if (unexplained.length) {
    console.error(`\nUNRESOLVED (check assets/groups/index.json allowlist before authoring): ${unexplained.join(', ')}`);
  }
  process.exit(1);
}
