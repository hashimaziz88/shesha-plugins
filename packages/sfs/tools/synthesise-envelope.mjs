// Builds the 23-field form-configuration envelope around a bare seed.
//
// Every seed under the old assets/examples/ was bare `{components, formSettings}`
// with no `Markup` key, so there is nothing on disk with a real envelope to compile
// against. This tool synthesises one, and says so: the sibling `.form.meta.json`
// carries `provenance: "ENVELOPE-SYNTHESISED"`, and T1's `file` family reports
// `uninspectable` on any artifact flagged that way — partial, exit 3, never pass.
// Validating the 23 fields against a real backend export is BL-006.
//
// The field ORDER is taken from the real boxfusion.test/bookings-table revision 2
// envelope, so a synthesised envelope and a real one differ in values, never shape.
//
// Usage: node packages/sfs/tools/synthesise-envelope.mjs <seed.json> --out <envelope.json>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXIT = { pass: 0, fail: 1, usage: 2 };

/**
 * The 23 envelope fields in the order the real revision-2 export carries them.
 * `Markup` first is not cosmetic: it is the only field the compiler writes.
 */
export const ENVELOPE_FIELDS = [
  'Markup', 'ModelType', 'TemplateId', 'IsTemplate', 'Access', 'Permissions',
  'ConfigurationForm', 'GenerationLogicTypeName', 'GenerationLogicExtensionJson',
  'PlaceholderIcon', 'Id', 'OriginId', 'Name', 'Label', 'ItemType', 'Description',
  'ModuleName', 'FrontEndApplication', 'Suppress', 'DateUpdated', 'BaseModules',
  'Comments', 'ConfigHash',
];

/** Fields that identify a specific stored revision. A synthesised envelope has none. */
const IDENTITY_FIELDS = new Set([
  'TemplateId', 'Id', 'OriginId', 'ConfigHash', 'DateUpdated', 'PlaceholderIcon',
  'GenerationLogicTypeName', 'GenerationLogicExtensionJson', 'Permissions',
  'BaseModules', 'Comments', 'Description', 'Label', 'FrontEndApplication',
]);

export const SYNTHESISED = 'ENVELOPE-SYNTHESISED';

/**
 * @param {{components:unknown, formSettings:Record<string, unknown>}} seed
 * @param {string} screen the seed's basename, used for Name
 * @returns {Record<string, unknown>}
 */
export function synthesise(seed, screen) {
  // Compact, and in the key order the seed was read in: this string is the exact
  // thing the oracle normalises and the compiler must agree with.
  const markup = JSON.stringify({ components: seed.components, formSettings: seed.formSettings });

  /** @type {Record<string, unknown>} */
  const envelope = {};
  for (const field of ENVELOPE_FIELDS) {
    if (field === 'Markup') envelope[field] = markup;
    else if (field === 'ModelType') envelope[field] = seed.formSettings?.modelType ?? null;
    else if (field === 'Name') envelope[field] = screen;
    else if (field === 'ItemType') envelope[field] = 'form';
    else if (field === 'ModuleName') envelope[field] = null;
    else if (field === 'IsTemplate') envelope[field] = false;
    else if (field === 'Suppress') envelope[field] = false;
    else if (field === 'Access') envelope[field] = seed.formSettings?.access ?? null;
    else if (field === 'ConfigurationForm') envelope[field] = null;
    else if (IDENTITY_FIELDS.has(field)) envelope[field] = null;
    else envelope[field] = null;
  }
  return envelope;
}

/**
 * @param {string} outPath
 * @param {string} seedPath
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>} the meta sidecar
 */
export function metaFor(outPath, seedPath, envelope) {
  const markup = /** @type {string} */ (envelope.Markup);
  return {
    provenance: SYNTHESISED,
    reason: 'the seed carried no Markup key; the 23 fields are shaped from the real revision-2 export and every identity field is null',
    synthesisedFrom: seedPath.split(path.sep).join('/'),
    artifact: outPath.split(path.sep).join('/'),
    markupBytes: Buffer.byteLength(markup, 'utf8'),
    envelopeFields: ENVELOPE_FIELDS.length,
    validatedAgainstBackend: false,
    validationOwner: 'BL-006',
  };
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const args = argv.slice(2);
  const seedPath = args[0];
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  if (!seedPath || !outPath) {
    console.error('usage: node packages/sfs/tools/synthesise-envelope.mjs <seed.json> --out <envelope.json>');
    return EXIT.usage;
  }

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(seedPath, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    console.error(`synthesise-envelope: cannot read ${seedPath}: ${/** @type {Error} */ (e).message}`);
    return EXIT.fail;
  }
  if (!Array.isArray(seed.components) || typeof seed.formSettings !== 'object' || seed.formSettings === null) {
    console.error(`synthesise-envelope: ${seedPath} is not a bare {components, formSettings} seed`);
    return EXIT.fail;
  }
  if ('Markup' in seed) {
    console.error(`synthesise-envelope: ${seedPath} already carries a Markup key; it is an envelope, not a seed`);
    return EXIT.fail;
  }

  const screen = path.basename(seedPath).replace(/\.seed\.json$|\.json$/, '');
  const envelope = synthesise(seed, screen);
  const meta = metaFor(outPath, seedPath, envelope);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`);
  const metaPath = outPath.replace(/\.json$/, '.form.meta.json');
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`synthesise-envelope: ${outPath}`);
  console.log(`  fields ${ENVELOPE_FIELDS.length}/23 · markup ${meta.markupBytes} B · provenance ${SYNTHESISED}`);
  console.log(`  ${metaPath}`);
  return EXIT.pass;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exit(main(process.argv));
}
