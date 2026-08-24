#!/usr/bin/env node
// Runner for session-start (SessionStart). It never gates; it prints six lines of
// additionalContext. Only exit 0 or 2 are legal (exit(1) is banned); it exits 0 even
// when a probe fails, because a SessionStart hook that blocks makes the repo unopenable.
import fs from 'node:fs';
import { findRepoRoot, activeRunId, readStdin, logDecision, spawnNode } from './lib.mjs';
import { decide } from './session-start.decide.mjs';

const payload = await readStdin();
const root = findRepoRoot();
let backend = null;
try { backend = (root && fs.readFileSync(`${root}/.build/backend`, 'utf8').trim()) || null; } catch { backend = null; }
const chromium = !!(process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH);
const d = decide(payload, { root, fs, spawnNode, nodeVersion: process.version, backend, chromium });
logDecision(root || process.cwd(), root ? activeRunId(root) : null, {
  at: new Date().toISOString(), hook: 'session-start', tool: 'SessionStart', path: null, decision: d.decision, rule: 'S0', code: '', ms: 0,
});
try {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: d.additionalContext } })}\n`);
  process.exit(0);
} catch {
  try { process.stderr.write(`${d.additionalContext}\n`); } catch { /* nothing left to do */ }
  process.exit(2);
}
