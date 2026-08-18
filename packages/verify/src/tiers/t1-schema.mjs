// T1 — schema validation (§3.2.2). The cheapest tier: does an SFS document validate
// against sfs.schema.json? WP-4 ships this; WP-3a wires it into verify.mjs with the
// `envelope`/`file` families and the ENVELOPE-SYNTHESISED uninspectable rule.
//
// One family, `schema`, unit `file`: every *.sfs.json under the given directory is a
// pointer, checked when it validates and failed with the ajv message when it does
// not. A directory with no fixtures walks 0 and fails — zero coverage is never a pass.
//
//   node packages/verify/src/tiers/t1-schema.mjs <dir>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import { families, report, verdictOf, EXIT, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);

/**
 * @param {string} root
 * @param {string} dir directory of *.sfs.json to validate, repo-relative or absolute
 * @returns {import('@shesha/registry/coverage').Family[]}
 */
export function t1Schema(root, dir) {
  const fams = families([{ name: 'schema', unit: 'file' }]);
  const fam = fams.get('schema');

  const schemaPath = path.join(root, 'packages/sfs/schema/sfs.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  const abs = path.isAbsolute(dir) ? dir : path.join(root, dir);
  const files = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith('.sfs.json')).sort() : [];
  // An empty directory would let the tier pass over nothing; the family walks a
  // sentinel that fails, so 0 fixtures is a fail, not a vacuous pass.
  if (files.length === 0) {
    fam.pointer(`${dir}#empty`).fail(`no *.sfs.json under ${dir}; a schema tier over nothing is not a pass`);
    return fams.list;
  }

  for (const f of files) {
    const rel = `${dir}/${f}`;
    const p = fam.pointer(rel);
    /** @type {unknown} */
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8').replace(/^﻿/, '')); } catch (e) {
      p.fail(`${rel} is not valid JSON: ${/** @type {Error} */ (e).message}`);
      continue;
    }
    if (validate(doc)) { p.check(); continue; }
    const first = (validate.errors || []).slice(0, 2)
      .map((/** @type {any} */ e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    p.fail(`${rel} fails sfs.schema.json: ${first}`);
  }
  return fams.list;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (dir === undefined) { console.error('usage: t1-schema.mjs <dir-of-sfs-fixtures>'); process.exit(EXIT.usage); }
  process.exit(await runGuarded(async () => {
    const fams = t1Schema(repoRoot(), dir);
    const fam = fams.find((x) => x.name === 'schema');
    const valid = fam?.checked ?? 0;
    const total = fam?.walked ?? 0;
    console.log(report(fams, { title: 't1-schema' }));
    console.log(`${valid}/${total} valid`);
    return verdictOf(fams) === 'pass' ? EXIT.pass : EXIT.fail;
  }));
}
