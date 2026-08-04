/**
 * The skill's own budget, measured.
 *
 * The brief sets hard limits on this skill's shape: SKILL.md stays small enough to be read every
 * time, references/ stays shallow enough to navigate, and the file count stays low enough that
 * the toolchain cannot quietly become another 7.8 MB of prose. Those are MUSTs, and every MUST in
 * this build maps to a validator — including the ones about the build itself. A budget that is
 * only written down is a budget that gets exceeded.
 *
 * Token counting is deliberately an ESTIMATE and deliberately conservative. There is no
 * tokeniser here (adding a dependency to count tokens would itself cost budget), so the ratio
 * is set below what English prose actually achieves: under-counting would let the file grow past
 * the real limit, so the estimate errs the other way.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LIMITS = {
  skillMaxLines: 250,
  skillMaxTokens: 3000,
  referenceMaxFiles: 5,
  trackedMaxFiles: 55,
  // Conservative: real English is nearer 4.0 chars/token, so 3.5 over-estimates the count.
  charsPerToken: 3.5,
};

export function estimateTokens(text) {
  return Math.ceil(text.length / LIMITS.charsPerToken);
}

/**
 * Measure the skill. `trackedFiles` is passed in rather than shelled out for, so this stays a
 * pure function of the filesystem and callers decide whether git is available.
 */
export function measureBudget(skillRoot, trackedFiles = null) {
  const findings = [];
  const measured = {};

  // ---- SKILL.md ---------------------------------------------------------------------
  const skillPath = join(skillRoot, 'SKILL.md');
  if (!existsSync(skillPath)) {
    findings.push({ what: 'SKILL.md', problem: 'missing — the skill has no entry point' });
    measured.skill = null;
  } else {
    const text = readFileSync(skillPath, 'utf8');
    const lines = text.split('\n').length;
    const tokens = estimateTokens(text);
    measured.skill = { lines, tokens, chars: text.length };
    if (lines > LIMITS.skillMaxLines) {
      findings.push({ what: 'SKILL.md', problem: `${lines} lines exceeds ${LIMITS.skillMaxLines}` });
    }
    if (tokens > LIMITS.skillMaxTokens) {
      findings.push({ what: 'SKILL.md', problem: `~${tokens} tokens exceeds ${LIMITS.skillMaxTokens}` });
    }

    // Frontmatter carries `name` and `description` and nothing else.
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      findings.push({ what: 'SKILL.md', problem: 'no frontmatter block' });
    } else {
      const keys = fm[1]
        .split('\n')
        .filter((l) => /^[a-zA-Z][\w-]*:/.test(l))
        .map((l) => l.slice(0, l.indexOf(':')));
      const extra = keys.filter((k) => k !== 'name' && k !== 'description');
      if (extra.length) {
        findings.push({ what: 'SKILL.md frontmatter', problem: `unexpected keys: ${extra.join(', ')}` });
      }
      for (const required of ['name', 'description']) {
        if (!keys.includes(required)) {
          findings.push({ what: 'SKILL.md frontmatter', problem: `missing ${required}` });
        }
      }
    }
  }

  // ---- references/ ------------------------------------------------------------------
  const refDir = join(skillRoot, 'references');
  measured.references = [];
  if (existsSync(refDir)) {
    for (const entry of readdirSync(refDir)) {
      const p = join(refDir, entry);
      if (statSync(p).isDirectory()) {
        // One level deep only: a nested reference tree is how progressive disclosure turns back
        // into a document set nobody reads.
        findings.push({ what: `references/${entry}`, problem: 'is a directory — references must be one level deep' });
        continue;
      }
      measured.references.push(entry);
    }
    if (measured.references.length > LIMITS.referenceMaxFiles) {
      findings.push({
        what: 'references/',
        problem: `${measured.references.length} files exceeds ${LIMITS.referenceMaxFiles}`,
      });
    }
    // A reference nothing links to is a document that will go stale unread.
    if (measured.skill) {
      const text = readFileSync(skillPath, 'utf8');
      for (const r of measured.references) {
        if (!text.includes(`references/${r}`)) {
          findings.push({ what: `references/${r}`, problem: 'not linked from SKILL.md' });
        }
      }
    }
  }

  // ---- file count -------------------------------------------------------------------
  if (Array.isArray(trackedFiles)) {
    measured.trackedFiles = trackedFiles.length;
    if (trackedFiles.length >= LIMITS.trackedMaxFiles) {
      findings.push({
        what: 'file count',
        problem: `${trackedFiles.length} tracked files reaches the ceiling of ${LIMITS.trackedMaxFiles}`,
      });
    }
  } else {
    measured.trackedFiles = null;
  }

  return { ok: findings.length === 0, findings, measured, limits: LIMITS };
}
