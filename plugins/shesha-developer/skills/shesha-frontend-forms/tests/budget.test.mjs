/**
 * The skill's own shape, asserted.
 *
 * The old stack grew to ~7.8 MB across six skills because nothing measured it. Prose has no
 * natural stopping point, so the stopping point has to be a test.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LIMITS, measureBudget } from '../scripts/lib/budget.mjs';

const SKILL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Tracked files for this skill plus the two artefacts it owns outside the skill directory. */
function trackedFiles() {
  try {
    const out = execFileSync(
      'git',
      [
        'ls-files',
        SKILL_ROOT,
        join(SKILL_ROOT, '..', '..', 'agents', 'shesha-design-critic.md'),
        join(SKILL_ROOT, '..', '..', 'hooks', 'scripts', 'shesha-frontend-forms-gate.cjs'),
      ],
      { encoding: 'utf8', cwd: SKILL_ROOT }
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

describe('skill budget', () => {
  const result = measureBudget(SKILL_ROOT, trackedFiles());

  it('SKILL.md fits in the reading budget', () => {
    assert.ok(result.measured.skill, 'SKILL.md is missing');
    const { lines, tokens } = result.measured.skill;
    assert.ok(lines <= LIMITS.skillMaxLines, `${lines} lines exceeds ${LIMITS.skillMaxLines}`);
    assert.ok(tokens <= LIMITS.skillMaxTokens, `~${tokens} tokens exceeds ${LIMITS.skillMaxTokens}`);
  });

  it('references are shallow, few, and all linked', () => {
    assert.ok(
      result.measured.references.length <= LIMITS.referenceMaxFiles,
      `${result.measured.references.length} references exceeds ${LIMITS.referenceMaxFiles}`
    );
    const unlinked = result.findings.filter((f) => /not linked/.test(f.problem));
    assert.deepEqual(unlinked, [], `unlinked references: ${unlinked.map((f) => f.what).join(', ')}`);
    const nested = result.findings.filter((f) => /one level deep/.test(f.problem));
    assert.deepEqual(nested, [], 'references must be one level deep');
  });

  it('stays under the file ceiling', (t) => {
    if (result.measured.trackedFiles === null) return t.skip('git not available');
    assert.ok(
      result.measured.trackedFiles < LIMITS.trackedMaxFiles,
      `${result.measured.trackedFiles} tracked files reaches the ceiling of ${LIMITS.trackedMaxFiles}`
    );
  });

  it('frontmatter carries name and description only', () => {
    const fm = result.findings.filter((f) => /frontmatter/.test(f.what));
    assert.deepEqual(fm, [], fm.map((f) => f.problem).join('; '));
  });

  it('reports no budget findings at all', () => {
    assert.deepEqual(
      result.findings,
      [],
      result.findings.map((f) => `${f.what}: ${f.problem}`).join('\n')
    );
  });
});
