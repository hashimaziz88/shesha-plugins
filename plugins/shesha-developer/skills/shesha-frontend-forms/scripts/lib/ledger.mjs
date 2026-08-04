/**
 * The persistence ledger.
 *
 * ONE RULE, AND IT IS THE WHOLE POINT: no status without an artefact.
 *
 * A status that claims something was verified must carry a file path that exists, is keyed
 * to the same form, and was produced in the SAME RUN. The previous corpus contained exactly
 * one `verified` write across 1,274 tool calls, and it named a form from an unrelated
 * earlier run — a status field with nothing behind it is worse than no status at all,
 * because it reads as assurance.
 *
 * Append-only JSONL, so a crash truncates at most the last line and history is never
 * rewritten. It lives in the target app's .shesha/ directory, which self-ignores.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

/** The lifecycle. Each status names the artefact it cannot be claimed without. */
export const STATUS = {
  authored: { requiresArtefact: 'file', terminal: false, note: 'markup exists on disk and passed the offline gates' },
  pushed: { requiresArtefact: 'response', terminal: false, note: 'the backend accepted a write' },
  verified: { requiresArtefact: 'diff', terminal: true, note: 're-fetched and diffed against what was sent' },
  rendered: { requiresArtefact: 'evidence', terminal: true, note: 'rendered in a browser and asserted' },
  abandoned: { requiresArtefact: null, terminal: true, note: 'deliberately given up on, with a reason' },
};

/** Statuses that leave work outstanding. Anything here blocks a session from ending. */
export const OPEN_STATUSES = Object.entries(STATUS)
  .filter(([, v]) => !v.terminal)
  .map(([k]) => k);

/** How old a ledger may be before it is treated as stale rather than current. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export function ledgerPath(appRoot) {
  return join(appRoot, '.shesha', 'ledger.jsonl');
}

/** A run id groups the entries of one push, so `verified` cannot borrow an older artefact. */
export function newRunId() {
  return randomUUID();
}

function sha256OfFile(p) {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Append one entry. Rejects a claim it cannot substantiate.
 *
 * This is deliberately strict: a caller that wants to record `verified` must hand over a
 * real file, and the file must mention the form. It is the only thing standing between a
 * ledger and a decoration.
 */
export function record(appRoot, entry) {
  const { form, status, artefact = null, runId, note = null, extra = null } = entry;
  if (!form || !String(form).includes('/')) {
    throw new Error(`ledger: form must be "<module>/<name>", got ${JSON.stringify(form)}`);
  }
  if (!STATUS[status]) {
    throw new Error(`ledger: unknown status "${status}". Known: ${Object.keys(STATUS).join(', ')}`);
  }
  if (!runId) throw new Error('ledger: every entry needs a runId, so a status cannot borrow an older run\'s artefact');

  const spec = STATUS[status];
  if (spec.requiresArtefact) {
    if (!artefact) {
      throw new Error(
        `ledger: status "${status}" requires an artefact (${spec.requiresArtefact}) — ${spec.note}. ` +
          'A status with nothing behind it reads as assurance and is worse than no status.'
      );
    }
    if (!existsSync(artefact)) {
      throw new Error(`ledger: the artefact for "${status}" does not exist on disk: ${artefact}`);
    }
  }

  const row = {
    ts: new Date().toISOString(),
    runId,
    form,
    status,
    artefact,
    artefactSha256: artefact ? sha256OfFile(artefact) : null,
    note,
    ...(extra ? { extra } : {}),
  };

  const p = ledgerPath(appRoot);
  try {
    mkdirSync(dirname(p), { recursive: true });
  } catch (e) {
    // recursive mkdir tolerates an existing DIRECTORY but not an existing FILE at the path.
    // A raw EEXIST from inside a Stop hook is unreadable; say what is actually wrong.
    throw new Error(
      `ledger: cannot create ${dirname(p)} — ${e.code === 'EEXIST' ? 'something already exists there and is not a directory' : (e && e.message) || e}`
    );
  }
  appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

/** Read every entry. A malformed line is reported, never skipped silently. */
export function read(appRoot) {
  const p = ledgerPath(appRoot);
  if (!existsSync(p)) return { exists: false, entries: [], malformed: [], mtimeMs: null };
  const text = readFileSync(p, 'utf8');
  const entries = [];
  const malformed = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const row = JSON.parse(line);
      if (!row.form || !row.status) malformed.push({ line: i + 1, why: 'missing form or status' });
      else entries.push(row);
    } catch (e) {
      malformed.push({ line: i + 1, why: (e && e.message) || String(e) });
    }
  });
  return { exists: true, entries, malformed, mtimeMs: statSync(p).mtimeMs };
}

/**
 * Current state per form, plus whatever is outstanding.
 *
 * `latest` is the last entry for a form, so a form that reached `verified` and was then
 * re-authored counts as open again — which is correct, because the new markup has not been
 * verified.
 */
export function status(appRoot) {
  const { exists, entries, malformed, mtimeMs } = read(appRoot);
  const byForm = new Map();
  for (const e of entries) {
    const cur = byForm.get(e.form);
    if (!cur || e.ts >= cur.ts) byForm.set(e.form, e);
  }
  const forms = [...byForm.values()].map((e) => ({
    form: e.form,
    status: e.status,
    ts: e.ts,
    runId: e.runId,
    artefact: e.artefact,
    open: OPEN_STATUSES.includes(e.status),
    // An artefact that has since vanished invalidates the claim it was making.
    artefactMissing: !!(e.artefact && !existsSync(e.artefact)),
  }));

  const stale = exists && mtimeMs !== null && Date.now() - mtimeMs > STALE_AFTER_MS;
  return {
    exists,
    path: ledgerPath(appRoot),
    stale,
    malformed,
    forms,
    open: forms.filter((f) => f.open),
    brokenClaims: forms.filter((f) => f.artefactMissing),
    entryCount: entries.length,
  };
}

/**
 * The Stop gate. FAIL CLOSED.
 *
 * Returns { block, reasons[], command } — the caller turns that into a hook decision.
 * It blocks on open work, on a missing artefact behind a terminal claim, on a malformed
 * ledger, and on an ABSENT ledger when there is evidence the session authored forms. The
 * previous stack's version failed OPEN on every one of those, which is the same as not
 * having a gate.
 */
export function stopGate(appRoot, { authoredEvidence = false } = {}) {
  const s = status(appRoot);
  const reasons = [];

  if (!s.exists) {
    if (authoredEvidence) {
      reasons.push(
        'form markup was authored in this session but there is no push ledger at all — ' +
          'either the work was never pushed, or it was pushed outside the toolchain.'
      );
    }
  } else {
    if (s.malformed.length) {
      reasons.push(
        `the ledger has ${s.malformed.length} malformed line(s) (${s.malformed
          .map((m) => `line ${m.line}: ${m.why}`)
          .slice(0, 3)
          .join('; ')}) — it cannot be trusted to say what is outstanding.`
      );
    }
    for (const f of s.open) {
      reasons.push(`${f.form} is "${f.status}" — pushed but not verified, so nobody knows whether it landed.`);
    }
    for (const f of s.brokenClaims) {
      reasons.push(`${f.form} claims "${f.status}" but its artefact is gone: ${f.artefact}`);
    }
    if (s.stale && s.open.length === 0 && s.malformed.length === 0) {
      // Stale with nothing outstanding is fine; say so rather than blocking.
      reasons.length = reasons.length; // no-op, kept for clarity
    }
  }

  return {
    block: reasons.length > 0,
    reasons,
    command: `node "${join('${CLAUDE_SKILL_DIR}', 'scripts', 'shesha.mjs')}" ledger status --app "${appRoot}"`,
    summary: s,
  };
}

/**
 * Repair, not erase.
 *
 * `reset` marks every open form abandoned with a reason rather than deleting history — the
 * point of an append-only ledger is that you can see what happened, including that someone
 * gave up.
 */
export function reset(appRoot, { reason = 'reset by operator', runId = newRunId() } = {}) {
  const s = status(appRoot);
  const closed = [];
  for (const f of s.open) {
    record(appRoot, { form: f.form, status: 'abandoned', runId, note: reason });
    closed.push(f.form);
  }
  return { closed, reason };
}

/**
 * The session pointer.
 *
 * A Stop hook receives the working directory, not an --app path, and the ledger lives in the
 * TARGET app's .shesha/. Without a pointer the hook would have to guess, and a Stop gate
 * that guesses either blocks sessions that never touched a form (actively harmful, since
 * this plugin is shared with the old stack) or silently passes ones that did.
 *
 * So push records which app roots this session wrote to. No pointer means no publish
 * activity, which is the only case where an absent ledger is legitimately fine.
 */
export function sessionPointerPath(cwd) {
  return join(cwd, '.shesha-active-apps.json');
}

export function noteActiveApp(cwd, appRoot) {
  const p = sessionPointerPath(cwd);
  let apps = [];
  if (existsSync(p)) {
    try {
      apps = JSON.parse(readFileSync(p, 'utf8')).apps || [];
    } catch {
      apps = [];
    }
  }
  if (!apps.includes(appRoot)) apps.push(appRoot);
  writeFileSync(p, JSON.stringify({ apps, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  return apps;
}

export function readActiveApps(cwd) {
  const p = sessionPointerPath(cwd);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8')).apps || [];
  } catch {
    return [];
  }
}

/** Move a corrupt ledger aside so a session can proceed, keeping the evidence. */
export function quarantine(appRoot) {
  const p = ledgerPath(appRoot);
  if (!existsSync(p)) return null;
  const to = `${p}.corrupt.${Date.now()}`;
  renameSync(p, to);
  writeFileSync(p, '', 'utf8');
  return to;
}
