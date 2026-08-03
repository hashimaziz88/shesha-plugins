#!/usr/bin/env node
// Regenerates references/non-negotiables.md from references/_rules.json.
// _rules.json is the single source of mechanical fact; this file is only a
// reading-order index (one line per rule: id + one-sentence gist) so prose
// docs can cite [R-xxx] without restating the mechanic. Deterministic —
// rerun after any _rules.json edit; `git diff` should show only the intended
// rule change.
//
// Usage: node generate-non-negotiables.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(SCRIPT_DIR, '..', 'references', '_rules.json');
const OUT = path.join(SCRIPT_DIR, '..', 'references', 'non-negotiables.md');

const registry = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
const rules = registry.rules;

// Reading order + display heading for each rule group. 'api' and 'process'
// share one heading (they read as one topic in prose); any group not listed
// here still renders, appended at the end in encounter order.
const GROUP_HEADINGS = [
  { groups: ['structure'], heading: 'Structure' },
  { groups: ['binding'], heading: 'Binding' },
  { groups: ['data'], heading: 'Data' },
  { groups: ['actions'], heading: 'Actions' },
  { groups: ['scripts'], heading: 'Scripts' },
  { groups: ['styling'], heading: 'Styling' },
  { groups: ['security'], heading: 'Security' },
  { groups: ['api', 'process'], heading: 'API / process' },
  { groups: ['versioning'], heading: 'Versioning' },
];

const byGroup = new Map();
for (const rule of rules) {
  const list = byGroup.get(rule.group) ?? [];
  list.push(rule);
  byGroup.set(rule.group, list);
}

const coveredGroups = new Set(GROUP_HEADINGS.flatMap((section) => section.groups));
for (const group of byGroup.keys()) {
  if (!coveredGroups.has(group)) {
    GROUP_HEADINGS.push({ groups: [group], heading: group[0].toUpperCase() + group.slice(1) });
  }
}

function gist(rule) {
  // One-sentence gist = the statement's first sentence, trimmed.
  const firstSentence = rule.statement.split(/(?<=[.!?])\s+/)[0];
  return `[${rule.id}] ${firstSentence.replace(/\.$/, '')}`;
}

const lines = [];
lines.push('# Non-negotiables — index of the rule registry');
lines.push('');
lines.push('**GENERATED — do not hand-edit.** Regenerate with');
lines.push('`node scripts/generate-non-negotiables.js` after any `_rules.json` change.');
lines.push('');
lines.push('**`_rules.json` is the single source; validators cite these ids; this file is');
lines.push('only a reading order.** Each line below is the one-line gist — the full');
lines.push('statement (and the failure it prevents) lives in the registry entry.');

for (const section of GROUP_HEADINGS) {
  const sectionRules = section.groups.flatMap((g) => byGroup.get(g) ?? []);
  if (sectionRules.length === 0) continue;
  lines.push('');
  lines.push(`## ${section.heading}`);
  lines.push(`- ${sectionRules.map(gist).join(' · ')}`);
}

lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`Wrote ${OUT} (${rules.length} rules, ${GROUP_HEADINGS.filter((s) => s.groups.some((g) => byGroup.has(g))).length} sections)`);
