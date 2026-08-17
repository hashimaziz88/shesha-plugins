// Filesystem, git and glob helpers shared by the gates.
//
// This module deliberately defines NO coverage counters and no verdictOf: all
// accounting goes through @shesha/registry/coverage (D-005, D-041). Anything
// added here must stay a pure helper.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Directories no gate ever walks. `.claude/worktrees` holds a full duplicate checkout. */
export const NEVER_WALK = new Set([
  'node_modules', '.git', '.build', 'runs', '.sfs-cache', 'worktrees',
]);

/**
 * The repository root, resolved from this file rather than process.cwd(), so a
 * gate behaves identically however it was invoked.
 * @returns {string}
 */
export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

/**
 * Recursively list files under `dir`, skipping NEVER_WALK directories.
 * @param {string} dir
 * @param {{ext?: string[]}} [opts]
 * @returns {string[]} absolute paths
 */
export function listFiles(dir, opts = {}) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  /** @param {string} d */
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (NEVER_WALK.has(entry.name)) continue;
        walk(path.join(d, entry.name));
      } else if (entry.isFile()) {
        if (opts.ext && !opts.ext.some((e) => entry.name.endsWith(e))) continue;
        out.push(path.join(d, entry.name));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Read a UTF-8 text file, stripping a BOM and normalising CRLF to LF.
 *
 * The normalisation is not cosmetic. core.autocrlf=true gives every file in the
 * Windows working tree CRLF endings while git stores LF, so a line-anchored
 * regex written as /^---\n/ silently matches nothing locally and everything in
 * CI. Every gate reads through this function so a rule cannot mean two different
 * things on two platforms.
 * @param {string} file
 * @returns {string|null}
 */
export function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch { return null; }
}

/**
 * Byte length of a file's NORMALISED contents. Caps are measured against this
 * rather than the on-disk size, so a CRLF working tree and an LF CI checkout
 * report the same number for the same content.
 * @param {string} file
 * @returns {number} -1 when absent
 */
export function normalisedByteSize(file) {
  const text = readText(file);
  if (text === null) return -1;
  return Buffer.byteLength(text, 'utf8');
}

/**
 * A machine-local absolute path, anchored so a URL's "s://" is not a drive letter.
 * @param {string} text
 * @returns {string|null}
 */
export function findAbsolutePath(text) {
  const m = /(?:^|[\s"'(\[<`])([A-Za-z]:[\\/])/m.exec(text);
  return m ? m[1] : null;
}

/**
 * @param {string} file
 * @returns {boolean}
 */
export function exists(file) { return fs.existsSync(file); }

/**
 * Byte length of a file's contents, or -1 when absent.
 * @param {string} file
 * @returns {number}
 */
export function byteSize(file) {
  try { return fs.statSync(file).size; } catch { return -1; }
}

/**
 * Line count as authors experience it: a trailing newline does not add a line.
 * @param {string} text
 * @returns {number}
 */
export function lineCount(text) {
  if (text === '') return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

/**
 * Run git and return stdout, or null when git fails.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string|null}
 */
export function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return null; }
}

/**
 * Tracked files matching a pathspec, as repo-relative POSIX paths.
 * @param {string} root
 * @param {string[]} [pathspec]
 * @returns {string[]}
 */
export function gitLsFiles(root, pathspec = []) {
  const out = git(['ls-files', '-z', ...pathspec], root);
  if (out === null) return [];
  return out.split('\0').filter(Boolean);
}

/**
 * Translate a glob into a RegExp. Supports `**`, `*` and `?`; `*` never crosses
 * a path separator, `**` does.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` may match zero segments, so the slash is part of the optional group.
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param {string} glob
 * @param {string} relPath POSIX-separated, repo-relative
 * @returns {boolean}
 */
export function globMatch(glob, relPath) { return globToRegExp(glob).test(relPath); }

/**
 * Repo-relative POSIX path. Forward slashes only, everywhere (D-004's sibling rule).
 * @param {string} root
 * @param {string} abs
 * @returns {string}
 */
export function rel(root, abs) { return path.relative(root, abs).split(path.sep).join('/'); }

/**
 * Immediate subdirectories of `dir`, as names.
 * @param {string} dir
 * @returns {string[]}
 */
export function subdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NEVER_WALK.has(e.name))
    .map((e) => e.name).sort();
}

/**
 * Fenced code blocks in a markdown document, with their line spans.
 * @param {string} text
 * @returns {{startLine:number, endLine:number, lines:number, info:string}[]}
 */
export function fencedBlocks(text) {
  /** @type {{startLine:number, endLine:number, lines:number, info:string}[]} */
  const out = [];
  const lines = text.split('\n');
  /** @type {null|{startLine:number, char:string, len:number, info:string}} */
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!m) continue;
    const marker = m[2];
    if (open === null) {
      open = { startLine: i + 1, char: marker[0], len: marker.length, info: m[3].trim() };
    } else if (marker[0] === open.char && marker.length >= open.len && m[3].trim() === '') {
      // A closing fence matches the opening character and is at least as long, so a
      // 4-backtick block may legally contain 3-backtick blocks.
      out.push({ startLine: open.startLine, endLine: i + 1, lines: i - open.startLine, info: open.info });
      open = null;
    }
  }
  return out;
}
