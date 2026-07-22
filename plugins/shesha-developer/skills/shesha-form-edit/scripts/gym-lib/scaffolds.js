// Per-component baseline scaffolds: minimal valid settings + structural wrapping
// so every component type actually renders in a gym form.
// Entity binding targets boxfusion.test Asset (14 seeded rows verified).

import { gymUuid } from './ids.js';

export const GYM_ENTITY = 'boxfusion.test.Domain.Domain.Assets.Asset';
export const GYM_MODULE = 'boxfusion.test';

export const ASSET_PROPS = {
  string: 'name',
  string2: 'serialNumber',
  reflist: 'status',
  reflistId: { module: 'boxfusion.test', name: 'AssetStatus' },
  entity: 'assignedEmployee',
  entityType: 'Shesha.Domain.Person',
  date: 'purchaseDate',
};

// Fields the generator must never vary regardless of KB groups.
export const NEVER_VARY = new Set([
  'propertyName', 'componentName', 'id', 'type', 'version', 'parentId',
  'context', 'queryParams', 'name',
]);

// 1x1 transparent png for image baselines.
export const GYM_IMG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Scaffold registry. Each entry may define:
 *   props:      extra baseline props merged over initModel defaults
 *   bind:       propertyName to bind (inputs default to 'gymValue' — a form-data
 *               only property, safe when no Asset field fits)
 *   children:   (type, mk) => child components for the instance's own slot key
 *   childSlot:  slot key for children (default 'components')
 *   wrap:       (instance, mk) => component[] replacing the instance at wrapper level
 *               (e.g. datatable needs a datatableContext parent)
 * mk(type, props) creates a child component with deterministic id.
 */
export const SCAFFOLDS = {
  textField: { bind: ASSET_PROPS.string },
  textArea: { bind: ASSET_PROPS.string2 },
  dropdown: {
    bind: ASSET_PROPS.reflist,
    props: { dataSourceType: 'referenceList', referenceListId: ASSET_PROPS.reflistId },
  },
  radio: {
    bind: ASSET_PROPS.reflist,
    props: { dataSourceType: 'referenceList', referenceListId: ASSET_PROPS.reflistId },
  },
  checkboxGroup: {
    bind: ASSET_PROPS.reflist,
    props: { dataSourceType: 'referenceList', referenceListId: ASSET_PROPS.reflistId, mode: 'multiple' },
  },
  refListStatus: {
    bind: ASSET_PROPS.reflist,
    props: { referenceListId: ASSET_PROPS.reflistId, showIcon: false, solidBackground: true },
  },
  dateField: { bind: ASSET_PROPS.date },
  container: {
    props: { direction: 'vertical', display: 'block' },
    children: (type, mk) => [mk('text', { content: `GYM child of ${type}`, textType: 'span' })],
  },
  text: { props: { content: 'GYM-TEXT-CONTENT', textType: 'span', contentDisplay: 'content' } },
};

export function scaffoldFor(type) {
  return SCAFFOLDS[type] || {};
}

export function makeChild(ownerType, variantKey) {
  let seq = 0;
  return (type, props = {}) => ({
    id: gymUuid(ownerType, variantKey, 'child', String(seq++)),
    type,
    version: props.version ?? 2,
    label: '',
    hideLabel: true,
    ...props,
  });
}
