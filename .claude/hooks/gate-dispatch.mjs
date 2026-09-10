#!/usr/bin/env node
// Runner for gate-dispatch (PreToolUse on Task). Only exit 0 or 2 are legal.
import fs from 'node:fs';
import { findRepoRoot, activeRunId, readStdin, emit, preToolUse, logDecision, spawnNode } from './lib.mjs';
import { decide } from './gate-dispatch.decide.mjs';

const payload = await readStdin();
const root = findRepoRoot();
const started = Date.now();
const d = decide(payload, { root, fs, spawnNode });
logDecision(root || process.cwd(), root ? activeRunId(root) : null, {
  at: new Date().toISOString(), hook: 'gate-dispatch', tool: payload.tool_name,
  // The dispatched role is recorded so g-hook-contract's role-coverage family can hold
  // the gate against the role names the harness actually sends, not the ones it expects.
  role: (payload.tool_input && typeof payload.tool_input.subagent_type === 'string') ? payload.tool_input.subagent_type : null,
  path: null, decision: d.decision, rule: d.rule, code: d.code, ms: Date.now() - started,
});
emit(preToolUse(d.decision, d.decision === 'deny' ? d.code : '', d.decision === 'deny' ? d.reason : ''), `${d.code} ${d.reason}`);
