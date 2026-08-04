/**
 * Data-wiring invariants: the wrapper, the columns, the loaders, the submit payload.
 */
import { allComponents, findAncestor, tableColumns } from '../lib/walk.mjs';

const TABLE_TYPES = new Set(['datatable', 'datalist']);

export const rules = {
  'R-005': {
    id: 'R-005',
    severity: 'fail',
    statement:
      'datatable/datalist sit inside a dataContext wrapper carrying an explicit entityType ' +
      '(the fullClassName string) and sourceType "Entity". The wrapper does not inherit from ' +
      'formSettings.modelType — a bare dataContext 500s on page load.',
    applies(_ctx, markup) {
      const has = allComponents(markup).some(({ node }) => TABLE_TYPES.has(node.type));
      return has ? true : { skip: true, reason: 'no datatable/datalist in this form' };
    },
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (!TABLE_TYPES.has(node.type)) continue;
        const ctxNode = findAncestor(markup, node, (a) => a.type === 'datatableContext' || a.type === 'dataContext');
        if (!ctxNode) {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" has no datatableContext/dataContext ancestor — it cannot fetch anything`,
            fixPointer: path,
          });
          continue;
        }
        if (typeof ctxNode.entityType !== 'string' || !ctxNode.entityType) {
          out.push({
            message: `${ctxNode.type} "${ctxNode.componentName || ctxNode.id}" has no explicit entityType string — it does not inherit formSettings.modelType and will 500 on load`,
            fixPointer: `${path}/../entityType`,
          });
        }
        if (ctxNode.sourceType !== undefined && ctxNode.sourceType !== 'Entity') {
          out.push({
            severity: 'warn',
            message: `${ctxNode.type} sourceType is "${ctxNode.sourceType}" — entity-backed tables use "Entity"`,
            fixPointer: `${path}/../sourceType`,
          });
        }
      }
      return out;
    },
  },

  'R-010': {
    id: 'R-010',
    severity: 'fail',
    statement:
      'Inline-edit column editors are either {"type":"[not-editable]"} or ' +
      '{"type":"<editor>","settings":{...full component model...}}. "[default]" is valid only on ' +
      'displayComponent, and a flat model without `settings` throws "reading \'version\'".',
    applies(_ctx, markup) {
      const has = allComponents(markup).some(({ node }) =>
        tableColumns(node).some((c) => c && (c.editComponent || c.createComponent))
      );
      return has ? true : { skip: true, reason: 'no inline-edit column editors in this form' };
    },
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        const cols = tableColumns(node);
        for (let i = 0; i < cols.length; i += 1) {
          const col = cols[i];
          if (!col) continue;
          for (const key of ['editComponent', 'createComponent']) {
            const ed = col[key];
            if (!ed) continue;
            const where = `${path}/items/${i}/${key}`;
            if (typeof ed !== 'object') {
              out.push({ message: `column "${col.caption || col.propertyName}" ${key} must be an object`, fixPointer: where });
              continue;
            }
            if (ed.type === '[not-editable]') continue;
            if (ed.type === '[default]') {
              out.push({
                message: `column "${col.caption || col.propertyName}" ${key} uses "[default]", which is only valid on displayComponent`,
                fixPointer: `${where}/type`,
              });
              continue;
            }
            if (!ed.settings || typeof ed.settings !== 'object') {
              out.push({
                message: `column "${col.caption || col.propertyName}" ${key} is a flat model without a settings object — this throws "reading 'version'" at render`,
                fixPointer: where,
              });
              continue;
            }
            if (ed.settings.version === undefined) {
              out.push({
                message: `column "${col.caption || col.propertyName}" ${key}.settings has no version`,
                fixPointer: `${where}/settings/version`,
              });
            }
          }
        }
      }
      return out;
    },
  },

  'R-011': {
    id: 'R-011',
    severity: 'fail',
    statement:
      'checkboxGroup hardcoded options use `items` of {label, value}. dropdown/radio use ' +
      '`values` of {id, label, value}. Conflating the two renders an empty control.',
    applies(_ctx, markup) {
      const has = allComponents(markup).some(({ node }) =>
        ['checkboxGroup', 'dropdown', 'radio'].includes(node.type)
      );
      return has ? true : { skip: true, reason: 'no checkboxGroup/dropdown/radio in this form' };
    },
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        const manual = node.dataSourceType === 'values' || node.dataSourceType === undefined;
        if (node.type === 'checkboxGroup' && node.dataSourceType === 'values') {
          if (Array.isArray(node.values) && !Array.isArray(node.items)) {
            out.push({
              message: 'checkboxGroup uses `values` — hardcoded checkboxGroup options live in `items` of {label, value}',
              fixPointer: `${path}/values`,
            });
          }
          for (const it of node.items || []) {
            if (it && (it.label === undefined || it.value === undefined)) {
              out.push({ message: 'checkboxGroup items entries need both label and value', fixPointer: `${path}/items` });
              break;
            }
          }
        }
        if (['dropdown', 'radio'].includes(node.type) && manual) {
          if (Array.isArray(node.items) && !Array.isArray(node.values)) {
            out.push({
              message: `${node.type} uses \`items\` — hardcoded ${node.type} options live in \`values\` of {id, label, value}`,
              fixPointer: `${path}/items`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-017': {
    id: 'R-017',
    severity: 'warn',
    statement:
      'Entity-bound forms keep the default gql loader/submitter. Custom form-level endpoints are ' +
      'opt-in and need a real app-service behind them, so an unrequested custom endpoint is ' +
      'usually an accident.',
    applies(_ctx, markup) {
      return markup?.formSettings ? true : { skip: true, reason: 'no formSettings' };
    },
    check(markup) {
      const out = [];
      const fs = markup.formSettings;
      for (const key of ['dataLoaderType', 'dataSubmitterType']) {
        const v = fs[key];
        if (v === 'custom') {
          out.push({
            message: `formSettings.${key} is "custom" — custom endpoints are opt-in and need an app service; the default is "gql"`,
            fixPointer: `formSettings/${key}`,
          });
        }
      }
      return out;
    },
  },

  'R-037': {
    id: 'R-037',
    severity: 'warn',
    statement:
      'Dynamic CRUD Update rejects a foreign key sent as a nested object ("not allowed to be ' +
      'updated"), so every FK must be reduced to {id} in formSettings.onPrepareSubmitData.',
    applies(_ctx, markup) {
      const submits = markup?.formSettings?.dataSubmitterType !== 'none';
      return submits ? true : { skip: true, reason: 'form does not submit' };
    },
    check(markup, ctx) {
      const out = [];
      const prep = markup?.formSettings?.onPrepareSubmitData;
      const hasPrep = typeof prep === 'string' ? prep.trim().length > 0 : !!prep;

      // FK-ness is a metadata fact and is never guessed from a name.
      if (!ctx.modelProperties) {
        const bound = allComponents(markup).filter(({ node }) => node.propertyName);
        if (bound.length && !hasPrep) {
          out.push({
            message:
              'form submits and binds properties but carries no onPrepareSubmitData, and no live metadata was available to determine which are FK objects — verify manually or re-run probe with a backend',
            fixPointer: 'formSettings/onPrepareSubmitData',
          });
        }
        return out;
      }

      const fkPaths = new Set(
        (ctx.modelProperties || [])
          .filter((p) => p.dataType === 'entity' && typeof p.path === 'string')
          .map((p) => p.path.toLowerCase())
      );
      const boundFks = allComponents(markup)
        .filter(({ node }) => node.propertyName && fkPaths.has(String(node.propertyName).toLowerCase()))
        .map(({ node }) => node.propertyName);

      if (boundFks.length && !hasPrep) {
        out.push({
          severity: 'fail',
          message: `form binds FK object propert${boundFks.length > 1 ? 'ies' : 'y'} ${boundFks.join(', ')} and submits, but has no onPrepareSubmitData to reduce them to {id} — Crud/Update will reject the payload`,
          fixPointer: 'formSettings/onPrepareSubmitData',
        });
      }
      return out;
    },
  },

  'R-039': {
    id: 'R-039',
    severity: 'warn',
    statement:
      'onInitialized is not wired on dynamic pages in 0.45, so code placed there never runs. ' +
      'Custom load-time work belongs in onAfterDataLoad, which is async-capable.',
    check(markup) {
      const v = markup?.formSettings?.onInitialized;
      const has = typeof v === 'string' ? v.trim().length > 0 : !!v;
      if (!has) return [];
      return [
        {
          message: 'formSettings.onInitialized is non-empty but is not wired on dynamic pages in 0.45 — move the work to onAfterDataLoad',
          fixPointer: 'formSettings/onInitialized',
        },
      ];
    },
  },
};
