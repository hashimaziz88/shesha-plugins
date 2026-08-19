// WP-5d regression: the decompiler emits SFS that passes its own schema even when the
// production envelope's header is hostile.
//
// Before this WP the lift passed `Name`, `ModelType` and `Label` through unchanged, so
// real forms decompiled to SFS that failed SFS-1101 on /form (232 forms), /entity (259)
// and /label (225) — the second-largest round-trip family in
// docs/rebuild-brief/corpus-intake/MINING-REPORT.md §5. The values are now sanitised:
// `form` to a slug, `module` to a valid moduleName, `entity` emitted only when it
// matches clrType (a single-segment or malformed CLR name is omitted, since a custom
// form legally has none), and `label` never an empty string. Pre-fix, the first case
// below threw `DEC-7001 … SFS-1101 … in 3 place(s)`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.mjs';
import { decompile } from '../src/decompile/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/legacy/inline-editable-table.envelope.json'), 'utf8'));

const SLUG = /^[a-z][a-z0-9-]{0,63}$/;

test('a hostile envelope header decompiles to schema-valid SFS', () => {
  const env = { ...base, Name: 'My Form.V2! (Draft)', Label: '   ', ModelType: 'SingleSegment', ModuleName: '123 bad' };
  const { sfs } = decompile(env);
  assert.match(String(sfs.form), SLUG, 'form is coerced to a slug');
  assert.equal(sfs.entity, undefined, 'a single-segment ModelType is omitted, not emitted invalid');
  assert.ok(typeof sfs.label === 'string' && sfs.label.trim() !== '', 'label is never an empty string');
  assert.doesNotThrow(() => compile(JSON.stringify(sfs)),
    'the decompiled SFS must recompile (was DEC-7001 / SFS-1101 in 3 places)');
});

test('a valid dotted ModelType survives; an empty Label falls back to the form', () => {
  const env = { ...base, Name: 'Good Name', Label: '', ModelType: 'boxfusion.test.Domain.Thing.Widget' };
  const { sfs } = decompile(env);
  assert.equal(sfs.entity, 'boxfusion.test.Domain.Thing.Widget', 'a valid clrType is preserved verbatim');
  assert.equal(sfs.label, sfs.form, 'an empty Label falls back to the form slug');
  assert.doesNotThrow(() => compile(JSON.stringify(sfs)));
});

test('the clean legacy envelope still round-trips (no regression)', () => {
  assert.doesNotThrow(() => compile(JSON.stringify(decompile(base).sfs)));
});
