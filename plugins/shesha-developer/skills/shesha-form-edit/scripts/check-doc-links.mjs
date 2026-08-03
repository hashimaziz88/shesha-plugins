#!/usr/bin/env node
// check-doc-links.mjs — verifies every relative markdown link in the plugin's
// .md files resolves to a real file on disk. Catches stale citations left
// behind when docs are moved, renamed, or deleted.
//
// Scans all .md files under plugins/shesha-developer/{skills,agents,commands}.
// For each `](target)` link (skipping http(s)/mailto/#anchor links):
//   - a target starting with `plugins/` is resolved repo-root-relative
//   - any other relative target is resolved relative to the citing file's dir
// Anchors and query strings on the target are stripped before resolution.
//
// ALSO checks the designer doc family (shesha-form-edit / shesha-claude-designer
// / shesha-design-comprehension / shesha-design-system / agents / the two
// shesha-build/shesha-audit commands / hooks/scripts) for stale numbered
// "Step N" cross-references. The two canonical files that actually define
// numbered steps (shesha-form-edit/SKILL.md, shesha-claude-designer/SKILL.md)
// are exempt; every other file in that family must cite step NAMES.
//
// Usage: node scripts/check-doc-links.mjs
// Exit 0 with a count summary if every link resolves and no stale step
// references are found; exit 1 listing every finding otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..'); // plugins/shesha-developer
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..'); // repo root (contains plugins/)

const SCAN_DIRS = ['skills', 'agents', 'commands'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);

const LINK_RE = /\]\(([^)]+)\)/g;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isSkippable(target) {
  if (!target) return true;
  if (/^(https?:|mailto:)/i.test(target)) return true;
  if (target.startsWith('#')) return true;
  return false;
}

function stripAnchorAndQuery(target) {
  return target.split('#')[0].split('?')[0];
}

const mdFiles = [];
for (const dir of SCAN_DIRS) {
  walk(path.join(PLUGIN_ROOT, dir), mdFiles);
}

const broken = [];
let checked = 0;

for (const filePath of mdFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip fenced code blocks (```...```) entirely — they may contain regex
    // literals or example syntax like `](url)` that isn't a real doc link.
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    // Strip inline code spans (`...`) — same rationale, single-line only.
    const stripped = line.replace(/`[^`]*`/g, '');

    let match;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(stripped))) {
      const rawTarget = match[1].trim();
      if (isSkippable(rawTarget)) continue;
      const cleanTarget = stripAnchorAndQuery(rawTarget);
      if (!cleanTarget) continue;

      checked++;
      let resolved;
      if (cleanTarget.startsWith('plugins/')) {
        resolved = path.join(REPO_ROOT, cleanTarget);
      } else if (path.isAbsolute(cleanTarget)) {
        resolved = cleanTarget;
      } else {
        resolved = path.resolve(path.dirname(filePath), cleanTarget);
      }

      if (!fs.existsSync(resolved)) {
        const relFile = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
        broken.push(`${relFile}:${i + 1} -> ${rawTarget}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step-number staleness check (designer doc family only)
//
// This family used to cross-reference numbered "Step N" steps from the two
// SKILL.mds; those numbers drift every time either SKILL.md is renumbered.
// Canon: cite step NAMES (e.g. "the Gates step", "the Pre-flight step"),
// never bare numbers, everywhere outside the two files that own the numbering.

const STEP_FAMILY_DIRS = [
  'skills/shesha-form-edit',
  'skills/shesha-claude-designer',
  'skills/shesha-design-comprehension',
  'skills/shesha-design-system',
  'agents',
];
const STEP_FAMILY_EXTRA_DIRS = ['hooks/scripts']; // .cjs files
const STEP_FAMILY_SINGLE_FILES = [
  'commands/shesha-build.md',
  'commands/shesha-audit.md',
];
const STEP_FAMILY_EXCLUDE = new Set([
  'skills/shesha-form-edit/SKILL.md',
  'skills/shesha-claude-designer/SKILL.md',
]);

const STEP_RE = /\bStep\s+[0-9]+(?:\.[0-9]+)?\b/g;
// Exempt citations of the two canonical SKILL.md's own numbering, e.g.
// "shesha-claude-designer/SKILL.md Step 4" or "...SKILL.md) Step 4" — these
// name a step in the file that legitimately owns numbering, not a stale
// in-place reference to be fixed here.
const ALLOWED_CITATION_RE = /SKILL\.md[^A-Za-z0-9]{0,3}Step\s+[0-9]+(?:\.[0-9]+)?\b/g;

function collectFiles(relDir, extList, out) {
  const abs = path.join(PLUGIN_ROOT, relDir);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const relPath = path.join(relDir, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectFiles(relPath, extList, out);
    } else if (entry.isFile() && extList.some((ext) => entry.name.endsWith(ext))) {
      out.push(relPath);
    }
  }
}

const stepFamilyFiles = [];
for (const dir of STEP_FAMILY_DIRS) collectFiles(dir, ['.md'], stepFamilyFiles);
for (const dir of STEP_FAMILY_EXTRA_DIRS) collectFiles(dir, ['.cjs'], stepFamilyFiles);
for (const f of STEP_FAMILY_SINGLE_FILES) {
  if (fs.existsSync(path.join(PLUGIN_ROOT, f))) stepFamilyFiles.push(f);
}

const staleSteps = [];
for (const relPath of stepFamilyFiles) {
  if (STEP_FAMILY_EXCLUDE.has(relPath)) continue;
  const isMd = relPath.endsWith('.md');
  const fileContent = fs.readFileSync(path.join(PLUGIN_ROOT, relPath), 'utf8');
  const fileLines = fileContent.split('\n');
  let stepInFence = false;
  for (let i = 0; i < fileLines.length; i++) {
    const rawLine = fileLines[i];
    if (isMd) {
      if (/^\s*```/.test(rawLine)) { stepInFence = !stepInFence; continue; }
      if (stepInFence) continue;
    }
    // Strip inline code spans on .md files (same rationale as the link check
    // above); .cjs files are scanned as-is (the known hit is a `//` comment).
    const scanLine = isMd ? rawLine.replace(/`[^`]*`/g, '') : rawLine;
    const masked = scanLine.replace(ALLOWED_CITATION_RE, (m) => '#'.repeat(m.length));
    STEP_RE.lastIndex = 0;
    let stepMatch;
    while ((stepMatch = STEP_RE.exec(masked))) {
      staleSteps.push(`${relPath}:${i + 1} -> "${stepMatch[0]}"`);
    }
  }
}

if (broken.length || staleSteps.length) {
  if (broken.length) {
    console.error(`Found ${broken.length} broken relative markdown link(s):\n`);
    for (const entry of broken) console.error(`  ${entry}`);
  }
  if (staleSteps.length) {
    console.error(`\nFound ${staleSteps.length} stale numbered-step reference(s) in the designer doc family:\n`);
    for (const entry of staleSteps) console.error(`  ${entry}`);
    console.error(
      '\nCite step NAMES (e.g. "the Gates step"), not numbers — numbering lives only in ' +
      'shesha-form-edit/SKILL.md and shesha-claude-designer/SKILL.md.'
    );
  }
  process.exit(1);
}

console.log(
  `check-doc-links: scanned ${mdFiles.length} .md file(s), ${checked} relative link(s), 0 broken; ` +
  `${stepFamilyFiles.length} designer doc-family file(s) scanned for stale step numbers, 0 found.`
);
process.exit(0);
