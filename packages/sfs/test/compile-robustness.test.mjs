// WP-5c regression: compiler robustness on leaf input types.
//
// 103 of the 121 registry records carry no `defaults` block, and store `slots` as an
// object {kind, names, …} rather than an array. Before this WP, a field of any such
// type crashed s4-expand — first `Cannot read properties of undefined (reading
// 'hidden')` (rec.defaults undefined), then `(slots).includes is not a function`
// (slots an object). Together that is the `compile-npe: reading 'hidden'` the mining
// run hit on 498 real production forms (docs/rebuild-brief/corpus-intake/
// MINING-REPORT.md §5, the single largest round-trip blocker). Each such field must
// now compile, not crash. The clean fixtures never exercised these types, which is
// why Scope A stayed green while real forms did not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compile/index.mjs';

/** A minimal create form whose one field is `component`. @param {string} component */
const formWith = (component) => JSON.stringify({
  sfs: '1.0',
  form: `robust-${component.toLowerCase()}`,
  module: 'boxfusion.test',
  kind: 'create',
  entity: 'boxfusion.test.Domain.Test.Thing',
  label: 'Robustness',
  submits: true,
  page: { title: 'Robustness' },
  body: [{
    node: 'col',
    name: 'formBody',
    children: [{ node: 'field', name: 'x', bind: 'xValue', component }],
  }],
});

// Three representative leaf input types: no `defaults`, `slots` recorded as an object.
for (const component of ['checkbox', 'switch', 'radio']) {
  test(`a field of leaf input type "${component}" (no registry defaults) compiles instead of crashing`, () => {
    /** @type {any} */
    let result;
    assert.doesNotThrow(
      () => { result = compile(formWith(component)); },
      `compiling a ${component} field must not crash s4-expand (was the 498-form compile-npe)`,
    );
    const markup = String(result.envelope.Markup);
    assert.ok(markup.includes(`"type":"${component}"`), `${component} is present in the compiled markup`);
    assert.ok(markup.includes('"hidden":false'), 'a node whose record has no defaults still gets hidden:false');
  });
}
