// Representative non-default values per settings field.
// Values are deliberately distinctive so the runner can grep them in computed CSS
// (17 → "17px", #ff00aa → "rgb(255, 0, 170)") or rendered text (GYM-TXT-*).

export const GYM_NUMBER = 17;
export const GYM_COLOR = '#ff00aa';
export const GYM_COLOR_RGB = 'rgb(255, 0, 170)';
export const GYM_ICON = 'StarFilled';
export const MAX_ENUM_VALUES = 6;

// Fallback enum values for dropdowns the extractor couldn't resolve from source.
// Keyed by path (exact), applied to any component.
export const KNOWN_ENUMS = {
  size: ['small', 'middle', 'large'],
  borderType: ['solid', 'dashed', 'dotted', 'double'],
  fontWeight: ['100', '400', '700'],
  labelAlign: ['left', 'right'],
  buttonType: ['primary', 'default', 'dashed', 'link', 'text', 'ghost'],
  direction: ['horizontal', 'vertical'],
  orientation: ['horizontal', 'vertical'],
  textAlign: ['left', 'center', 'right'],
  align: ['left', 'center', 'right'],
  labelPlacement: ['left', 'top'],
  visibility: ['Yes', 'No', 'Removed'],
  dataSourceType: ['values', 'referenceList', 'url'],
  flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  flexWrap: ['wrap', 'nowrap'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between'],
  alignItems: ['flex-start', 'center', 'flex-end', 'stretch'],
  alignSelf: ['flex-start', 'center', 'flex-end'],
  justifySelf: ['start', 'center', 'end'],
  justifyItems: ['start', 'center', 'end'],
  textJustify: ['auto', 'inter-word'],
  fontSize: ['14', '17', '24'],
  padding: ['8px', '17px'],
  display: ['flex', 'block', 'inline-block', 'grid'],
  'background.type': ['color', 'gradient', 'url', 'image', 'storedFile'],
  'background.size': ['cover', 'contain', 'auto'],
  'background.repeat': ['no-repeat', 'repeat', 'repeat-x'],
  'position.value': ['relative', 'absolute'],
  'dimensions.width': ['317px'],
  'dimensions.height': ['117px'],
};

// 0.45 meta-editors that wrap a real input — fall through to path heuristics.
const META_EDITORS = new Set(['settingsInput', 'settingsInputRow']);
// settings-form chrome, never variable settings
const CHROME_EDITORS = new Set(['searchableTabs', 'labelConfigurator']);

// Object-valued setting paths expanded into measurable sub-path variants.
export const PATH_EXPANSIONS = {
  font: [
    { pathOverride: 'font.size', value: GYM_NUMBER, valueKey: 'size17' },
    { pathOverride: 'font.color', value: GYM_COLOR, valueKey: 'color' },
    { pathOverride: 'font.weight', value: '700', valueKey: 'weight700' },
  ],
  border: [
    { pathOverride: 'border.border.all.width', value: `${GYM_NUMBER}px`, valueKey: 'width17' },
    { pathOverride: 'border.border.all.color', value: GYM_COLOR, valueKey: 'color' },
    { pathOverride: 'border.radius.all', value: GYM_NUMBER, valueKey: 'radius17' },
  ],
  // background/shadow render only as COMPLETE objects (partial writes are dead —
  // measured: desktop.background.color alone no-ops; type must be present).
  'background.color': [{
    pathOverride: 'background',
    value: { type: 'color', color: GYM_COLOR },
    valueKey: 'color#ff00aa',
  }],
  'background.gradient.colors': [{
    pathOverride: 'background',
    value: { type: 'gradient', gradient: { direction: 'to right', colors: { 0: GYM_COLOR, 1: '#00ff00' } } },
    valueKey: 'gradient',
  }],
  'shadow.offsetX': [{
    pathOverride: 'shadow',
    value: { offsetX: GYM_NUMBER, offsetY: GYM_NUMBER, blurRadius: GYM_NUMBER, spreadRadius: 0, color: '#000000' },
    valueKey: 'shadow17',
  }],
};

// Sub-paths of compound-only channels — measured via the object expansion above.
const COMPOUND_ONLY = /^background\.(type|size|repeat|url|uploadFile|storedFile)/;

// editorTypes that cannot be visually measured in the gym.
const NOT_MEASURABLE = new Set([
  'codeEditor', 'queryBuilder', 'columnsEditor', 'permissionAutocomplete',
  'configurableActionConfigurator', 'endpointsAutocomplete', 'labelValueEditor',
  'dataSortingEditor', 'formAutocomplete', 'referenceListAutocomplete',
  'imagePicker', 'editableTagGroup', 'autocomplete', 'propertyAutocomplete',
  'contextPropertyAutocomplete', 'multiPropertyAutocomplete', 'columnsConfig',
  'itemListConfiguratorModal', 'keyInformationBarColumnsList', 'filtersList',
  'buttonGroupConfigurator', 'childEntitiesTagGroupModal', 'dynamicItemsConfigurator',
]);

const TEXTY_PATHS = /^(label|placeholder|prefix|suffix|tooltip|description|title|text|emptyText|noDataText|noDataSecondaryText|value|content)$|(Label|Placeholder|Text|Title|Message)$/;
const COLOR_PATH = /color/i;
const PX_PATH = /(size|width|height|gap|radius|gutter|padding|margin|spacing|thickness|offset|blur|spread)/i;
const BOOL_PREFIX = /^(hide|is|show|disable|enable|allow|read|required|bordered|ghost|block|danger|loading|collapsible|collaps|expand|wrap|strong|italic|underline|delete|mark|keep|code)/i;

/**
 * Returns an array of variant specs [{value, valueKey}] for one settings field,
 * or {skip: reason} when not measurable.
 * enums: resolved enum overlay for this component ({path: {values, default}}).
 * defaults: component initModel defaults.
 */
export function representativeValues(field, enums = {}, defaults = {}) {
  const { path } = field;
  let { editorType } = field;
  const currentDefault = enums[path]?.default ?? defaults[path];

  if (editorType && CHROME_EDITORS.has(editorType)) {
    return { skip: `editorType ${editorType} is settings-form chrome` };
  }
  if (PATH_EXPANSIONS[path]) return PATH_EXPANSIONS[path];
  if (COMPOUND_ONLY.test(path)) return { skip: 'compound-only channel — measured via the whole-object variant' };
  if (editorType && META_EDITORS.has(editorType)) editorType = undefined; // path heuristics

  if (editorType && NOT_MEASURABLE.has(editorType)) {
    return { skip: `editorType ${editorType} not visually measurable` };
  }

  switch (editorType) {
    case 'dropdown': {
      const values = enums[path]?.values ?? KNOWN_ENUMS[path] ?? null;
      if (!values || !values.length) return { skip: 'dropdown with unresolved enum values' };
      return values
        .filter((v) => v !== currentDefault)
        .slice(0, MAX_ENUM_VALUES)
        .map((v) => ({ value: v, valueKey: String(v) }));
    }
    case 'checkbox':
    case 'switch': {
      const flip = currentDefault === true ? false : true;
      return [{ value: flip, valueKey: String(flip) }];
    }
    case 'numberField':
    case 'slider':
      return [{ value: GYM_NUMBER, valueKey: String(GYM_NUMBER) }];
    case 'colorPicker':
      return [{ value: GYM_COLOR, valueKey: GYM_COLOR }];
    case 'iconPicker':
      return [{ value: GYM_ICON, valueKey: GYM_ICON }];
    case 'editModeSelector':
      return [{ value: 'readOnly', valueKey: 'readOnly' }];
    case 'styleBox':
      return [{
        value: JSON.stringify({ marginTop: String(GYM_NUMBER), paddingLeft: String(GYM_NUMBER) }),
        valueKey: 'stylingBox17',
      }];
    case 'textField':
    case 'textArea': {
      if (COLOR_PATH.test(path)) return [{ value: GYM_COLOR, valueKey: GYM_COLOR }];
      if (PX_PATH.test(path)) return [{ value: `${GYM_NUMBER}px`, valueKey: `${GYM_NUMBER}px` }];
      return [{ value: `GYM-TXT-${path}`, valueKey: 'txt' }];
    }
    default: {
      // No editorType (partial-KB components) — heuristics by path.
      if (editorType) return { skip: `editorType ${editorType} has no value strategy` };
      if (enums[path]?.values?.length) {
        return enums[path].values
          .filter((v) => v !== currentDefault)
          .slice(0, MAX_ENUM_VALUES)
          .map((v) => ({ value: v, valueKey: String(v) }));
      }
      if (KNOWN_ENUMS[path]) {
        return KNOWN_ENUMS[path]
          .filter((v) => v !== currentDefault)
          .slice(0, MAX_ENUM_VALUES)
          .map((v) => ({ value: v, valueKey: String(v) }));
      }
      if (BOOL_PREFIX.test(path)) {
        const flip = currentDefault === true ? false : true;
        return [{ value: flip, valueKey: String(flip) }];
      }
      if (COLOR_PATH.test(path)) return [{ value: GYM_COLOR, valueKey: GYM_COLOR }];
      if (PX_PATH.test(path)) return [{ value: GYM_NUMBER, valueKey: String(GYM_NUMBER) }];
      if (TEXTY_PATHS.test(path)) return [{ value: `GYM-TXT-${path}`, valueKey: 'txt' }];
      return { skip: 'no editorType and no heuristic match' };
    }
  }
}
