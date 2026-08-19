// D-072: the plugin version is valid semver and only ever moves forward.
//
// Two clauses, both from D-072. First, a real semver parser must ACCEPT the
// version and REJECT an unseparated prerelease suffix: 1.8.5-alpha.1 is legal,
// 1.8.5alpha1 is not. Second, the version strictly increases — enforced here as a
// non-regression ratchet against a recorded floor, because the mutation harness
// stages files with no git history and cannot read a commit sequence. A WP that
// changes plugins/** raises the floor in the same commit; this gate proves the
// live version never drops below it. A lower floor cannot admit a lower version,
// and a floor above the version fails, so the only direction the version can go
// past this gate is up.
//
// The parser is written here rather than pulled from a dependency: packages that
// gate the tree carry their own small, auditable primitives.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor } from '@shesha/registry/coverage';
import { repoRoot, readText } from '../lib/fsx.mjs';

export const id = 'g-plugin-version';
export const describe = 'the plugin version is valid semver (dot-separated prerelease) and never regresses below its recorded floor (D-072)';
export const inputPaths = [
  'plugins/shesha-developer/.claude-plugin/plugin.json',
  'packages/verify/config/plugin-version.json',
];

/** The official semver.org grammar. An unseparated prerelease suffix does not match. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Parse a strict semver string into its comparable parts, or null when invalid.
 * @param {string} v
 * @returns {{major:number, minor:number, patch:number, pre:string[]}|null}
 */
export function parseSemver(v) {
  const m = typeof v === 'string' ? SEMVER.exec(v) : null;
  if (!m) return null;
  return {
    major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  };
}

/**
 * Semver precedence. Returns negative / 0 / positive for a < / = / > b.
 * A version WITH a prerelease has LOWER precedence than the same without one.
 * @param {{major:number,minor:number,patch:number,pre:string[]}} a
 * @param {{major:number,minor:number,patch:number,pre:string[]}} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;   // release > prerelease
  if (b.pre.length === 0) return -1;
  const n = Math.min(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    // In-bounds: i < n = min(a.pre.length, b.pre.length), so both entries are defined.
    const x = /** @type {string} */ (a.pre[i]), y = /** @type {string} */ (b.pre[i]);
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { const d = Number(x) - Number(y); if (d !== 0) return d; }
    else if (xn !== yn) return xn ? -1 : 1; // numeric identifiers rank below alphanumeric
    else if (x !== y) return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'version', unit: 'field' }]);
  const fam = fams.get('version');

  const pluginText = readText(path.join(root, 'plugins/shesha-developer/.claude-plugin/plugin.json'));
  const floorText = readText(path.join(root, 'packages/verify/config/plugin-version.json'));

  /** @type {string|null} */ let versionRaw = null;
  /** @type {string|null} */ let floorRaw = null;
  try { versionRaw = pluginText === null ? null : JSON.parse(pluginText).version; } catch { versionRaw = null; }
  try { floorRaw = floorText === null ? null : JSON.parse(floorText).floor; } catch { floorRaw = null; }

  const version = parseSemver(String(versionRaw));
  const floor = parseSemver(String(floorRaw));

  fam.pointer('semver').assert(version !== null,
    `plugin version "${versionRaw}" is not valid semver — a prerelease suffix must be dot-separated (1.8.5-alpha.1, never 1.8.5alpha1)`);
  fam.pointer('floor-semver').assert(floor !== null,
    `recorded floor "${floorRaw}" in plugin-version.json is not valid semver`);

  if (version && floor) {
    fam.pointer('monotonic').assert(compareSemver(version, floor) >= 0,
      `plugin version ${versionRaw} has regressed below the recorded floor ${floorRaw}`);
  } else {
    // Cannot compare what did not parse; the parse failures above already fail.
    fam.pointer('monotonic').fail('cannot compare versions: one of version/floor did not parse');
  }

  return fams.list;
}

/**
 * Rewrite one JSON field in a staged file.
 * @param {string} tmp @param {string} relFile @param {string} key @param {string} value
 */
function setField(tmp, relFile, key, value) {
  const f = path.join(tmp, relFile);
  const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
  obj[key] = value;
  fs.writeFileSync(f, `${JSON.stringify(obj, null, 2)}\n`);
}

const PLUGIN = 'plugins/shesha-developer/.claude-plugin/plugin.json';
const FLOOR = 'packages/verify/config/plugin-version.json';

export const mutations = [
  {
    name: 'the version carries an unseparated prerelease suffix',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { setField(tmp, PLUGIN, 'version', '1.9.0alpha1'); },
    expect: 'fail',
  },
  {
    name: 'the version regresses below the recorded floor',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { setField(tmp, PLUGIN, 'version', '1.8.0'); },
    expect: 'fail',
  },
  {
    name: 'the floor is raised above the current version',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { setField(tmp, FLOOR, 'floor', '2.0.0'); },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fams = await run({ repoRoot: repoRoot() });
  console.log(report(fams, { title: id }));
  process.exit(exitFor(verdictOf(fams)));
}
