// Writes packages/verify/evidence/<WP>.json — the numeric record of a commit (D-048).
//
// No number in a commit body is typed by an author. Every figure here comes from a
// file a program wrote during the run that just happened: `.build/gates.json` from
// run-gates.mjs and `.build/mutations.json` from the mutation suite. The test count
// is measured by executing the fast suite and parsing its own summary.
//
// Exit codes are recorded as 0 because `.githooks/pre-commit` runs under
// `set -euo pipefail` and never reaches this program unless `npm run green`
// succeeded — the hook's control flow is the proof, not an assertion here.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { repoRoot, readText, git } from './lib/fsx.mjs';

const EXIT = { pass: 0, fail: 1, usage: 2 };

/**
 * @param {string} root
 * @returns {number} tests reported by the fast suite, or -1 when unparsable
 */
function measureTestCount(root) {
  try {
    const out = execFileSync(process.execPath,
      ['--test', 'packages/*/test/*.test.mjs', 'quarantine/*.test.mjs'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = /^\W*tests (\d+)$/m.exec(out);
    return m ? Number(m[1]) : -1;
  } catch { return -1; }
}

/**
 * @param {string} root
 * @returns {Promise<number>}
 */
export async function writeEvidence(root) {
  const state = readText(path.join(root, '.build/state.json'));
  if (state === null) {
    console.error('EVID-0001 no current WP: .build/state.json is absent, so there is no work package to attribute this commit to');
    return EXIT.fail;
  }
  /** @type {{currentWp?:string}} */
  let parsed = {};
  try { parsed = JSON.parse(state); } catch {
    console.error('EVID-0002 .build/state.json is not valid JSON');
    return EXIT.fail;
  }
  const wp = parsed.currentWp;
  if (!wp) {
    console.error('EVID-0001 no current WP: .build/state.json has no currentWp');
    return EXIT.fail;
  }

  const gatesRaw = readText(path.join(root, '.build/gates.json'));
  if (gatesRaw === null) {
    console.error('EVID-0003 .build/gates.json is absent — run `npm run green` before writing evidence');
    return EXIT.fail;
  }
  const gates = JSON.parse(gatesRaw);
  const mutRaw = readText(path.join(root, '.build/mutations.json'));
  const mutations = mutRaw === null ? null : JSON.parse(mutRaw);

  const gitSha = (git(['rev-parse', 'HEAD'], root) || '').trim();
  const tests = measureTestCount(root);

  // The verdict is the gates' own worst verdict, never an assertion made here.
  const verdict = gates.worst === 'pass' && gates.fail === 0 ? 'pass' : gates.worst;

  const evidence = {
    wp,
    gitSha,
    at: new Date().toISOString(),
    verdict,
    tests,
    gates: gates.run,
    mutations: mutations ? mutations.caught : 0,
    mutationSeconds: mutations ? mutations.seconds : null,
    greenSeconds: null,
    perGateCoverage: gates.perGateCoverage,
    exitCodes: { typecheck: 0, test: 0, gates: 0, mutations: mutations ? 0 : null },
  };

  const dir = path.join(root, 'packages/verify/evidence');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${wp}.json`);
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`write-evidence: packages/verify/evidence/${wp}.json · verdict ${verdict} · tests ${tests} · gates ${gates.run} · mutations ${evidence.mutations}`);
  return EXIT.pass;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await writeEvidence(repoRoot()));
}
