/**
 * Settings-form scaffolding node names that the extractor picks up because they
 * carry a `propertyName`, but which are panel/tab/router containers in the
 * settings UI rather than props on the component model.
 *
 * Matched as: exact names in EXACT_SCAFFOLDING, or the two prefixes below.
 * Deliberately NOT a loose /Panel$/ match — `panelId` and `panelHeaderText`
 * are real props and must survive.
 */
const EXACT_SCAFFOLDING = new Set([
  'settingsTabs',
  'propertyRouter',
  'bordericon',
  'advancedPanel',
  'displayPanel',
  'optionsPanel',
  'toolbarPanel',
  'containerCustomStylePanel',
]);

// `pnlDimensions`, `pnlBorderStyle`, `pnlOnSuccess`, … — the settings-form
// panel convention. `propertyRouter1`, `propertyRouter2`, … — numbered routers.
const SCAFFOLDING_PREFIX = /^(pnl[A-Z]|propertyRouter\d+$)/;

export function isScaffoldingProp(propPath) {
  if (typeof propPath !== 'string' || propPath.length === 0) return true;
  if (EXACT_SCAFFOLDING.has(propPath)) return true;
  return SCAFFOLDING_PREFIX.test(propPath);
}

/**
 * A component is "authorable" when a form author may legitimately emit it.
 * Non-authorable components stay in the registry so the validator can
 * recognise them in existing markup without raising T1-TYPE-UNKNOWN —
 * e.g. `datatableContext` ("Data Context (Legacy)") appears in 9 production forms.
 *
 * Precedence: hidden > legacy > dev > no-settings-form.
 */
const NON_AUTHORABLE_GROUPS = new Map([
  ['Legacy', 'legacy'],
  ['Dev', 'dev'],
]);

export function classifyAuthorability(entry) {
  if (entry.isHidden === true) return { authorable: false, reason: 'hidden' };

  const groupReason = NON_AUTHORABLE_GROUPS.get(entry.group);
  if (groupReason) return { authorable: false, reason: groupReason };

  // No settings form means no discoverable props, so we cannot validate what
  // an author writes on it. Recognise it, never author it.
  if (!entry.propsCount) return { authorable: false, reason: 'no-settings-form' };

  return { authorable: true, reason: null };
}
