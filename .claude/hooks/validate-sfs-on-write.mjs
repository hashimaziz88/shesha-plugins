#!/usr/bin/env node
// Runner for validate-sfs-on-write (PostToolUse). A PostToolUse block uses a different
// envelope from PreToolUse: {"decision":"block","reason":...}. Only exit 0 or 2 are legal
// (exit(1) is banned, §4.3.1 rule 5); a block is still exit 0 with the block envelope.
import fs from 'node:fs';
import { findRepoRoot, activeRunId, readStdin, logDecision, payloadPaths, spawnNode } from './lib.mjs';
import { decide } from './validate-sfs-on-write.decide.mjs';

const payload = await readStdin();
const root = findRepoRoot();
const started = Date.now();
const d = decide(payload, { root, fs, spawnNode });
logDecision(root || process.cwd(), root ? activeRunId(root) : null, {
  at: new Date().toISOString(), hook: 'validate-sfs-on-write', tool: payload.tool_name,
  path: payloadPaths(payload)[0] || null, decision: d.decision, rule: d.rule, code: d.code, ms: Date.now() - started,
});
try {
  if (d.decision === 'block') {
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `${d.code} ${d.reason}`.trim() })}\n`);
  }
  process.exit(0);
} catch {
  try { process.stderr.write(`${d.code} ${d.reason}\n`); } catch { /* nothing left to do */ }
  process.exit(2);
}
