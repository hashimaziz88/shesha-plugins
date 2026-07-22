// Per-component baseline scaffolds: minimal valid settings + structural wrapping
// so every component type actually renders in a gym form.
// Entity binding targets boxfusion.test Asset (14 seeded rows verified).

import { gymUuid } from './ids.js';

export const GYM_ENTITY = 'boxfusion.test.Domain.Domain.Assets.Asset';
export const GYM_MODULE = 'boxfusion.test';
export const HELPER_FORM = 'gym-item-card';

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
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5CYII=';

const textChild = (type, mk, label = `GYM child of ${type}`) =>
  mk('text', { content: label, textType: 'span', contentDisplay: 'content' });

const dataColumn = (mk, propertyName, caption, sortOrder) => ({
  id: mk('__id', {}).id, // deterministic id only
  itemType: 'item',
  sortOrder,
  caption,
  columnType: 'data',
  propertyName,
  isVisible: true,
  allowSorting: true,
  minWidth: 100,
  displayComponent: { type: '[default]' },
  editComponent: { type: '[not-editable]' },
  createComponent: { type: '[not-editable]' },
});

// Wrap an instance in its own datatableContext bound to Asset.
const wrapInDatatableCtx = (instance, mk) => {
  const ctx = mk('datatableContext', {
    version: 7,
    entityType: GYM_ENTITY,
    sourceType: 'Entity',
    dataFetchingMode: 'paging',
    defaultPageSize: 3,
    sortMode: 'standard',
    allowReordering: 'no',
    hidden: false,
    components: [instance],
  });
  ctx.componentName = `gymCtx${ctx.id.slice(0, 8)}`;
  ctx.propertyName = ctx.componentName;
  instance.parentId = ctx.id;
  return [ctx];
};

const helperFormId = { name: HELPER_FORM, module: GYM_MODULE };

/**
 * Scaffold registry. Each entry may define:
 *   props:      extra baseline props merged over initModel defaults
 *   bind:       propertyName to bind (inputs default to 'gymValue' — a form-data
 *               only property, safe when no Asset field fits)
 *   children:   (type, mk) => child components for the instance's 'components' slot
 *   build:      (instance, mk) => void — mutate instance for complex slots (tabs/steps/columns)
 *   wrap:       (instance, mk) => component[] replacing the instance at wrapper level
 * mk(type, props) creates a child component with a deterministic id.
 */
export const SCAFFOLDS = {
  // ---- simple bound inputs ----
  textField: { bind: ASSET_PROPS.string },
  textArea: { bind: ASSET_PROPS.string2 },
  dateField: { bind: ASSET_PROPS.date },
  timePicker: { bind: 'gymValue' },
  numberField: { bind: 'gymValue' },
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
  statusTag: { bind: ASSET_PROPS.reflist },
  entityReference: { bind: ASSET_PROPS.entity },

  // ---- content/display ----
  text: { props: { content: 'GYM-TEXT-CONTENT', textType: 'span', contentDisplay: 'content' } },
  paragraph: { props: { content: 'GYM paragraph content', contentDisplay: 'content' } },
  title: { props: { content: 'GYM title', contentDisplay: 'content' } },
  alert: { props: { alertType: 'info', text: 'GYM alert text' } },
  link: { props: { href: '#gym', content: 'GYM link', target: '_self' } },
  markdown: { props: { content: '## GYM markdown\n\nSome **bold** text.' } },
  htmlRender: { props: { renderer: 'return \"<div>GYM html</div>\";' } },
  image: { props: { dataSource: 'url', url: GYM_IMG_DATA_URI, allowPreview: false } },
  progress: { props: { progressType: 'line', percent: 42 } },

  // ---- containers ----
  container: {
    props: { direction: 'vertical', display: 'block' },
    children: (type, mk) => [textChild(type, mk)],
  },
  card: { children: (type, mk) => [textChild(type, mk)] },
  section: { children: (type, mk) => [textChild(type, mk)] },
  list: { children: (type, mk) => [textChild(type, mk)] },
  drawer: { children: (type, mk) => [textChild(type, mk)] },
  propertyRouter: { children: (type, mk) => [textChild(type, mk)] },
  collapsiblePanel: {
    props: { collapsedByDefault: false, expandIconPosition: 'start' },
    build: (instance, mk) => {
      const content = { id: gymUuid(instance.id, 'content'), components: [textChild('collapsiblePanel', mk)] };
      content.components[0].parentId = instance.id;
      instance.content = content;
      instance.header = { id: gymUuid(instance.id, 'header'), components: [] };
    },
  },
  tabs: {
    props: { tabType: 'line', defaultActiveKey: 'gymTab1' },
    build: (instance, mk) => {
      instance.tabs = [1, 2].map((n) => ({
        id: gymUuid(instance.id, `tab${n}`),
        key: `gymTab${n}`,
        title: `Gym Tab ${n}`,
        components: [textChild(`tabs tab${n}`, mk)].map((c) => ({ ...c, parentId: instance.id })),
      }));
    },
  },
  wizard: {
    build: (instance, mk) => {
      instance.steps = [1, 2].map((n) => ({
        id: gymUuid(instance.id, `step${n}`),
        key: `gymStep${n}`,
        title: `Gym Step ${n}`,
        subTitle: '',
        description: '',
        components: [textChild(`wizard step${n}`, mk)].map((c) => ({ ...c, parentId: instance.id })),
      }));
    },
  },
  columns: {
    props: { gutterX: 16, gutterY: 8 },
    build: (instance, mk) => {
      instance.columns = [1, 2].map((n) => ({
        id: gymUuid(instance.id, `col${n}`),
        flex: 12,
        offset: 0,
        push: 0,
        pull: 0,
        components: [textChild(`columns col${n}`, mk)].map((c) => ({ ...c, parentId: instance.id })),
      }));
    },
  },
  sizableColumns: {
    build: (instance, mk) => {
      instance.columns = [1, 2].map((n) => ({
        id: gymUuid(instance.id, `scol${n}`),
        size: 50,
        components: [textChild(`sizableColumns col${n}`, mk)].map((c) => ({ ...c, parentId: instance.id })),
      }));
    },
  },
  KeyInformationBar: {
    props: { orientation: 'horizontal', gap: 16 },
    build: (instance, mk) => {
      instance.columns = [1, 2].map((n) => ({
        id: gymUuid(instance.id, `kib${n}`),
        width: 200,
        textAlign: 'center',
        flexDirection: 'column',
        components: [textChild(`KeyInformationBar col${n}`, mk)].map((c) => ({ ...c, parentId: instance.id })),
      }));
    },
  },

  // ---- datatable family (each wrapped in its own Asset context) ----
  datatable: {
    props: { canEditInline: 'no', canAddInline: 'no', canDeleteInline: 'no', useMultiselect: false },
    build: (instance, mk) => {
      instance.items = [
        { ...dataColumn(mk, 'name', 'Name', 0), parentId: instance.id },
        { ...dataColumn(mk, 'category', 'Category', 1), parentId: instance.id },
      ];
    },
    wrap: wrapInDatatableCtx,
  },
  'datatable.filter': { wrap: wrapInDatatableCtx },
  'datatable.pager': { wrap: wrapInDatatableCtx },
  'datatable.quickSearch': { wrap: wrapInDatatableCtx },
  'datatable.selectColumnsButton': { wrap: wrapInDatatableCtx },
  tableViewSelector: {
    props: { filters: [] },
    wrap: wrapInDatatableCtx,
  },
  childTable: {
    children: (type, mk) => [textChild(type, mk)],
    wrap: wrapInDatatableCtx,
  },
  datalist: {
    props: {
      formSelectionMode: 'name',
      formId: helperFormId,
      orientation: 'vertical',
      selectionMode: 'none',
      cardSpacing: '12',
    },
    wrap: wrapInDatatableCtx,
  },
  toolbar: {},

  // ---- entity-bound pickers ----
  entityPicker: {
    bind: ASSET_PROPS.entity,
    props: { entityType: ASSET_PROPS.entityType, displayEntityKey: 'fullName', mode: 'single', valueFormat: 'entityReference' },
  },
  autocomplete: {
    bind: 'gymValue',
    props: {
      dataSourceType: 'entitiesList',
      entityTypeShortAlias: GYM_ENTITY,
      entityDisplayProperty: 'name',
      mode: 'single',
      useRawValues: true,
    },
  },
  subForm: {
    bind: 'gymSubForm',
    props: { formSelectionMode: 'name', formId: helperFormId, dataSource: 'form' },
  },

  // ---- misc structural ----
  buttonGroup: {
    props: { spaceSize: 'middle' },
    build: (instance) => {
      instance.items = [{
        id: gymUuid(instance.id, 'btn1'),
        itemType: 'item',
        itemSubType: 'button',
        sortOrder: 0,
        name: 'gymBtn',
        label: 'Gym Button',
        buttonType: 'default',
      }];
    },
  },
  chart: {
    props: {
      dataMode: 'entityType',
      entityType: GYM_ENTITY,
      chartType: 'bar',
      axisProperty: 'category',
      valueProperty: 'id',
      aggregationMethod: 'count',
      simulatedData: false,
      showTitle: false,
    },
  },
  fileUpload: { props: { ownerId: '', allowUpload: true, allowReplace: false, allowDelete: false } },
  attachmentsEditor: { props: { ownerId: '', filesCategory: 'gym', allowAdd: true } },
  address: { props: { showPriorityBounds: false, minCharactersSearch: 3 } },
  wizardSettings: {},
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

/** The helper form some scaffolds reference (datalist/subForm item card). */
export function buildHelperForm(textFieldVersion = 5) {
  const rootId = gymUuid('helper', 'root');
  return {
    components: [{
      id: gymUuid('helper', 'name-field'),
      type: 'textField',
      version: textFieldVersion,
      propertyName: 'name',
      label: 'Name',
      parentId: rootId,
      textType: 'text',
    }],
    formSettings: {
      layout: 'horizontal',
      colon: true,
      labelCol: { span: 6 },
      wrapperCol: { span: 18 },
      modelType: GYM_ENTITY,
    },
  };
}
