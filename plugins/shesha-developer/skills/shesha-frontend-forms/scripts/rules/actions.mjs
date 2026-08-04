/**
 * Action wiring. Downstream tooling infers a form's intent from its buttonGroup items,
 * so a mis-wired Submit misreads the whole form, not just one button.
 */
import { allComponents, allItems, parentMap } from '../lib/walk.mjs';

const NAVIGATE_KEYS = ['target', 'targetUrl', 'url'];

function actionOf(node) {
  return node && node.actionConfiguration ? node.actionConfiguration : null;
}

export const rules = {
  'R-007': {
    id: 'R-007',
    severity: 'fail',
    statement:
      'Form action buttons live in ONE buttonGroup, never as standalone button components. ' +
      'Submit carries actionName "Submit" with actionOwner "shesha.form" and is paired with an ' +
      'exit button, because downstream tooling reads form intent from the buttonGroup items.',
    applies(_ctx, markup) {
      /**
       * MEASURED CORRECTION. This read `dataSubmitterType !== 'none'`, so an ABSENT submitter
       * counted as "this form submits" and the rule demanded a Submit button. Three of the four
       * real forms it fired on are read-only list views with dataSubmitterType undefined — not
       * configured, therefore not submitting. Absent is not enabled.
       */
      const submitter = markup?.formSettings?.dataSubmitterType;
      const submits = typeof submitter === 'string' && submitter !== '' && submitter !== 'none';
      return submits
        ? true
        : { skip: true, reason: `no submitter configured (dataSubmitterType=${JSON.stringify(submitter)}), so there is no action floor` };
    },
    check(markup) {
      const out = [];
      const parents = parentMap(markup);
      const items = allItems(markup);

      // A standalone button carrying a form action belongs in the group.
      for (const { node, path } of allComponents(markup)) {
        if (node.type !== 'button') continue;
        const a = actionOf(node);
        if (a && a.actionOwner === 'shesha.form') {
          out.push({
            message: `standalone button "${node.componentName || node.id}" carries a shesha.form action — form actions belong in one buttonGroup`,
            fixPointer: path,
          });
        }
      }

      const submitItems = items.filter(({ node }) => {
        const a = actionOf(node);
        return a && a.actionName === 'Submit';
      });

      if (submitItems.length === 0) {
        out.push({
          message: 'form submits but no buttonGroup item carries actionName "Submit"',
          fixPointer: 'components',
        });
      }
      for (const { node, path } of submitItems) {
        const a = actionOf(node);
        if (a.actionOwner !== 'shesha.form') {
          out.push({
            message: `Submit item "${node.label || node.name || node.id}" has actionOwner "${a.actionOwner}" — it must be "shesha.form"`,
            fixPointer: `${path}/actionConfiguration/actionOwner`,
          });
        }
      }

      // Submit needs an exit partner, or the user is trapped on the form.
      if (submitItems.length > 0) {
        const hasExit = items.some(({ node }) => {
          const a = actionOf(node);
          if (!a) return false;
          if (a.actionName === 'Navigate' || a.actionName === 'Cancel') return true;
          return /back|cancel|close|exit/i.test(String(node.label || node.name || ''));
        });
        if (!hasExit) {
          out.push({
            severity: 'warn',
            message: 'Submit has no paired exit button (Back/Close/Cancel) — the user has no way out of the form',
            fixPointer: 'components',
          });
        }
      }

      // At most one primary per group, or the visual hierarchy is meaningless.
      const groups = new Map();
      for (const { node, parent } of items) {
        const g = parent || parents.get(node);
        if (!g) continue;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(node);
      }
      for (const [g, its] of groups) {
        const primaries = its.filter((i) => i.buttonType === 'primary');
        if (primaries.length > 1) {
          out.push({
            severity: 'warn',
            message: `buttonGroup "${g.componentName || g.id}" has ${primaries.length} primary buttons — exactly one action should read as primary`,
            fixPointer: null,
          });
        }
      }
      return out;
    },
  },

  'R-008': {
    id: 'R-008',
    severity: 'fail',
    statement:
      'Every Navigate action carries a destination APPROPRIATE TO ITS navigationType: a `url` ' +
      'navigation needs a non-empty target, a `form` navigation needs a formId. A missing ' +
      'destination renders <Link href={undefined}> and crashes the page.',
    check(markup) {
      const out = [];
      const check = (node, path, label) => {
        const a = actionOf(node);
        if (!a || a.actionName !== 'Navigate') return;
        const args = a.actionArguments || {};

        /**
         * MEASURED CORRECTION. This rule originally required a `target` key on every Navigate and
         * fired six times across the real forms on this backend — every one of them a valid
         * form-navigation: `{navigationType: 'form', formId: {name, module}, queryParameters: […]}`.
         * `target` is the shape for navigationType 'url' only, so the rule was flagging correct
         * production markup as a crash. The destination key depends on the navigationType.
         */
        const navType = typeof args.navigationType === 'string' ? args.navigationType : null;

        if (navType === 'form') {
          const f = args.formId;
          const ok =
            (typeof f === 'string' && f.trim() !== '') ||
            (f && typeof f === 'object' && (f.id || (f.name && f.module)));
          if (!ok) {
            out.push({
              message: `Navigate action on ${label} is a form navigation with no resolvable formId — needs an id, or a name plus module`,
              fixPointer: `${path}/actionConfiguration/actionArguments/formId`,
            });
          }
          return;
        }

        const value = NAVIGATE_KEYS.map((k) => args[k]).find((v) => typeof v === 'string' && v.trim() !== '');
        if (!value) {
          // An unknown navigationType is not judged: guessing at its destination key is how the
          // previous version of this rule produced false positives.
          if (navType && navType !== 'url') {
            out.push({
              severity: 'warn',
              message: `Navigate action on ${label} has navigationType "${navType}", whose destination key is not known to this rule — verify it resolves`,
              fixPointer: `${path}/actionConfiguration/actionArguments`,
            });
            return;
          }
          out.push({
            message: `Navigate action on ${label} has no non-empty target — this renders <Link href=undefined> and crashes the page`,
            fixPointer: `${path}/actionConfiguration/actionArguments/target`,
          });
        }
      };
      for (const { node, path, isItem } of [...allComponents(markup), ...allItems(markup)].map((h) => h)) {
        check(node, path, isItem ? `item "${node.label || node.id}"` : `${node.type} "${node.componentName || node.id}"`);
      }
      // Datatable action columns carry their own actionConfiguration.
      for (const { node, path } of allComponents(markup)) {
        const cols = Array.isArray(node.items) ? node.items : [];
        for (let i = 0; i < cols.length; i += 1) {
          if (cols[i] && cols[i].columnType === 'action') {
            check(cols[i], `${path}/items/${i}`, `action column "${cols[i].description || i}"`);
          }
        }
      }
      return out;
    },
  },

  'R-044': {
    id: 'R-044',
    severity: 'fail',
    statement:
      'Row delete/unlink is an Execute Script action doing `await http.delete(...)` plus a ' +
      'Refresh whose actionOwner is the dataContext component id. There is no "Delete row" ' +
      'action and no owner called "table" — using them throws.',
    check(markup) {
      const out = [];
      for (const { node, path, isItem } of [...allComponents(markup), ...allItems(markup)]) {
        const a = actionOf(node);
        if (!a) continue;
        if (a.actionName === 'Delete row') {
          out.push({
            message: `${isItem ? 'item' : node.type} "${node.label || node.componentName || node.id}" uses actionName "Delete row", which does not exist and throws at runtime`,
            fixPointer: `${path}/actionConfiguration/actionName`,
          });
        }
        if (a.actionOwner === 'table') {
          out.push({
            message: `${isItem ? 'item' : node.type} "${node.label || node.componentName || node.id}" uses actionOwner "table", which does not exist — use the dataContext component's id`,
            fixPointer: `${path}/actionConfiguration/actionOwner`,
          });
        }
      }
      return out;
    },
  },
};
