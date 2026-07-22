#!/usr/bin/env node
/**
 * PostToolUse hook (Write|Edit): if the written file is Shesha form markup,
 * run validate-guardrails.js + validate-styledness.js automatically.
 * Exit 2 (blocking feedback to Claude) on FAIL findings; silent otherwise.
 * Never blocks non-form files. Fails open on unexpected errors.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { return 0; }
  let payload;
  try { payload = JSON.parse(input); } catch { return 0; }
  const filePath = payload?.tool_input?.file_path;
  if (!filePath || !filePath.endsWith('.json')) return 0;
  if (!fs.existsSync(filePath)) return 0;
  if (fs.statSync(filePath).size > 5 * 1024 * 1024) return 0;

  let doc;
  try { doc = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return 0; } // not valid JSON yet — Step 5.5 catches it
  // Detect form markup: components array of typed nodes (raw, GetJson response, or golden wrapper)
  const tree = doc?.components || doc?.markup?.components ||
    (typeof doc?.markup === 'string' && doc.markup.includes('"components"') ? 'stringified' : null);
  const isMarkup = Array.isArray(tree) ? tree.some((c) => c && typeof c.type === 'string') : tree === 'stringified';
  if (!isMarkup) return 0;
  // Skip bundled skill assets (seeds/golden/blocks) — only gate freshly authored work
  if (/[\\/](assets|components-kb|node_modules)[\\/]/.test(filePath)) return 0;

  const skillScripts = path.join(__dirname, '..', '..', 'skills', 'shesha-form-edit', 'scripts');
  const problems = [];

  // cheapest gate first: JSON Schema (known types, id/version/defaultValue shapes)
  const schema = spawnSync('node', [path.join(skillScripts, 'validate-schema.js'), filePath], { encoding: 'utf8', timeout: 20000 });
  if (schema.status === 1) problems.push(`validate-schema FAIL:\n${(schema.stdout + schema.stderr).trim().slice(0, 1500)}`);

  const guard = spawnSync('node', [path.join(skillScripts, 'validate-guardrails.js'), filePath], { encoding: 'utf8', timeout: 20000 });
  if (guard.status === 1) problems.push(`validate-guardrails FAIL:\n${(guard.stdout + guard.stderr).trim().slice(0, 2000)}`);

  const styled = spawnSync('node', [path.join(skillScripts, 'validate-styledness.js'), filePath], { encoding: 'utf8', timeout: 20000 });
  if (styled.status === 1) problems.push(`validate-styledness FAIL:\n${(styled.stdout + styled.stderr).trim().slice(0, 1200)}`);

  if (problems.length) {
    console.error(`[shesha hook] form markup written to ${path.basename(filePath)} failed mechanical gates — fix before pushing:\n\n${problems.join('\n\n')}\n\n(If this file is an intentional intermediate, fix at the next write; these gates re-run automatically.)`);
    return 2;
  }
  return 0;
}

try { process.exit(main()); } catch { process.exit(0); }
