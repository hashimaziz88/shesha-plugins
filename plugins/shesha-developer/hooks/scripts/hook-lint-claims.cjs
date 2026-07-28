#!/usr/bin/env node
/**
 * PostToolUse hook (Write|Edit): when an in-scope SKILL.md or reference doc is
 * edited, run the doc-claims lint and report only the findings that touch the
 * file just written. Exit 2 gives Claude blocking feedback; anything else is
 * silent so unrelated edits are never slowed down.
 *
 * This is what stops the docs drifting ahead of the code between releases: an
 * added MUST/enforced/fail-closed claim gets challenged at the moment it is
 * written, not at review time.
 *
 * Fails open — a lint that cannot run must never block an edit.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const IN_SCOPE = [
  'skills/shesha-claude-designer',
  'skills/shesha-design-comprehension',
  'skills/shesha-form-edit',
  'skills/shesha-design-system',
  'agents',
  'commands',
];

function main() {
  let payload = {};
  try { payload = JSON.parse(require('fs').readFileSync(0, 'utf8')); } catch { return 0; }

  const file = payload.tool_input?.file_path || payload.tool_input?.path;
  if (!file || !file.endsWith('.md')) return 0;

  const norm = file.replace(/\\/g, '/');
  if (!IN_SCOPE.some((s) => norm.includes(`/shesha-developer/${s}`))) return 0;

  const pluginRoot = path.resolve(__dirname, '..', '..');
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'lint-claims.mjs')], {
    cwd: pluginRoot, encoding: 'utf8',
  });
  if (r.status === 0 || r.error) return 0;

  // Report only findings for the file that was just written.
  const base = path.basename(norm);
  const mine = (r.stderr || '').split('\n').filter((l) => l.includes(base));
  if (!mine.length) return 0;

  console.error(
    `[shesha hook] unbacked claim in ${base}:\n${mine.join('\n')}\n\n`
    + `A MUST / enforced / fail-closed / measured assertion needs a script, command, hook or a\n`
    + `validator-backed rule id within a few lines. Either soften the wording to describe what\n`
    + `actually happens, or add the check that makes it true. Do not add a document.`
  );
  return 2;
}

try { process.exit(main()); } catch { process.exit(0); }
