#!/usr/bin/env node
// Runner for enforce-screen-lock (PreToolUse). Only exit 0 or 2 are legal.
import fs from 'node:fs';
import { findRepoRoot, activeRunId, readStdin, emit, preToolUse, logDecision, payloadPaths } from './lib.mjs';
import { decide } from './enforce-screen-lock.decide.mjs';

const payload = await readStdin();
const root = findRepoRoot();
const started = Date.now();
const d = decide(payload, { root, fs });
logDecision(root || process.cwd(), root ? activeRunId(root) : null, {
  at: new Date().toISOString(), hook: 'enforce-screen-lock', tool: payload.tool_name,
  path: payloadPaths(payload)[0] || null, decision: d.decision, rule: d.rule, code: d.code, ms: Date.now() - started,
});
emit(preToolUse(d.decision, d.decision === 'deny' ? d.code : '', d.decision === 'deny' ? d.reason : ''), `${d.code} ${d.reason}`);
