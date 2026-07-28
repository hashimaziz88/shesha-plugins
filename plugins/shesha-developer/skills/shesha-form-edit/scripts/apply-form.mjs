#!/usr/bin/env node
/**
 * apply-form.mjs — THE ONLY SUPPORTED WAY TO CHANGE THE BACKEND.
 *
 * Build is pure (compile-blueprint.js, offline). Apply mutates. This is apply.
 *
 * One command performs the whole sequence and records what happened:
 *   stage → validate → snapshot prior markup → push → re-fetch → canonical diff
 *         → render → write a content-addressed evidence bundle
 *
 * The evidence bundle is the deliverable, not the console output. It is keyed by the
 * sha256 of the markup that was pushed, so it cannot be transplanted from another run,
 * and the Stop hook verifies it rather than trusting a summary. Nothing hand-authors the
 * ledger: this script is the only writer.
 *
 *   node scripts/apply-form.mjs --form <compiled.json> --module <mod> --name <form>
 *        [--backend <url>] [--token-file <path>] [--evidence-dir <dir>]
 *        [--allow-theme-change]   required when the push alters app-level theme settings
 *        [--no-browser]           skip the render step, recorded as not-verified
 *        [--dry-run]              do everything except the mutation
 *
 * Exit 0 only when the push landed AND the re-fetch matches. Anything else exits non-zero
 * with the reason, and the bundle records the failure rather than being omitted.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GymApi } from './gym-lib/api.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const args = process.argv.slice(2);
const argVal = (flag, dflt = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (flag) => args.includes(flag);

const formFile = argVal('--form');
const moduleName = argVal('--module');
const formName = argVal('--name');
if (!formFile || !moduleName || !formName) {
  console.error('usage: node scripts/apply-form.mjs --form <compiled.json> --module <mod> --name <form> [--backend url] [--token-file path] [--evidence-dir dir] [--allow-theme-change] [--no-browser] [--dry-run]');
  process.exit(2);
}

const backend = argVal('--backend', process.env.SHESHA_BACKEND ?? 'http://localhost:21021');
const evidenceDir = argVal('--evidence-dir', path.join(SKILL_DIR, 'evidence'));
const dryRun = has('--dry-run');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Server-side normalisations that are not real differences. */
function canonical(markup) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        const val = v[k];
        if (val === null || val === undefined) continue;          // null → undefined round-trip
        if (k === 'stylingBox' && typeof val === 'string') {
          try { out[k] = JSON.stringify(JSON.parse(val)); continue; } catch { /* leave as-is */ }
        }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(markup));
}

function diffPaths(a, b, trail = '', out = []) {
  if (out.length > 40) return out;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) { out.push(`${trail}: ${ta} → ${tb}`); return out; }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      diffPaths(a?.[k], b?.[k], trail ? `${trail}.${k}` : k, out);
    }
  } else if (ta === 'array') {
    if (a.length !== b.length) out.push(`${trail}.length: ${a.length} → ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${trail}[${i}]`, out);
  } else if (a !== b) {
    out.push(`${trail}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  return out;
}

const evidence = {
  $schema: 'shesha-apply-evidence/v1',
  form: { module: moduleName, name: formName, id: null },
  backend,
  startedAt: new Date().toISOString(),
  dryRun,
  markupSha256: null,
  steps: [],
  status: 'incomplete',
};
const step = (name, ok, detail) => {
  evidence.steps.push({ step: name, ok, detail, at: new Date().toISOString() });
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

/** The push ledger the Stop hook reads. Written ONLY here — never hand-authored. */
function recordLedger(evidenceFile, bundleDigest) {
  const ledgerPath = path.join(process.cwd(), '.claude', 'cache', 'shesha-form-edit', 'push-ledger.json');
  let ledger = { $schema: 'shesha-push-ledger/v2', entries: [] };
  try {
    const prior = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (Array.isArray(prior?.entries)) ledger = prior;
  } catch { /* first entry this session */ }

  const key = `${moduleName}/${formName}`;
  ledger.entries = (ledger.entries ?? []).filter((e) => `${e.module}/${e.form}` !== key);
  ledger.entries.push({
    module: moduleName,
    form: formName,
    id: evidence.form.id,
    status: evidence.status,
    markupSha256: evidence.markupSha256,
    evidence: evidenceFile,
    evidenceSha256: bundleDigest,
    at: evidence.finishedAt,
  });
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  } catch (e) {
    console.error(`WARN: could not write the push ledger (${e.message}) — the Stop hook cannot verify this push`);
  }
}

function writeEvidence() {
  evidence.finishedAt = new Date().toISOString();
  fs.mkdirSync(evidenceDir, { recursive: true });
  // Content-addressed: the filename carries the digest of what was pushed, so a bundle
  // cannot be reused for different markup.
  const digest = evidence.markupSha256 ?? 'nodigest';
  const file = path.join(evidenceDir, `${moduleName}--${formName}--${digest.slice(0, 16)}.evidence.json`);
  const body = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(file, body);
  // A sidecar digest of the bundle itself, so a hand-edited bundle is detectable.
  const bundleDigest = sha256(body);
  fs.writeFileSync(`${file}.sha256`, bundleDigest);
  recordLedger(file, bundleDigest);
  console.error(`\nevidence: ${file}`);
  return file;
}

function fail(reason) {
  evidence.status = 'failed';
  evidence.failure = reason;
  writeEvidence();
  console.error(`\napply FAILED: ${reason}`);
  process.exit(1);
}

// ---- 1. stage -----------------------------------------------------------------
let staged;
try { staged = fs.readFileSync(formFile, 'utf8').replace(/^﻿/, ''); }
catch (e) { console.error(`cannot read --form ${formFile}: ${e.message}`); process.exit(2); }
let stagedObj;
try { stagedObj = JSON.parse(staged); }
catch (e) { console.error(`--form is not valid JSON: ${e.message}`); process.exit(2); }
evidence.markupSha256 = sha256(canonical(stagedObj));
step('stage', true, `${formFile} (sha256 ${evidence.markupSha256.slice(0, 16)}…)`);

// Global theme changes need their own approval. Repainting the whole portal because
// one form was asked to match a screenshot is the failure this guards.
const touchesAppTheme = /"\$antdTheme"|ThemeSettings|Frontend\.Theme/.test(staged);
if (touchesAppTheme && !has('--allow-theme-change')) {
  fail('this markup carries app-level theme settings; global theme changes are approved separately — re-run with --allow-theme-change if that is intended');
}

// ---- 2. validate (the gate chain, blocking) ------------------------------------
for (const [script, label] of [
  ['validate-schema.js', 'schema'],
  ['validate-guardrails.js', 'guardrails'],
  ['validate-styledness.js', 'styled-ness'],
]) {
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, script), formFile], { encoding: 'utf8' });
  if (r.status !== 0) {
    step(`validate:${label}`, false, (r.stdout || r.stderr || '').split('\n').filter((l) => /FAIL/.test(l)).slice(0, 6).join(' | '));
    fail(`the ${label} gate rejected this markup — fix the findings, do not bypass the gate`);
  }
  step(`validate:${label}`, true);
}

// ---- 3. authenticate ----------------------------------------------------------
const api = new GymApi(backend);
const tokenFile = argVal('--token-file');
if (tokenFile) process.env.SHESHA_TOKEN_FILE = tokenFile;
try { await api.authenticate(); } catch (e) { fail(`authentication failed: ${e.message}`); }
step('authenticate', true, backend);

// ---- 4. snapshot the prior markup (so a bad push is reversible) ----------------
let priorId = null;
let priorMarkup = null;
{
  const result = await api.getFormByName(moduleName, formName);
  if (result?.id) {
    priorId = result.id;
    priorMarkup = result.markup ?? null;
    evidence.form.id = priorId;
    const snapFile = path.join(evidenceDir, `${moduleName}--${formName}--prior.json`);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(snapFile, priorMarkup ?? '');
    evidence.priorSnapshot = { file: snapFile, sha256: priorMarkup ? sha256(priorMarkup) : null };
    step('snapshot-prior', true, `existing form ${priorId}, prior markup saved`);
  } else {
    step('snapshot-prior', true, 'no existing form — this is a create');
  }
}

if (dryRun) {
  evidence.status = 'dry-run';
  writeEvidence();
  console.error('\n--dry-run: stopped before mutating.');
  process.exit(0);
}

// ---- 5. push ------------------------------------------------------------------
try {
  let moduleId = null;
  if (!priorId) moduleId = await api.resolveModuleId(moduleName);
  const res = await api.upsertForm({
    moduleName, moduleId, name: formName,
    markup: stagedObj,
    modelType: stagedObj.formSettings?.modelType,
  });
  evidence.form.id = res.id ?? evidence.form.id;
  step('push', true, `${res.action} → ${evidence.form.id}`);
} catch (e) {
  step('push', false, e.message);
  fail(`push failed: ${e.message}`);
}

// ---- 6. re-fetch + canonical diff — the only proof the push landed [R-047] -----
{
  const result = await api.getFormByName(moduleName, formName);
  if (!result?.markup) fail('re-fetch after push failed — cannot prove the markup persisted');
  let after;
  try { after = JSON.parse(result.markup); }
  catch (e) { fail(`re-fetched markup is not parseable JSON: ${e.message}`); }

  const sentC = canonical(stagedObj);
  const gotC = canonical(after);
  if (sentC !== gotC) {
    const paths = diffPaths(JSON.parse(sentC), JSON.parse(gotC));
    evidence.diff = paths;
    step('refetch-diff', false, `${paths.length} difference(s): ${paths.slice(0, 5).join('; ')}`);
    fail('the backend does not hold what was sent — a 200 alone proves nothing [R-047]');
  }
  evidence.refetchSha256 = sha256(gotC);
  step('refetch-diff', true, 're-fetched markup matches what was sent');
}

// ---- 7. render ----------------------------------------------------------------
if (has('--no-browser')) {
  evidence.render = { ran: false, reason: '--no-browser' };
  step('render', true, 'skipped (--no-browser) — recorded as NOT visually verified');
} else {
  const r = spawnSync(process.execPath,
    [path.join(SCRIPT_DIR, 'render-instrument.js'), '--form', `${moduleName}/${formName}`],
    { encoding: 'utf8' });
  evidence.render = {
    ran: true, exitCode: r.status,
    output: (r.stdout || '').split('\n').slice(-25).join('\n'),
  };
  if (r.status !== 0) {
    step('render', false, `render-instrument exited ${r.status}`);
    fail('the form does not render cleanly — pushed but not delivered');
  }
  step('render', true, 'render instrument passed');
}

// ---- 8. record ----------------------------------------------------------------
evidence.status = has('--no-browser') ? 'pushed-unrendered' : 'verified';
const file = writeEvidence();
console.error(`\napply OK — ${moduleName}/${formName} (${evidence.form.id ?? 'no id'}), status=${evidence.status}`);
console.log(file);
