/**
 * datatable column-item construction. Shape verified against
 * assets/examples/employee-table.json's real, working "data" columns:
 * { id, propertyName, description, allowSorting, caption, columnType: "data",
 *   createComponent: {type:"[not-editable]"}, displayComponent:
 *   {type:"[default]"}, editComponent: {type:"[not-editable]"}, isVisible,
 *   itemType: "item", maxWidth, minWidth, sortOrder }.
 *
 * Deliberately uses `columnType` (not `type`) for the column-kind field —
 * matching the real example exactly avoids the `type`-key namespace
 * collision tier1.mjs's own header comment documents (a column entry
 * carrying a literal `type` key gets treated as a pseudo component node by
 * walk.mjs's flatten(), which tier1 has to special-case back out again).
 * editComponent/createComponent both use the one shape tier1.mjs's
 * T1-EDITCOMPONENT-SHAPE accepts unconditionally ("[not-editable]").
 */
import { deterministicId } from './ids.mjs';

function labelFromPropertyName(name) {
  const spaced = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function columnPropertyName(col) {
  if (typeof col === 'string') return col;
  return col.propertyName ?? col.field ?? col.name;
}

export function buildColumn(col, idx, pathSeed) {
  const propertyName = columnPropertyName(col);
  const caption = (typeof col === 'object' && col.name) ? col.name : labelFromPropertyName(propertyName);
  return {
    id: deterministicId(`${pathSeed}.items[${idx}]`),
    propertyName,
    description: '',
    allowSorting: true,
    caption,
    columnType: 'data',
    createComponent: { type: '[not-editable]' },
    displayComponent: { type: '[default]' },
    editComponent: { type: '[not-editable]' },
    isVisible: true,
    itemType: 'item',
    maxWidth: 250,
    minWidth: 150,
    sortOrder: idx,
  };
}

export function buildColumns(columns, pathSeed) {
  return (Array.isArray(columns) ? columns : []).map((col, idx) => buildColumn(col, idx, pathSeed));
}
