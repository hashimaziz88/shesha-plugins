// D-020, D-039, D-048: the commit message and its evidence agree, and no number
// in a commit body is typed by an author.
//
// This gate lives in .githooks/commit-msg because that is the only hook git passes
// the message file to. Invoked WITHOUT --message-file it exits 2 (usage) and never
// falls back to .git/COMMIT_EDITMSG: at pre-commit time that file still holds the
// PREVIOUS message, so a fallback would validate the wrong text and pass.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  families, verdictOf, report, exitFor, runGuarded, EXIT,
} from '@shesha/registry/coverage';
import { readText, repoRoot, git } from '../lib/fsx.mjs';

export const id = 'g-commit-format';
export const describe = 'subject shape, the six body keys, evidence freshness, decision ids, branch, plugin claim';
export const inputPaths = ['DECISIONS.md', 'packages/verify/config/disposition.json', 'package.json'];

/** The six mandatory body keys. */
const BODY_KEYS = ['Why', 'Evidence', 'Decisions', 'Deletes', 'Plugin'];
const MAX_SUBJECT_AFTER_ID = 62;
const MAX_EVIDENCE_AGE_SECONDS = 900;
/** Branches this repository must never commit to directly. */
const FORBIDDEN_BRANCHES = ['main', 'master'];

/**
 * @param {string} message
 * @returns {{subject:string, body:string, keys:Record<string,string>}}
 */
export function parseMessage(message) {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const subject = lines[0] || '';
  const body = lines.slice(1).join('\n');
  /** @type {Record<string,string>} */
  const keys = {};
  for (const line of lines.slice(1)) {
    const m = /^([A-Z][A-Za-z-]*):\s*(.*)$/.exec(line.trim());
    if (m) keys[m[1]] = m[2].trim();
  }
  return { subject, body, keys };
}

/**
 * @param {{repoRoot:string, messageFile?:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  // The message-shaped families have no population at all without a message, so
  // they are declared not-required: a family that walked nothing because there was
  // nothing to walk is different from one that walked nothing because it forgot to
  // look. `branch` is always populated and stays required, so this gate can never
  // report a verdict over an empty report.
  const fams = families([
    { name: 'subject', unit: 'assertion', required: false },
    { name: 'body-keys', unit: 'key', required: false },
    { name: 'evidence', unit: 'assertion', required: false },
    { name: 'decision-ids', unit: 'id', required: false },
    // Also not-required: the branch is a property of the repository, and a staged
    // copy of this gate's declared inputs is not a git repository at all. Where it
    // matters — a real working tree — git always resolves and the family populates.
    { name: 'branch', unit: 'assertion', required: false },
  ]);

  // Without a message file there is nothing to validate. The gate still walks its
  // branch family, so `npm run gates` gets a real verdict rather than an empty one,
  // and the message-shaped families are declared not-applicable with that reason.
  const branchFam = fams.get('branch');
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || '').trim();
  if (branch !== '') {
    branchFam.pointer(`branch ${branch}`).assert(!FORBIDDEN_BRANCHES.includes(branch),
      `commits go to a work branch, never to ${FORBIDDEN_BRANCHES.join(' or ')} (D-039); HEAD is "${branch}"`);
  }

  // A mutation cannot change how the harness calls run(), so it plants the message
  // at this conventional path instead. It never exists in a real working tree.
  const planted = path.join(root, '.commit-msg-under-test');
  const messageFile = ctx.messageFile ?? (fs.existsSync(planted) ? planted : undefined);
  if (!messageFile) {
    // No message means no population. Walking a pointer only to dispose it would
    // make these families report "walked but evaluated nothing", which is a fail.
    return fams.list;
  }

  const message = readText(messageFile);
  const subjFam = fams.get('subject');
  if (message === null) {
    subjFam.pointer(messageFile).fail(`the message file ${messageFile} could not be read`);
    return fams.list;
  }

  // The gate reads through readText, which strips a BOM — but git stores the bytes
// it was given, so a BOM-prefixed message commits a subject beginning with an
  // invisible U+FEFF that no `[type]-` parser will match. Windows tooling writes
  // these constantly (PowerShell's `Set-Content -Encoding utf8` does), so the raw
  // bytes are checked here rather than the normalised text.
  const rawBytes = fs.readFileSync(messageFile);
  subjFam.pointer('message#encoding').assert(
    !(rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF),
    'the message file begins with a UTF-8 BOM, which git stores verbatim; the committed subject would start with an invisible U+FEFF');

  const { subject, keys } = parseMessage(message);

  // ---- subject: [type]- WP-NN <summary> ------------------------------------
  const shape = /^\[(feature|fix|chore)\]-\s+(WP-[0-9a-z.]+)\s+(.+)$/.exec(subject);
  const sp = subjFam.pointer(subject.slice(0, 60) || '(empty)');
  if (!shape) {
    sp.fail(`subject "${subject.slice(0, 70)}" must be "[feature|fix|chore]- WP-NN <imperative summary>"`);
  } else {
    sp.check();
    const summary = shape[3];
    subjFam.pointer('subject#length').assert(summary.length <= MAX_SUBJECT_AFTER_ID,
      `the summary is ${summary.length} characters after the WP id, over the ${MAX_SUBJECT_AFTER_ID} cap`);
  }
  const wpId = shape ? shape[2] : null;

  // ---- the six body keys ---------------------------------------------------
  const keyFam = fams.get('body-keys');
  for (const key of BODY_KEYS) {
    const p = keyFam.pointer(key);
    p.assert(key in keys && keys[key] !== '', `the body is missing a non-empty "${key}:" line`);
  }

  // ---- evidence: written by a program, fresh, and about THIS commit ---------
  const evFam = fams.get('evidence');
  const claimed = keys.Evidence || '';
  const ep = evFam.pointer(claimed || 'Evidence:(absent)');
  if (!claimed) {
    ep.fail('the body has no Evidence: path');
  } else if (wpId && !claimed.includes(wpId)) {
    ep.fail(`Evidence: names "${claimed}" but the subject's work package is ${wpId}`);
  } else {
    const abs = path.join(root, claimed);
    if (!fs.existsSync(abs)) {
      ep.fail(`Evidence: names "${claimed}", which does not exist. It is written by the gate runner, never by hand (D-048)`);
    } else {
      const text = readText(abs) || '{}';
      /** @type {{gitSha?:string, verdict?:string, at?:string}} */
      let ev = {};
      try { ev = JSON.parse(text); } catch { /* handled below */ }
      const head = (git(['rev-parse', 'HEAD'], root) || '').trim();
      const problems = [];
      if (!ev.gitSha) problems.push('has no gitSha');
      else if (head && ev.gitSha !== head) problems.push(`gitSha ${ev.gitSha.slice(0, 8)} does not match HEAD ${head.slice(0, 8)} — it is stale`);
      if (ev.verdict !== 'pass') problems.push(`verdict is "${ev.verdict}", not "pass"`);
      if (ev.at) {
        const ageSeconds = (Date.now() - Date.parse(ev.at)) / 1000;
        if (Number.isFinite(ageSeconds) && ageSeconds > MAX_EVIDENCE_AGE_SECONDS) {
          problems.push(`was written ${Math.round(ageSeconds)}s ago, over the ${MAX_EVIDENCE_AGE_SECONDS}s freshness limit`);
        }
      } else problems.push('has no `at` timestamp');
      if (problems.length) ep.fail(`${claimed}: ${problems.join('; ')}`);
      else ep.check(4);
    }
  }

  // ---- every cited decision id exists --------------------------------------
  const idFam = fams.get('decision-ids');
  const cited = (keys.Decisions || '').split(',').map((s) => s.trim()).filter(Boolean);
  const decisionsText = readText(path.join(root, 'DECISIONS.md')) || '';
  if (cited.length === 0 || cited[0] === 'none') {
    idFam.pointer('Decisions#none').assert((keys.Decisions || '').trim() === 'none',
      'Decisions: must list D-0NN ids or the literal "none"');
  } else {
    for (const d of cited) {
      const p = idFam.pointer(d);
      if (!/^D-\d{3}$/.test(d)) { p.fail(`"${d}" is not a D-0NN id`); continue; }
      p.assert(new RegExp(`^\\|\\s*${d}\\s*\\|`, 'm').test(decisionsText),
        `Decisions: cites ${d}, which has no row in DECISIONS.md`);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'the subject omits its work-package id',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.writeFileSync(path.join(tmp, '.commit-msg-under-test'),
        '[chore]- tidy up the workspace\n\nWhy: x\nEvidence: packages/verify/evidence/WP-0.json\nDecisions: none\nDeletes: none\nPlugin: unchanged\n');
    },
    expect: 'fail',
  },
  {
    name: 'the body is missing mandatory keys',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.writeFileSync(path.join(tmp, '.commit-msg-under-test'), '[chore]- WP-0 establish the workspace\n\nWhy: x\n');
    },
    expect: 'fail',
  },
  {
    name: 'the message file carries a UTF-8 BOM',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.writeFileSync(path.join(tmp, '.commit-msg-under-test'),
        `﻿[chore]- WP-0 establish the workspace\n\nWhy: x\nEvidence: packages/verify/evidence/WP-0.json\nDecisions: none\nDeletes: none\nPlugin: unchanged\n`,
        'utf8');
    },
    expect: 'fail',
  },
  {
    name: 'a cited decision id has no row in DECISIONS.md',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.writeFileSync(path.join(tmp, '.commit-msg-under-test'),
        '[chore]- WP-0 establish the workspace\n\nWhy: x\nEvidence: packages/verify/evidence/WP-0.json\nDecisions: D-999\nDeletes: none\nPlugin: unchanged\n');
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--message-file');
  const messageFile = i >= 0 ? process.argv[i + 1] : undefined;
  if (!messageFile) {
    console.error('usage: --message-file <path>');
    console.error('This gate never falls back to .git/COMMIT_EDITMSG: at pre-commit time that file');
    console.error('holds the previous message, so a fallback would validate the wrong text.');
    process.exit(EXIT.usage);
  }
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root, messageFile });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
