#!/usr/bin/env node
// §4.3.5: every push-admission rule lives here, not in the gate-push hook. The hook
// only detects a push and maps this program's exit code; admission is a program that
// imports coverage.mjs, so the rules are unit-testable without a hook and there is
// exactly one implementation. Exit 0 admissible · 1 refused · 2 usage.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import addFormatsMod from 'ajv-formats';
import { pushAdmissible } from '@shesha/registry/coverage';

const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);
const addFormats = /** @type {any} */ (/** @type {any} */ (addFormatsMod).default ?? addFormatsMod);
const EXIT = { admissible: 0, refused: 1, usage: 2 };
const THIRTY_MIN = 30 * 60 * 1000;

/** @param {string[]} args @param {string} flag @returns {string|undefined} */
function argValue(args, flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
/** @param {Buffer|string} buf @returns {string} */
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
/** @param {string} p @returns {any} */
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } }
/** @returns {string} */
function repoRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); }

let _validateVerdict = /** @type {any} */ (null);
/** Compile verdict.schema.json once, from this module's repo (never the run dir). @param {any} verdict @returns {string[]} */
export function verdictDiagnostics(verdict) {
  if (!_validateVerdict) {
    const schema = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'packages/sfs/schema/verdict.schema.json'), 'utf8').replace(/^﻿/, ''));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    _validateVerdict = ajv.compile(schema);
  }
  const ok = !!_validateVerdict(verdict);
  return ok ? [] : (_validateVerdict.errors || []).map((/** @type {any} */ e) => `${e.instancePath || '/'} ${e.message}`.trim());
}

/** The set of component `type` strings present in a compiled artifact. @param {any} form @returns {Set<string>} */
export function componentTypes(form) {
  /** @type {Set<string>} */
  const set = new Set();
  if (!form) return set;
  let markup = form.Markup ?? form.components ?? form;
  if (typeof markup === 'string') { try { markup = JSON.parse(markup); } catch { return set; } }
  /** @param {any} n */
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') { if (typeof n.type === 'string') set.add(n.type); for (const k of Object.keys(n)) walk(n[k]); }
  };
  walk(markup);
  return set;
}

/**
 * The P0–P9 admission decision (§4.3.5). Pure over the filesystem + clock passed in,
 * so the test drives it in-process against temp run dirs.
 * @param {{root:string, runId?:string, screen?:string, allowPartial?:boolean, target?:string|null, now:number}} o
 * @returns {{admissible:boolean, code:string, reason:string}}
 */
export function admit(o) {
  const { root, runId, screen, allowPartial = false, target = null, now } = o;
  /** @param {string} code @param {string} reason */
  const R = (code, reason) => ({ admissible: false, code, reason });
  // P0
  if (!runId || !screen) return R('HOOK-0301', 'push must name a run and a screen');
  const runDir = path.join(root, 'runs', runId);
  const sdir = path.join(runDir, 'screens');
  const formPath = path.join(sdir, `${screen}.form.json`);
  // P1
  if (!fs.existsSync(formPath)) return R('HOOK-0302', 'no compiled artifact');
  const formSha = sha256(fs.readFileSync(formPath));
  // P2
  const compile = readJson(path.join(sdir, `${screen}.compile.json`));
  if (!compile || (compile.verdict !== 'pass' && compile.verdict !== 'partial')) return R('HOOK-0303', 'compile report is missing or its verdict is not pass/partial');
  // P3
  if (compile.markupSha256 !== formSha) return R('HOOK-0304', 'compiled artifact has been modified since compile');
  // P4
  const verdict = readJson(path.join(sdir, `${screen}.verdict.json`));
  if (!verdict) return R('HOOK-0305', 'no sealed verdict');
  const diag = verdictDiagnostics(verdict);
  if (diag.length || !verdict.sealedAt) return R('HOOK-0305', diag[0] || 'no sealed verdict');
  // P5
  if (!verdict.inputs || verdict.inputs.formSha256 !== formSha) return R('HOOK-0306', 'verdict does not correspond to this artifact');
  // P5a
  const backend = (verdict.tiers && verdict.tiers.T3 && verdict.tiers.T3.backend) ?? null;
  if (now - Date.parse(verdict.sealedAt) > THIRTY_MIN || backend !== (target ?? null)) {
    return R('HOOK-0312', 'verdict was produced against a different backend or is stale');
  }
  // P6
  const present = componentTypes(readJson(formPath));
  const adm = pushAdmissible(verdict, { allowPartial, present });
  if (!adm.ok) return R('HOOK-0307', `T1-T3 not admissible: ${adm.tier}=${adm.result} (${adm.reason || ''})`);
  // P7
  const must = (verdict.findings || []).filter((/** @type {any} */ f) => f.severity === 'must');
  if (must.length) return R('HOOK-0308', `${must.length} must-findings outstanding: ${must.map((/** @type {any} */ f) => f.code).join(',')}`);
  // P8
  for (const [name, fam] of Object.entries(/** @type {Record<string, any>} */ (verdict.coverage || {}))) {
    if (fam.required && !(fam.walked > 0)) return R('HOOK-0309', `zero coverage on ${name}`);
    if (fam.walked > 0 && fam.checked === 0) return R('HOOK-0309', `zero coverage on ${name}`);
  }
  // P9
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const state = manifest && manifest.screens && manifest.screens[screen] ? manifest.screens[screen].state : undefined;
  if (state !== 'verified') return R('HOOK-0310', `state is ${state}, expected verified`);
  return { admissible: true, code: '', reason: '' };
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const args = argv.slice(2);
  const runId = argValue(args, '--run');
  const screen = argValue(args, '--screen');
  const asJson = args.includes('--json');
  if (!runId && !screen && !asJson) {
    console.error('usage: push-admissible --run <id> --screen <s> [--allow-partial] [--target <url>] [--json]');
    return EXIT.usage;
  }
  const root = argValue(args, '--root') ?? repoRoot();
  const nowArg = argValue(args, '--now');
  const r = admit({
    root, runId, screen, allowPartial: args.includes('--allow-partial'),
    target: argValue(args, '--target') ?? null, now: nowArg ? Date.parse(nowArg) : Date.now(),
  });
  if (asJson) console.log(JSON.stringify({ admissible: r.admissible, code: r.code, reason: r.reason }));
  else console.log(r.admissible ? 'admissible' : `refused: ${r.code} ${r.reason}`);
  return r.admissible ? EXIT.admissible : EXIT.refused;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
