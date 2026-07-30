/**
 * Leaf / non-structural component construction: text, the field-input types
 * (textField/numberField/dateField/attachmentsEditor/dropdown), barChart,
 * validationErrors, and the datatable.* toolbar pseudo-components.
 *
 * editMode resolution mirrors tier2.mjs's own T2-EDITMODE-MISMATCH contract
 * exactly (references/components/edit-mode.md): a form carrying a
 * "Start Edit"/shesha.form buttonGroup action anywhere is a detail-lifecycle
 * form, so its interactive inputs must be "inherited"; otherwise they must
 * be "editable". INTERACTIVE_TYPES is duplicated (not imported) from
 * tier2.mjs's own curated set — tier2.mjs must not be modified, and it does
 * not export the set.
 */
const INTERACTIVE_TYPES = new Set([
  'textField', 'textArea', 'numberField', 'dropdown', 'autocomplete', 'checkbox', 'checkboxGroup',
  'switch', 'radio', 'dateField', 'timePicker', 'calendar', 'entityPicker', 'entityReference',
  'fileUpload', 'colorPicker', 'rate', 'slider', 'richTextEditor', 'passwordCombo', 'address',
  'attachmentsEditor', 'editableTagGroup', 'autocompleteTagGroup', 'formAutocomplete', 'iconPicker',
]);

function camelCase(name) {
  const s = String(name ?? '');
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * @param {object} bpNode - the blueprint node (already type-resolved)
 * @param {string} resolvedType - the concrete registry type
 * @param {{binding?: object, isDetailForm: boolean, notes?: string[]}} ctx
 */
export function buildLeafComponent(bpNode, resolvedType, { binding, isDetailForm, notes }) {
  const componentName = bpNode.node;
  const out = { componentName };

  if (resolvedType === 'text') {
    out.propertyName = camelCase(componentName);
    out.content = bpNode.content ?? '';
    // Tier 3's T3-HEADER-FONT-INCOMPLETE (observe-only, not gating, but cheap
    // to satisfy): a text node whose name reads as a heading/title needs its
    // own font.size/font.weight or it just inherits ambient body-text sizing.
    if (/head|title/i.test(componentName)) {
      out.font = { size: 24, weight: '600' };
    }
    return out;
  }

  if (resolvedType === 'barChart') {
    out.propertyName = camelCase(componentName);
    out.title = bpNode.content ?? '';
    out.chartType = 'bar';
    return out;
  }

  if (resolvedType === 'validationErrors') {
    return out;
  }

  if (resolvedType === 'datatable.quickSearch' || resolvedType === 'datatable.pager') {
    return out;
  }

  // Field-input types: propertyName from the binding (preferred — it's the
  // real entity property path) else the node's own camelCase name; label
  // from the binding's label else the blueprint's literal content
  // (normalize-form.mjs sentence-cases whatever `label` ends up here).
  const propertyName = binding?.property ?? camelCase(componentName);
  out.propertyName = propertyName;
  out.label = binding?.label ?? bpNode.content ?? propertyName;

  if (INTERACTIVE_TYPES.has(resolvedType)) {
    out.editMode = isDetailForm ? 'inherited' : 'editable';
  }

  applyDataSource(out, resolvedType, binding, notes);

  return out;
}

/**
 * Option/entity inputs need an explicit data source or they render as a silently
 * empty box — no console error, no failed request, just nothing to pick from
 * (`T2-DROPDOWN-SOURCE`). The compiler cannot derive the source: a reference
 * list's identity comes verbatim from live metadata [R-015] and an entity FK's
 * target comes from the entity config, so both arrive on the binding or not at
 * all.
 *
 * When the binding carries one, emit it. When it does not, emit NOTHING and add
 * a note naming the binding and the key to supply. Inventing a plausible
 * reference-list name would produce a form that passes every gate and renders an
 * empty dropdown — strictly worse than a blocked compile.
 */
const DATASOURCE_TYPES = new Set(['dropdown', 'radio', 'checkboxGroup', 'autocomplete']);

function applyDataSource(out, resolvedType, binding, notes) {
  if (!DATASOURCE_TYPES.has(resolvedType)) return;

  if (binding?.referenceList) {
    out.dataSourceType = 'referenceList';
    out.referenceListId = {
      module: binding.referenceList.module,
      name: binding.referenceList.name,
    };
    return;
  }

  if (binding?.entityType) {
    out.dataSourceType = 'entitiesList';
    out.entityType = binding.entityType;
    return;
  }

  if (Array.isArray(binding?.values) && binding.values.length > 0) {
    out.dataSourceType = 'values';
    // checkboxGroup reads `items`; the others read `values`. Ids are the
    // compiler's business, and must be deterministic so regeneration stays
    // byte-identical — never a fresh UUID.
    const key = resolvedType === 'checkboxGroup' ? 'items' : 'values';
    out[key] = binding.values.map((v, i) => (
      key === 'items'
        ? { label: v.label, value: v.value }
        : { id: v.id ?? `${out.propertyName}-opt${i + 1}`, label: v.label, value: v.value }
    ));
    return;
  }

  notes?.push(
    `${out.componentName} (${resolvedType}): no data source. An option/entity input renders as an `
    + 'empty box without one, and the compiler cannot invent a reference-list identity [R-015]. Add '
    + `\`referenceList: { module, name }\` (or \`entityType\`, or \`values[]\`) to the binding labelled `
    + `"${binding?.label ?? out.label}" in the blueprint's bindings[].`,
  );
}
