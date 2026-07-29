/**
 * buttonGroup item construction — the "buttonGroup shape with Submit/exit
 * wiring" the compiler owns per the task brief. Shape verified against
 * tests/fixtures/t2-clean.json (the project's own hand-authored "this is
 * clean" fixture): { id, itemType: "item", itemSubType: "button", label,
 * buttonType, buttonAction, actionConfiguration: { actionOwner, actionName,
 * _type: "action-config", actionArguments? } }.
 *
 * Deliberately never uses a `formId`/`targetUrl` key for a Navigate target —
 * tier2.mjs's T2-DANGLING-FORMREF keys off exactly those two field names, and
 * a blueprint's `target` (a bare screen id like "employee-table") has no
 * module to pair it with. A `{ navigationType: "url", url }` shape (the same
 * shape assets/examples/employee-create.json's own "Back" button uses) says
 * the same thing without tripping a check that has no way to verify a bare
 * screen id anyway.
 */
import { deterministicId } from './ids.mjs';

const BUTTON_ACTION_BY_NAME = {
  Submit: 'submit',
  'Start Edit': 'startEdit',
  'Cancel Edit': 'cancelEdit',
  Navigate: 'navigate',
  'Close Dialog': 'closeDialog',
  'Show Dialog': 'showDialog',
  'Show Confirmation Dialog': 'showConfirmationDialog',
};

function kebabToUrlSegment(name) {
  return String(name ?? '').trim();
}

function buildActionArguments(item, { form, dependsOnFormsByTarget }) {
  const { action, target } = item;
  if (action.actionName === 'Navigate' && target) {
    // No real module is knowable for a bare blueprint target id — route via
    // a literal URL (never formId/targetUrl, see header comment) rooted at
    // this form's own module so the reference at least resolves within the
    // same app area.
    return { navigationType: 'url', url: `/dynamic/${form?.module ?? 'app'}/${kebabToUrlSegment(target)}` };
  }
  if (action.actionName === 'Show Dialog') {
    const dep = dependsOnFormsByTarget?.createForm;
    if (dep) {
      return {
        modalWidth: '60%',
        showModalFooter: true,
        formId: { module: dep.module, name: dep.name },
      };
    }
  }
  return undefined;
}

/**
 * @param {object} item - blueprint buttonGroupItem: { label, primary?, action: {actionName, actionOwner}, target? }
 * @param {string} idSeed - deterministic seed (unique per item in the tree)
 * @param {{form: object, dependsOnFormsByTarget?: object}} ctx
 */
export function buildButtonGroupItem(item, idSeed, ctx = {}) {
  const { action } = item;
  const actionArguments = buildActionArguments(item, ctx);
  return {
    id: deterministicId(idSeed),
    itemType: 'item',
    itemSubType: 'button',
    label: item.label,
    buttonType: item.primary ? 'primary' : 'default',
    buttonAction: BUTTON_ACTION_BY_NAME[action.actionName] ?? 'custom',
    actionConfiguration: {
      actionOwner: action.actionOwner,
      actionName: action.actionName,
      _type: 'action-config',
      ...(actionArguments ? { actionArguments } : {}),
    },
  };
}

export function buildButtonGroupItems(items, pathSeed, ctx = {}) {
  const list = Array.isArray(items) ? items : [];
  // Tier 3's T3-PRIMARY-COUNT (observe-only) wants exactly one primary action
  // per button zone. A lone action IS the primary one by definition — if the
  // blueprint didn't mark any item primary and there's only one, treat it as
  // primary rather than leave the zone with zero.
  const hasPrimary = list.some((it) => it.primary);
  const effectiveList = (!hasPrimary && list.length === 1) ? [{ ...list[0], primary: true }] : list;
  return effectiveList.map((item, idx) => buildButtonGroupItem(item, `${pathSeed}.items[${idx}]`, ctx));
}
