#!/usr/bin/env node
// Runner for block-form-writes (§4.3.1). Reads the PreToolUse payload, builds the
// injected ctx, calls the pure decide(), logs the decision, and emits the envelope.
// Only exit codes 0 (decision on stdout) and 2 (stdout unwritable) are legal.

import fs from 'node:fs';
import { findRepoRoot, activeRunId, readStdin, emit, preToolUse, logDecision, payloadPaths } from './lib.mjs';
import { decide } from './block-form-writes.decide.mjs';

const payload = await readStdin();
const root = findRepoRoot();
const runId = root ? activeRunId(root) : null;
const started = Date.now();
const d = decide(payload, { root, fs, activeRunId: runId });
const ms = Date.now() - started;
logDecision(root || process.cwd(), runId, {
  at: new Date().toISOString(), hook: 'block-form-writes', tool: payload.tool_name,
  path: payloadPaths(payload)[0] || null, decision: d.decision, rule: d.rule, code: d.code, ms,
});
const reason = d.decision === 'deny' ? d.reason : '';
const code = d.decision === 'deny' ? d.code : '';
emit(preToolUse(d.decision, code, reason), `${d.code} ${d.reason}`);
