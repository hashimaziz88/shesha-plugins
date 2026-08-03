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
// Usage: node scripts/check-doc-links.mjs
// Exit 0 with a count summary if every link resolves; exit 1 listing every
// `file:line -> broken target` otherwise.

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

if (broken.length) {
  console.error(`Found ${broken.length} broken relative markdown link(s):\n`);
  for (const entry of broken) console.error(`  ${entry}`);
  process.exit(1);
}

console.log(`check-doc-links: scanned ${mdFiles.length} .md file(s), ${checked} relative link(s), 0 broken.`);
process.exit(0);
