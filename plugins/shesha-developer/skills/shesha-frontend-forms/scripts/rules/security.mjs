/**
 * Security invariants. Both of these protect against a form that works perfectly and is
 * for that reason dangerous.
 */
import { allComponents, allItems } from '../lib/walk.mjs';

const ANONYMOUS_ACCESS = 5;
const ANON_NAME = /(login|log-in|signin|sign-in|register|signup|sign-up|otp|forgot|reset|public|anonymous)/i;

export const rules = {
  'R-022': {
    id: 'R-022',
    severity: 'fail',
    statement:
      'A form intended to be reachable anonymously carries formSettings.access 5, verified after ' +
      'push by re-fetch. Without it the page redirects to login and the flow is unusable; the ' +
      'symmetric risk is R-041.',
    applies(ctx) {
      const name = `${ctx.formName || ''} ${ctx.formLabel || ''}`;
      return ANON_NAME.test(name)
        ? true
        : { skip: true, reason: 'form name/label does not read as an anonymous form (login/register/otp/forgot/reset/public)' };
    },
    check(markup, ctx) {
      const access = markup?.formSettings?.access;
      if (access === ANONYMOUS_ACCESS) return [];
      return [
        {
          message: `"${ctx.formName || '(unnamed)'}" reads as an anonymous form but formSettings.access is ${JSON.stringify(access ?? null)} — anonymous forms need access ${ANONYMOUS_ACCESS}, otherwise the page redirects to login`,
          fixPointer: 'formSettings/access',
        },
      ];
    },
  },

  'R-041': {
    id: 'R-041',
    severity: 'fail',
    statement:
      'An anonymous form must never write through raw entity CRUD. Public writes go through a ' +
      'custom [AbpAllowAnonymous] app service that forces server-side values and re-enforces ' +
      'validation; the form submits to it via Execute Script.',
    applies(_ctx, markup) {
      return markup?.formSettings?.access === ANONYMOUS_ACCESS
        ? true
        : { skip: true, reason: 'form is not anonymous (access !== 5)' };
    },
    check(markup) {
      const out = [];
      const fs = markup.formSettings || {};
      const submitter = fs.dataSubmitterType;

      const hasFormSubmit = allItems(markup).some((h) => {
        const a = h.node.actionConfiguration;
        return a && a.actionName === 'Submit' && a.actionOwner === 'shesha.form';
      });

      if (hasFormSubmit && (submitter === 'gql' || submitter === undefined)) {
        out.push({
          message:
            'anonymous form (access 5) submits via shesha.form Submit over the default gql submitter — that is raw entity CRUD exposed to the internet. Route public writes through an [AbpAllowAnonymous] app service called from an Execute Script action.',
          fixPointer: 'formSettings/dataSubmitterType',
        });
      }

      // A datatable on an anonymous form reads raw entity data anonymously.
      for (const { node, path } of allComponents(markup)) {
        if (node.type === 'datatableContext' && typeof node.entityType === 'string' && node.entityType) {
          out.push({
            severity: 'warn',
            message: `anonymous form exposes a datatableContext over entity "${node.entityType}" — confirm this data is genuinely public`,
            fixPointer: `${path}/entityType`,
          });
        }
      }
      return out;
    },
  },
};
