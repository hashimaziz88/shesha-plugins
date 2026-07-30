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
 * against assets/components-kb/_index.json before authoring.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOOKUP = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', '_lookup.json'), 'utf8'));

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
  if (!hit) { misses.push(q); continue; }

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
console.log(`# summary: ${files.size} reference files, ${assets.size} assets, ${rules.size} rules, ${misses.length} unresolved`);
if (misses.length) {
  console.error(`\nUNRESOLVED (check assets/components-kb/_index.json allowlist before authoring): ${misses.join(', ')}`);
  process.exit(1);
}
