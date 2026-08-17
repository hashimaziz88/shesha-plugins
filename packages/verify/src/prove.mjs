// The integration proof (§5.3). One command ends the session.
//
// "Session complete" is defined as exactly this: `npm run prove` exits 0 and its
// final line is `SESSION COMPLETE — SCOPE A`. A green `npm test`, a satisfied
// to-do list and a confident summary paragraph are explicitly insufficient — that
// combination is the state the pre-rebuild repository was already in.
//
// No path prints SESSION COMPLETE from an incomplete scope. Scope completion is
// read from BUILD-LOG.md, which records a WP complete only when its acceptance
// command exited 0, so this program cannot be satisfied by an author's assertion.
//
// The Q1-Q4 property checks and the tier runs arrive with their subjects in WP-1,
// WP-3a and WP-5. Until then those steps report notRun, and `--partial` is the
// only mode that can succeed at all.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, families, readJsonGuarded, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from './lib/fsx.mjs';
import { completedWps } from './lib/session-state.mjs';

/** The proof's ordered steps. Each names the WP that makes it runnable. */
const STEPS = [
  { id: 'green', label: 'green', needs: 'WP-0' },
  { id: 'compile', label: 'compile', needs: 'WP-5' },
  { id: 'Q1', label: 'Q1 selfconsist', needs: 'WP-1' },
  { id: 'Q2', label: 'Q2 oracle', needs: 'WP-1' },
  { id: 'Q3', label: 'Q3 escapes', needs: 'WP-5' },
  { id: 'Q4', label: 'Q4 defects', needs: 'WP-5' },
  { id: 'tiers', label: 'tiers', needs: 'WP-3a' },
  { id: 'uninspectable', label: 'uninspectable', needs: 'WP-3a' },
  { id: 'roundtrip', label: 'roundtrip', needs: 'WP-5' },
  { id: 'cost', label: 'cost delta', needs: 'WP-10' },
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<{scope:string[], done:string[], remaining:string[]}>}
 */
export async function scopeState(ctx) {
  const fams = families([{ name: 'scope', unit: 'file' }]);
  const got = readJsonGuarded(path.join(ctx.repoRoot, 'packages/verify/config/session-scope.json'),
    fams.get('scope'), 'session-scope.json');
  if (!got.ok) return { scope: [], done: [], remaining: [] };
  const scope = /** @type {{wps:string[]}} */ (got.value).wps || [];
  const completed = completedWps(ctx.repoRoot);
  const done = scope.filter((w) => completed.has(w));
  const remaining = scope.filter((w) => !completed.has(w));
  return { scope, done, remaining };
}

async function main() {
  const root = repoRoot();
  const partial = process.argv.includes('--partial');
  const bless = process.argv.includes('--bless');
  const only = (() => {
    const i = process.argv.indexOf('--only');
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(',') : null;
  })();

  const { scope, done, remaining } = await scopeState({ repoRoot: root });
  if (scope.length === 0) {
    console.error('prove: packages/verify/config/session-scope.json is missing or unreadable');
    return EXIT.usage;
  }

  console.log('=== SHESHA SFS REBUILD — INTEGRATION PROOF (SCOPE A) ===');
  console.log(`scope            ${scope.join(' ')}   ${done.length}/${scope.length} complete`);

  const runnable = new Set(done);
  for (const step of STEPS) {
    if (only && !only.includes(step.id)) continue;
    const label = step.label.padEnd(16);
    if (!runnable.has(step.needs)) {
      console.log(`${label} notRun — ${step.needs} is not recorded complete in BUILD-LOG.md`);
      continue;
    }
    // A step whose WP is complete but whose implementation is absent is a defect,
    // not a pass: it is reported notRun with that distinction stated.
    console.log(`${label} notRun — ${step.needs} is complete but this step ships in a later work package`);
  }

  if (bless) {
    console.error('\nprove --bless: refused. Blessing an expected-output file is permitted only once');
    console.error('WP-1 has produced Q1/Q2 output to freeze, and once in WP-10. Neither has run.');
    return EXIT.usage;
  }

  if (remaining.length > 0) {
    console.log(`SESSION INCOMPLETE — completed ${done.length ? done.join(',') : 'none'}; remaining ${remaining.join(',')}`);
    return partial ? EXIT.partial : EXIT.fail;
  }

  // Reaching here means every scoped WP is recorded complete. The proof's own
  // steps still have to pass before the final line may be printed, and they do
  // not exist yet, so this path deliberately refuses to print SESSION COMPLETE.
  console.log('SESSION INCOMPLETE — every scoped WP is recorded complete but the proof steps are not implemented');
  return partial ? EXIT.partial : EXIT.fail;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(main));
}
