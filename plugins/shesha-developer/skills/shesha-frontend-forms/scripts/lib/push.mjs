/**
 * push — THE ONLY WRITE PATH.
 *
 * The chain, and every link is load-bearing:
 *   gates -> ledger `authored` -> Create|UpdateMarkup -> ledger `pushed`
 *         -> re-fetch -> canonical diff -> ledger `verified`
 *
 * A 200 PROVES NOTHING [R-047]. The backend can accept a write and store something other
 * than what was sent — a stringify that was forgotten, a field the server rewrites, a
 * permission filter. Verification is re-fetch and diff, and `verified` is unreachable
 * except as a side effect of a diff artefact written in the same run.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { backendCall, getToken } from './api.mjs';
import { normaliseMarkup, runGates } from './gates.mjs';
import { newRunId, noteActiveApp, record } from './ledger.mjs';

export const PUSH_EXIT = { OK: 0, GATES: 8, HTTP: 9, DIFF: 10 };

export class PushError extends Error {
  constructor(message, exitCode, detail = null) {
    super(message);
    this.name = 'PushError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/**
 * Canonicalise for comparison.
 *
 * Two differences are NOT differences, and treating them as such would make the diff gate
 * cry wolf until someone disabled it:
 *   - key order, which JSON does not preserve and no consumer depends on
 *   - an explicitly null property versus an absent one, which the server normalises
 *
 * Everything else IS a difference, including a changed number, a changed string, and a
 * reordered ARRAY — array order is semantic in form markup (components render in order).
 */
export function canonical(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(canonical).filter((v) => v !== undefined);
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = canonical(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/** Structured diff of two canonicalised documents. Returns [] when they agree. */
export function diffCanonical(sent, got, path = '$', out = []) {
  const a = canonical(sent);
  const b = canonical(got);
  const walk = (x, y, p) => {
    if (x === undefined && y === undefined) return;
    if (x === undefined) return void out.push({ path: p, kind: 'added-by-server', got: summarise(y) });
    if (y === undefined) return void out.push({ path: p, kind: 'dropped-by-server', sent: summarise(x) });
    const tx = Array.isArray(x) ? 'array' : typeof x;
    const ty = Array.isArray(y) ? 'array' : typeof y;
    if (tx !== ty) return void out.push({ path: p, kind: 'type-changed', sent: tx, got: ty });
    if (tx === 'array') {
      if (x.length !== y.length) {
        out.push({ path: p, kind: 'length-changed', sent: x.length, got: y.length });
      }
      const n = Math.min(x.length, y.length);
      for (let i = 0; i < n; i += 1) walk(x[i], y[i], `${p}[${i}]`);
      return;
    }
    if (tx === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${k}`);
      return;
    }
    if (x !== y) out.push({ path: p, kind: 'value-changed', sent: summarise(x), got: summarise(y) });
  };
  walk(a, b, path);
  return out;
}

function summarise(v) {
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}...` : v;
  if (v && typeof v === 'object') return Array.isArray(v) ? `[${v.length} items]` : `{${Object.keys(v).length} keys}`;
  return v;
}

/** Find an existing form by module/name. Absent is a normal answer, not an error. */
export async function lookupForm(backend, token, module, name) {
  const res = await backendCall(
    backend,
    `/api/services/Shesha/FormConfiguration/GetByName?module=${encodeURIComponent(module)}&name=${encodeURIComponent(name)}`,
    { token }
  );
  if (!res.ok) return { found: false, status: res.status, error: res.error };
  // A permission-filtered read answers 200 with a null payload rather than 403.
  if (res.filtered) return { found: false, filtered: true };
  const r = res.result;
  if (!r || !r.id) return { found: false };
  return { found: true, id: r.id, moduleId: r.moduleId ?? null, label: r.label ?? null, access: r.access ?? null };
}

/** Re-fetch the stored markup by id. */
export async function refetch(backend, token, id) {
  const res = await backendCall(backend, `/api/services/Shesha/FormConfiguration/GetJson?id=${encodeURIComponent(id)}`, { token });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  if (res.filtered) {
    // 200 with a null body is a permission filter, and it must not read as "empty form".
    return { ok: false, filtered: true, error: 'the re-fetch returned 200 with a null payload (permission-filtered)' };
  }
  const { doc, error } = normaliseMarkup(res.result);
  if (error) return { ok: false, error: `the re-fetched payload is not form markup: ${error}` };
  return { ok: true, markup: doc };
}

/**
 * Push and verify.
 *
 * `outDir` receives the response and diff artefacts, because the ledger will not accept a
 * status without them.
 */
export async function pushForm({
  appRoot,
  backend,
  file,
  formModule,
  formName,
  groundTruth,
  ctx,
  roundTripResult = null,
  outDir,
  dryRun = false,
  createIfMissing = true,
  onProgress = null,
}) {
  const runId = newRunId();
  const form = `${formModule}/${formName}`;
  const say = (m) => onProgress && onProgress(m);
  mkdirSync(outDir, { recursive: true });

  // ---- 1. gates ------------------------------------------------------------------
  const raw = readFileSync(file, 'utf8');
  const { doc: markup, error } = normaliseMarkup(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw));
  if (error || !markup) throw new PushError(`${file} is not form markup: ${error}`, PUSH_EXIT.GATES);

  say('running the gate chain');
  const gate = runGates(markup, ctx, roundTripResult);
  const gatePath = join(outDir, `${formModule}.${formName}.gates.json`);
  writeFileSync(gatePath, JSON.stringify(gate, null, 2) + '\n', 'utf8');

  if (!gate.ok) {
    // Nothing is written to the backend and nothing is recorded as pushed. A blocked push
    // must leave no trace of having half-happened.
    throw new PushError(
      `${gate.failures.length} gate failure(s) — refusing to push`,
      PUSH_EXIT.GATES,
      gate.failures.map((f) => ({ why: `${f.ruleId ? f.ruleId + ' ' : ''}${f.message}`, at: f.fixPointer }))
    );
  }

  record(appRoot, { form, status: 'authored', artefact: file, runId, note: `gates clean (${gate.counts.warnings} warning(s))` });
  // Tell the Stop hook which app this session is writing to. Recorded at `authored`, before
  // any write, so a session killed mid-push is still detectable.
  noteActiveApp(process.cwd(), appRoot);

  if (dryRun) {
    return { runId, form, dryRun: true, gate, wrote: false, verified: false };
  }

  // ---- 2. locate or create ---------------------------------------------------------
  const token = await getToken(backend, { cacheDir: join(appRoot, '.shesha') });
  say(`looking up ${form}`);
  const found = await lookupForm(backend, token, formModule, formName);

  let id = found.id;
  let created = false;
  if (!found.found) {
    if (!createIfMissing) {
      throw new PushError(`${form} does not exist and --no-create was passed`, PUSH_EXIT.HTTP);
    }
    // Create needs a moduleId GUID, which GetModules cannot supply — it returns names only.
    const moduleId = (groundTruth.backend && groundTruth.backend.moduleIdToName
      ? Object.entries(groundTruth.backend.moduleIdToName).find(([, n]) => n === formModule)?.[0]
      : null);
    if (!moduleId) {
      throw new PushError(
        `${form} does not exist and its module id could not be resolved. ` +
          `GetModules returns names without ids, so the map comes from the configuration tree — re-run probe against a reachable backend.`,
        PUSH_EXIT.HTTP
      );
    }
    say(`creating ${form}`);
    /**
     * CreateItem creates the configuration-item SHELL and takes no markup — verified
     * against this app's own swagger, CreateConfigurationItemRequest is
     * {moduleId, folderId, itemType, discriminator, name, prevItemId, label, description}.
     *
     * `discriminator` is required in practice even though the schema does not mark it so:
     * omitting it answers HTTP 500 "Value cannot be null. (Parameter 'key')", which is a
     * registry lookup failing rather than anything about the form.
     *
     * So creation is two steps — shell, then UpdateMarkup — which suits the design, because
     * UpdateMarkup stays the single write path for content.
     */
    const createRes = await backendCall(backend, '/api/services/app/ConfigurationStudio/CreateItem', {
      method: 'POST',
      token,
      body: {
        moduleId,
        itemType: 'form',
        discriminator: 'form',
        name: formName,
        label: formName,
        description: 'created by shesha-frontend-forms',
      },
    });
    if (!createRes.ok) {
      throw new PushError(`create failed: HTTP ${createRes.status} ${JSON.stringify(createRes.error)}`, PUSH_EXIT.HTTP);
    }
    id = createRes.result?.id || createRes.result?.itemId;
    created = true;
    if (!id) {
      const again = await lookupForm(backend, token, formModule, formName);
      id = again.id;
    }
    if (!id) throw new PushError('the form was created but its id could not be resolved', PUSH_EXIT.HTTP);
  }

  // ---- 3. write --------------------------------------------------------------------
  say(`writing markup for ${form}`);
  /**
   * `markup` in the DTO is a STRINGIFIED blob of {formSettings, components} — double-encoded
   * relative to the entity. Forgetting the stringify silently fails or corrupts, which is
   * exactly the class of failure the re-fetch diff exists to catch.
   *
   * Note the DTO carries NO modelType field, contrary to the build brief: verified against
   * this app's own swagger, FormUpdateMarkupInput is {id, markup, access, permissions}.
   */
  const body = {
    id,
    markup: JSON.stringify(markup),
    access: markup.formSettings?.access ?? 3,
    permissions: markup.formSettings?.permissions ?? [],
  };
  const writeRes = await backendCall(backend, '/api/services/Shesha/FormConfiguration/UpdateMarkup', {
    method: 'PUT',
    token,
    body,
  });
  const responsePath = join(outDir, `${formModule}.${formName}.response.json`);
  writeFileSync(
    responsePath,
    JSON.stringify({ created, id, status: writeRes.status, ok: writeRes.ok, result: writeRes.result, error: writeRes.error }, null, 2) + '\n',
    'utf8'
  );
  if (!writeRes.ok) {
    throw new PushError(`UpdateMarkup failed: HTTP ${writeRes.status} ${JSON.stringify(writeRes.error)}`, PUSH_EXIT.HTTP);
  }

  record(appRoot, { form, status: 'pushed', artefact: responsePath, runId, note: created ? 'created then updated' : 'updated', extra: { id } });

  // ---- 4. re-fetch and diff ---------------------------------------------------------
  say('re-fetching to verify');
  const back = await refetch(backend, token, id);
  if (!back.ok) {
    throw new PushError(`the re-fetch failed, so the push is UNVERIFIED: ${back.error || `HTTP ${back.status}`}`, PUSH_EXIT.DIFF);
  }

  const differences = diffCanonical(markup, back.markup);
  const diffPath = join(outDir, `${formModule}.${formName}.diff.json`);
  writeFileSync(
    diffPath,
    JSON.stringify({ form, id, runId, sentBytes: JSON.stringify(markup).length, differences }, null, 2) + '\n',
    'utf8'
  );

  if (differences.length) {
    throw new PushError(
      `the backend stored something different from what was sent (${differences.length} difference(s)) — the 200 proved nothing [R-047]`,
      PUSH_EXIT.DIFF,
      differences.slice(0, 12).map((d) => ({ why: `${d.kind} at ${d.path}`, at: `sent=${JSON.stringify(d.sent)} got=${JSON.stringify(d.got)}` }))
    );
  }

  record(appRoot, { form, status: 'verified', artefact: diffPath, runId, note: 're-fetched and byte-equal after canonicalisation', extra: { id } });

  return { runId, form, id, created, gate, wrote: true, verified: true, artefacts: { gatePath, responsePath, diffPath } };
}
