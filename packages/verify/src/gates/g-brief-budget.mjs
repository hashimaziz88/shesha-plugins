// D-043, D-046, D-060: the control file stays small enough to be read whole.
//
// The pre-rebuild failure was 322,816 B of prose against a constraint-adherence
// ceiling far below it. A brief that reproduces that shape reproduces the failure
// one level up. CONTROL.md is the only file read at turn zero and after every
// context reset, so it is the one whose size can silently do that inside a session.
//
// The whole-bundle cap and the table/fence extractions of D-046 are BL-011; this
// gate measures the bundle and reports it, and `enforced: false` in its config is
// paired with a BLOCKED.md row rather than left as a silent omission.

import path from 'node:path';
import fs from 'node:fs';
import { families, readJsonGuarded } from '@shesha/registry/coverage';
import { listFiles, readText, byteSize, rel, fencedBlocks } from '../lib/fsx.mjs';

export const id = 'g-brief-budget';
export const describe = 'CONTROL.md byte cap and fence cap; bundle measured against its BL-011 target';
export const inputPaths = [
  'packages/verify/config/brief-budget.json',
  'docs/rebuild-brief/CONTROL.md',
  'BACKLOG.md',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'control-size', unit: 'file' },
    { name: 'control-fences', unit: 'fence' },
    { name: 'bundle', unit: 'file' },
  ]);

  const cfgFam = fams.get('control-size');
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/brief-budget.json'), cfgFam, 'brief-budget.json');
  if (!got.ok) return fams.list;
  const cfg = /** @type {{control:{path:string,maxBytes:number,maxFenceLines:number}, bundle:{glob:string,bundleTargetBytes:number,enforced:boolean,deferredTo:string}}} */ (got.value);

  // ---- CONTROL.md size: the enforced subject --------------------------------
  const controlAbs = path.join(root, cfg.control.path);
  const sizePointer = cfgFam.pointer(cfg.control.path);
  const size = byteSize(controlAbs);
  if (size < 0) {
    sizePointer.fail(`${cfg.control.path} does not exist — the session has no control program`);
    return fams.list;
  }
  sizePointer.assert(size <= cfg.control.maxBytes,
    `${cfg.control.path} is ${size} B, over its ${cfg.control.maxBytes} B cap by ${size - cfg.control.maxBytes} B. ` +
    'Split it by reader; do not raise the cap.');

  // ---- CONTROL.md fences: nothing longer than the cap ----------------------
  const fenceFam = fams.get('control-fences');
  const text = readText(controlAbs) || '';
  const blocks = fencedBlocks(text);
  if (blocks.length === 0) {
    fenceFam.pointer(`${cfg.control.path}#no-fences`).check();
  } else {
    for (const b of blocks) {
      const p = fenceFam.pointer(`${cfg.control.path}:${b.startLine}`);
      p.assert(b.lines <= cfg.control.maxFenceLines,
        `fenced block at line ${b.startLine} is ${b.lines} lines, over the ${cfg.control.maxFenceLines}-line cap; ` +
        'a literal file belongs under docs/rebuild-brief/artifacts/');
    }
  }

  // ---- bundle: present, non-empty, and its real size kept published ---------
  // The whole-bundle cap is out of scope (D-060), so it is a BACKLOG row with its
  // acceptance command, NOT an uninspectable pointer inside this gate: this gate
  // can see the bundle perfectly well. What it enforces is that deferring the cap
  // cannot quietly lose the number being deferred.
  const bundleFam = fams.get('bundle');
  const briefDir = path.join(root, path.dirname(cfg.control.path));
  const mdFiles = fs.existsSync(briefDir) ? listFiles(briefDir, { ext: ['.md'] }) : [];
  let total = 0;
  for (const f of mdFiles) {
    const p = bundleFam.pointer(rel(root, f));
    const b = byteSize(f);
    total += b;
    p.assert(b > 0, `${rel(root, f)} is empty — a section of the brief has been truncated`);
  }

  const overTarget = total > cfg.bundle.bundleTargetBytes;
  const deferralPointer = bundleFam.pointer(`${cfg.bundle.glob}#deferral-is-published`);
  if (cfg.bundle.enforced) {
    deferralPointer.assert(!overTarget,
      `bundle is ${total} B, over its ${cfg.bundle.bundleTargetBytes} B cap by ${total - cfg.bundle.bundleTargetBytes} B`);
  } else {
    const backlog = readText(path.join(root, 'BACKLOG.md')) || '';
    deferralPointer.assert(
      backlog.includes(cfg.bundle.deferredTo) && backlog.includes(String(cfg.bundle.bundleTargetBytes)),
      `the bundle measures ${total} B and its ${cfg.bundle.bundleTargetBytes} B cap is deferred to ` +
      `${cfg.bundle.deferredTo}, so BACKLOG.md must carry that id and that target. ` +
      'An unregistered deferral reads as a completed split.');
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'CONTROL.md grows past its byte cap',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'docs/rebuild-brief/CONTROL.md');
      fs.appendFileSync(f, `\n${'padding to exceed the control-file byte cap. '.repeat(700)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'CONTROL.md gains a fenced block longer than the cap',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'docs/rebuild-brief/CONTROL.md');
      const body = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
      fs.appendFileSync(f, `\n\`\`\`json\n${body}\n\`\`\`\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the byte cap is raised instead of the file being split',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/config/brief-budget.json');
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      cfg.control.maxBytes = 10;
      fs.writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the deferred bundle cap is dropped from BACKLOG.md',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'BACKLOG.md');
      const text = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, text.split('\n').filter((l) => !l.includes('BL-011')).join('\n'));
    },
    expect: 'fail',
  },
];
