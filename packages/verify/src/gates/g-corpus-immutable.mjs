// D-013 / B8: the corpus seed forms are IMMUTABLE. A round-trip that fails is
// triaged (a BACKLOG row), never fixed by editing the corpus to make it pass —
// that would be the "edit the expected-output file" failure S7 exists to stop.
//
// One family, `hashes`, unit `file`: every path in corpus-manifest.json must hash
// to its recorded sha256. An edited corpus form flips the gate. The manifest is
// regenerated only when the corpus legitimately changes, never to silence a diff.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { families, report, runGuarded, verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-corpus-immutable';
export const describe = 'every corpus seed form hashes to its recorded sha256; the corpus is never edited to fake a round-trip';
export const inputPaths = [
  'packages/sfs/config/corpus-manifest.json',
  'packages/sfs/corpus',
  'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json',
  'package.json',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'hashes', unit: 'file' }]);
  const fam = fams.get('hashes');

  const manifestPath = path.join(root, 'packages/sfs/config/corpus-manifest.json');
  if (!fs.existsSync(manifestPath)) { fam.pointer('corpus-manifest.json').fail('corpus-manifest.json is missing'); return fams.list; }
  const manifest = /** @type {{forms:{path:string, sha256:string}[]}} */ (JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const forms = manifest.forms || [];
  fam.pointer('manifest#nonempty').assert(forms.length > 0, 'the manifest lists no forms; the immutability check would be vacuous');

  for (const entry of forms) {
    const p = fam.pointer(entry.path);
    const abs = path.join(root, entry.path);
    if (!fs.existsSync(abs)) { p.fail(`corpus form ${entry.path} is in the manifest but missing on disk`); continue; }
    const sha = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    p.assert(sha === entry.sha256, `${entry.path} was edited: sha256 ${sha.slice(0, 12)} != recorded ${String(entry.sha256).slice(0, 12)} (D-013/B8: triage, never edit the corpus)`);
  }
  return fams.list;
}

export const mutations = [
  {
    name: 'a corpus form is edited (its recorded hash no longer matches)',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/config/corpus-manifest.json');
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      // Corrupt one recorded hash — equivalent to the file being edited under it.
      m.forms[0].sha256 = '0'.repeat(64);
      fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a manifest entry points at a corpus form that no longer exists',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/config/corpus-manifest.json');
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      m.forms.push({ path: 'packages/sfs/corpus/__deleted__.json', sha256: 'a'.repeat(64) });
      fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`);
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return verdictOf(fams) === 'pass' ? EXIT.pass : EXIT.fail;
  }));
}
