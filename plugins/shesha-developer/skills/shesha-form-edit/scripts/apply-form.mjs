#!/usr/bin/env node
/**
 * apply-form.mjs — THE publication path. One command, seven stages, one JSON result.
 *
 *   node scripts/apply-form.mjs --file <compiled.json> --form <module>/<name>
 *        --backend <url> [--id <guid>] [--token-file <path>] [--archetype <a>]
 *        [--no-page-anatomy] [--model-type <t>] [--label <s>] [--bindings]
 *
 * Before this script, publishing was a prose recipe: the model hand-ran curl for
 * Create/UpdateMarkup, then (maybe) a re-fetch, then (maybe) two ledger commands.
 * Every step was a place to stop early, and "pushed" routinely meant "a 200 came
 * back". The recipes are gone from api.md; this is the path.
 *
 * Stages, in order, fail-closed:
 *   1 gates      offline self-gates on the very file being published (schema →
 *                guardrails → styled-ness; the list is owned by
 *                compile/validate-output.mjs). Optional --bindings adds the live
 *                binding gate. A failing gate STOPS here: nothing is sent, nothing
 *                is recorded.
 *   2 authored   ledger record --status authored, BEFORE the backend is touched, so
 *                a crash mid-push still leaves the Stop gate holding an open entry.
 *   3 push       Create (new) or UpdateMarkup (existing) via GymApi.
 *   4 pushed     ledger record --status pushed with the real id.
 *   5 re-fetch   GetByName, parse result.markup.
 *   6 diff       byte compare of what we sent vs what came back, then a
 *                key-order-insensitive structural compare (the server reorders keys
 *                and drops nulls — those are normalizations, not drift).
 *   7 verified   on a structural match: ledger update --status verified, exit 0.
 *                On a mismatch: the entry STAYS `pushed`, exit 1 — the Stop gate
 *                keeps blocking until a human or a re-push closes it.
 *
 * Stdout is ONE JSON object (the publish half of the evidence envelope documented in
 * references/quality-gates.md): { form, id, gates, pushed, refetchDiff, ledger, status }.
 * Progress goes to stderr so stdout stays machine-readable.
 *
 * The ledger is always written by scripts/ledger.mjs (spawned) — this script does not
 * become a second writer of push-ledger.json.
 *
 * Offline-testable by construction: `applyForm()` is exported and takes injectable
 * `api` / `fetchImpl` / `runGates` / `ledger` seams, so tests/apply-form.test.mjs
 * drives all seven stages with no backend. No test ever performs a live push.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GymApi } from './gym-lib/api.js';
import { SELF_GATES } from './compile/validate-output.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(SCRIPTS, 'ledger.mjs');

const USAGE = `usage: node scripts/apply-form.mjs --file <compiled.json> --form <module>/<name> --backend <url>
                                  [--id <guid>] [--token-file <path>] [--archetype <a>]
                                  [--no-page-anatomy] [--model-type <t>] [--label <s>] [--bindings]`;

// ---------------------------------------------------------------- stage 1: gates
// The gate LIST is imported, never restated. The invocation lives here rather than
// calling validate-output.mjs's runSelfGates because a publish often has no
// archetype to hand (a small edit to a fetched form has no blueprint), and the
// styled-ness gate must then run WITHOUT --archetype — where it degrades to a WARN
// on page anatomy instead of failing on an unknown.
export function runOfflineGates(file, { archetype = null, pageAnatomy = true, bindings = null } = {}) {
  const jobs = SELF_GATES.map((gate) => {
    const extra = gate === 'validate-styledness.js'
      ? [...(archetype ? ['--archetype', archetype] : []), ...(pageAnatomy ? [] : ['--no-page-anatomy'])]
      : [];
    return { gate, args: [path.join(SCRIPTS, gate), file, ...extra] };
  });
  if (bindings) {
    jobs.push({
      gate: 'resolve-bindings.js',
      args: [path.join(SCRIPTS, 'resolve-bindings.js'), file, '--backend', bindings.backend,
        ...(bindings.tokenFile ? ['--token-file', bindings.tokenFile] : [])],
    });
  }
  const results = jobs.map(({ gate, args }) => {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    return { gate, ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd() };
  });
  return { ok: results.every((r) => r.ok), results };
}

// --------------------------------------------------------------- ledger plumbing
function spawnLedger(args, cwd) {
  const r = spawnSync(process.execPath, [LEDGER, ...args], { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

// ------------------------------------------------------------------ stage 6: diff
/** Recursively sort object keys so a server key reorder is not read as drift. */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  }
  return v;
}

/** Paths where the two trees genuinely differ, capped so a bad diff cannot flood stdout. */
function differences(a, b, at = '', out = [], cap = 25) {
  if (out.length >= cap) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  // null → absent is a documented server normalization on optional fields.
  if ((a === null && b === undefined) || (a === undefined && b === null)) return out;
  if (ta !== tb) { out.push(`${at || '(root)'}: ${ta} → ${tb}`); return out; }
  if (ta === 'array') {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} → ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) differences(a[i], b[i], `${at}[${i}]`, out, cap);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      differences(a[k], b[k], at ? `${at}.${k}` : k, out, cap);
    }
    return out;
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  return out;
}

export function diffMarkup(sentStr, backStr) {
  if (sentStr === backStr) return { byteEqual: true, structuralEqual: true, differences: [] };
  let sent; let back;
  try { sent = JSON.parse(sentStr); } catch (e) { return { byteEqual: false, structuralEqual: false, differences: [`sent markup unparseable: ${e.message}`] }; }
  try { back = JSON.parse(backStr); } catch (e) { return { byteEqual: false, structuralEqual: false, differences: [`re-fetched markup unparseable: ${e.message}`] }; }
  const diffs = differences(canonical(sent), canonical(back));
  return { byteEqual: false, structuralEqual: diffs.length === 0, differences: diffs };
}

// ------------------------------------------------------------------- the sequence
/**
 * @param {object} o
 * @param {string} o.file            compiled markup on disk
 * @param {string} o.form            "<module>/<name>"
 * @param {string} [o.backend]
 * @param {string} [o.id]            known form id (skips the GetByName lookup)
 * @param {object} [o.api]           injected GymApi-shaped client (tests)
 * @param {Function} [o.fetchImpl]   injected transport for a real GymApi (tests)
 * @param {Function} [o.runGates]    injected gate runner (tests)
 * @param {Function} [o.ledger]      injected ledger runner (tests)
 * @returns {Promise<{result: object, exitCode: number}>}
 */
export async function applyForm(o) {
  const log = o.log ?? ((m) => console.error(`[apply-form] ${m}`));
  const [module, name] = String(o.form ?? '').split('/');
  if (!module || !name) throw new Error(`--form must be "<module>/<name>" (got "${o.form ?? ''}")`);
  if (!o.file || !fs.existsSync(o.file)) throw new Error(`--file not found: ${o.file}`);

  const runGates = o.runGates ?? runOfflineGates;
  const ledger = o.ledger ?? ((args) => spawnLedger(args, o.cwd ?? process.cwd()));
  const result = {
    form: { module, name, id: o.id ?? null },
    gates: {}, pushed: null, refetchDiff: null, ledger: [], status: 'failed',
  };
  const record = (args, stage) => {
    const r = ledger(args);
    result.ledger.push({ stage, ok: r.ok });
    if (!r.ok) log(`WARN ledger ${stage} failed: ${r.output}`);
    return r;
  };

  // 1 — gates. Nothing leaves the process until the artifact itself is clean.
  const gates = runGates(o.file, {
    archetype: o.archetype ?? null,
    pageAnatomy: o.pageAnatomy !== false,
    bindings: o.bindings ? { backend: o.backend, tokenFile: o.tokenFile ?? null } : null,
  });
  result.gates = Object.fromEntries(gates.results.map((r) => [r.gate, r.ok ? 'pass' : 'fail']));
  if (!gates.ok) {
    for (const r of gates.results.filter((x) => !x.ok)) log(`GATE FAIL ${r.gate}\n${r.output}`);
    result.status = 'failed';
    log('offline gates failed — nothing pushed, nothing recorded');
    return { result, exitCode: 1 };
  }
  log(`gates pass: ${gates.results.map((r) => r.gate).join(' → ')}`);

  const sentTree = JSON.parse(fs.readFileSync(o.file, 'utf8'));
  const sentStr = JSON.stringify(sentTree);

  const api = o.api ?? new GymApi(o.backend ?? 'http://localhost:21021', {
    tokenFile: o.tokenFile ?? undefined,
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
  });
  if (api.authenticate) await api.authenticate();

  // 2 — authored, BEFORE the mutation. An id is required by the ledger, and a form
  // that does not exist yet has none, so the placeholder holds the slot; stage 4
  // upserts the same entry with the real guid.
  const existing = o.id ? { id: o.id } : await api.getFormByName(module, name);
  const knownId = existing?.id ?? null;
  record(['record', '--form', o.form, '--id', knownId ?? 'pending-create', '--status', 'authored'], 'authored');

  // 3 — push.
  let push;
  try {
    push = await api.upsertForm({
      moduleName: module,
      moduleId: knownId ? undefined : await api.resolveModuleId(module),
      name,
      markup: sentStr,
      modelType: o.modelType ?? sentTree?.formSettings?.modelType ?? undefined,
      label: o.label ?? name,
      description: o.description ?? 'published by apply-form.mjs',
    });
  } catch (err) {
    log(`PUSH FAILED: ${err.message}`);
    result.status = 'failed';
    return { result, exitCode: 1 };
  }
  result.pushed = { action: push.action, id: push.id ?? knownId ?? null };
  result.form.id = result.pushed.id;
  log(`${push.action} ${o.form} (id=${result.form.id})`);

  // 4 — pushed, with the real id.
  record(['record', '--form', o.form, '--id', String(result.form.id), '--status', 'pushed'], 'pushed');

  // 5 — re-fetch. A 200 is not persistence [R-047].
  const after = await api.getFormByName(module, name);
  const backStr = typeof after?.markup === 'string' ? after.markup
    : after?.markup ? JSON.stringify(after.markup) : null;
  if (!backStr) {
    result.refetchDiff = { byteEqual: false, structuralEqual: false, differences: ['re-fetch returned no markup'] };
    result.status = 'unverified';
    log('re-fetch returned no markup — entry stays `pushed`');
    return { result, exitCode: 1 };
  }

  // 6 — diff.
  result.refetchDiff = diffMarkup(sentStr, backStr);
  if (!result.refetchDiff.structuralEqual) {
    result.status = 'unverified';
    log(`re-fetch DIFF (${result.refetchDiff.differences.length} shown) — entry stays \`pushed\`:`);
    for (const d of result.refetchDiff.differences) log(`  ${d}`);
    return { result, exitCode: 1 };
  }

  // 7 — verified.
  record(['update', '--form', o.form, '--status', 'verified'], 'verified');
  result.status = 'verified';
  log(`verified: re-fetch ${result.refetchDiff.byteEqual ? 'byte-identical' : 'structurally identical (server key normalization only)'}`);
  return { result, exitCode: 0 };
}

// ------------------------------------------------------------------------- CLI
async function main(argv) {
  const val = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const file = val('--file');
  const form = val('--form');
  if (!file || !form) { console.error(USAGE); return 2; }

  const { result, exitCode } = await applyForm({
    file,
    form,
    backend: val('--backend', 'http://localhost:21021'),
    id: val('--id'),
    tokenFile: val('--token-file'),
    archetype: val('--archetype'),
    modelType: val('--model-type'),
    label: val('--label'),
    pageAnatomy: !argv.includes('--no-page-anatomy'),
    bindings: argv.includes('--bindings'),
  });
  console.log(JSON.stringify(result, null, 2));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (err) => {
    console.error(`[apply-form] ${err.message}`);
    process.exit(1);
  });
}
