/**
 * Structural invariants. Violations here mean the renderer produces nothing useful —
 * a blank page, a crash, or inputs silently rendered read-only.
 */
import { allComponents, parentMap } from '../lib/walk.mjs';

const ROOT = 'root';

export const rules = {
  'R-001': {
    id: 'R-001',
    severity: 'fail',
    statement:
      'Every component carries parentId set to its direct parent id; root components carry "root". ' +
      'A missing parentId crashes the renderer with no useful error.',
    check(markup) {
      const out = [];
      const parents = parentMap(markup);
      for (const { node, path } of allComponents(markup)) {
        const parent = parents.get(node);
        const expected = parent ? parent.id : ROOT;
        if (node.parentId === undefined || node.parentId === null || node.parentId === '') {
          out.push({ message: `${node.type} "${node.componentName || node.id}" has no parentId (expected ${expected})`, fixPointer: `${path}/parentId` });
        } else if (node.parentId !== expected) {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" has parentId "${node.parentId}" but its direct parent is "${expected}"`,
            fixPointer: `${path}/parentId`,
          });
        }
      }
      return out;
    },
  },

  'R-002': {
    id: 'R-002',
    severity: 'fail',
    statement:
      'Every component id is a generated unique nanoid/UUID, unique across the whole form. ' +
      'Short human-typed placeholders render blank; duplicates silently overwrite each other ' +
      'because the flat structure is keyed by id.',
    check(markup) {
      const out = [];
      const seen = new Map();
      for (const { node, path } of allComponents(markup)) {
        const id = node.id;
        if (typeof id !== 'string' || id.length < 10) {
          out.push({
            message: `${node.type} "${node.componentName || '(unnamed)'}" has id ${JSON.stringify(id)} — ids must be a generated nanoid/UUID of at least 10 chars`,
            fixPointer: `${path}/id`,
          });
          continue;
        }
        if (!/[a-z]/i.test(id) || !/[0-9a-z_-]/i.test(id)) {
          out.push({ message: `${node.type} id "${id}" does not look generated`, fixPointer: `${path}/id` });
        }
        if (seen.has(id)) {
          out.push({
            message: `duplicate component id "${id}" (${node.type} and ${seen.get(id)}) — the flat structure is keyed by id, so one silently overwrites the other`,
            fixPointer: `${path}/id`,
          });
        } else {
          seen.set(id, node.type);
        }
      }
      return out;
    },
  },

  'R-006': {
    id: 'R-006',
    severity: 'fail',
    statement:
      'A validationErrors component is present whenever any input is required — otherwise a ' +
      'failed submit renders nothing at all and the user sees no reason for the rejection.',
    applies(_ctx, markup) {
      const comps = allComponents(markup);
      const hasRequired = comps.some(({ node }) => node.validate && node.validate.required === true);
      return hasRequired ? true : { skip: true, reason: 'no required inputs in this form' };
    },
    check(markup) {
      const comps = allComponents(markup);
      const has = comps.some(({ node }) => node.type === 'validationErrors');
      if (has) return [];
      const required = comps
        .filter(({ node }) => node.validate && node.validate.required === true)
        .map(({ node }) => node.propertyName || node.componentName || node.type);
      return [
        {
          message: `form has ${required.length} required input(s) (${required.slice(0, 5).join(', ')}) but no validationErrors component — a failed submit will render nothing`,
          fixPointer: 'components',
        },
      ];
    },
  },

  'R-009': {
    id: 'R-009',
    severity: 'fail',
    statement:
      'defaultValue is a mustache-template STRING, never a literal array/number/object. The ' +
      'resolver calls .match() on it, so a non-string throws "e.match is not a function" and ' +
      'kills the whole render.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (!('defaultValue' in node)) continue;
        const v = node.defaultValue;
        if (v === null || v === undefined || typeof v === 'string') continue;
        // A code-mode setting is an object by design and is resolved before .match().
        if (typeof v === 'object' && v._mode) continue;
        out.push({
          message: `${node.type} "${node.componentName || node.id}" has a non-string defaultValue (${Array.isArray(v) ? 'array' : typeof v}) — this throws "e.match is not a function" at render`,
          fixPointer: `${path}/defaultValue`,
        });
      }
      return out;
    },
  },

  'R-018': {
    id: 'R-018',
    severity: 'warn',
    statement:
      'editMode "inherited" on a form that can never enter edit mode renders every input as a ' +
      'blank read-only span. The original rule also said "never blanket-stamp editMode", which ' +
      'is judgment and was dropped; this is the checkable half.',
    applies(_ctx, markup) {
      const loader = markup?.formSettings?.dataLoaderType;
      return loader === 'none'
        ? true
        : { skip: true, reason: `dataLoaderType is "${loader ?? '(unset)'}", so the form can enter edit mode` };
    },
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (node.editMode === 'inherited') {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" uses editMode "inherited" on a form with dataLoaderType "none" — it will render blank`,
            fixPointer: `${path}/editMode`,
          });
        }
      }
      return out;
    },
  },

  'R-021': {
    id: 'R-021',
    severity: 'warn',
    statement:
      'Input components carry a human-readable label distinct from the raw propertyName. ' +
      'Labels are user-facing and are how browser tests locate fields.',
    applies(ctx) {
      return ctx.registry ? true : { skip: true, reason: 'needs the ground-truth registry to know which types are inputs' };
    },
    check(markup, ctx) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        const def = ctx.registry[node.type];
        if (!def || def.isInput !== true) continue;
        if (node.hideLabel === true) continue;
        const label = node.label;
        if (typeof label !== 'string' || label.trim() === '') {
          out.push({ message: `input ${node.type} "${node.propertyName || node.id}" has no label`, fixPointer: `${path}/label` });
          continue;
        }
        if (node.propertyName && label.trim() === String(node.propertyName).trim()) {
          out.push({
            message: `input ${node.type} label "${label}" is the raw propertyName — give it a human-readable label`,
            fixPointer: `${path}/label`,
          });
        }
      }
      return out;
    },
  },

  'R-025': {
    id: 'R-025',
    severity: 'fail',
    statement:
      'When editing an existing form, ids on components that already existed are preserved; ' +
      'fresh ids only for genuinely new nodes. Regenerating ids orphans every reference to them.',
    applies(ctx) {
      return ctx.baseline ? true : { skip: true, reason: 'no --baseline supplied, so nothing to compare against' };
    },
    check(markup, ctx) {
      const out = [];
      const now = new Set(allComponents(markup).map(({ node }) => node.id));
      for (const { node } of allComponents(ctx.baseline)) {
        if (!now.has(node.id)) {
          out.push({
            message: `component id "${node.id}" (${node.type} "${node.componentName || ''}") existed in the baseline but is gone — preserve ids when editing`,
            fixPointer: 'components',
          });
        }
      }
      return out;
    },
  },

  'R-031': {
    id: 'R-031',
    severity: 'fail',
    statement:
      'Conditional visibility is code-mode `hidden` returning a real boolean (true hides). ' +
      'Legacy customVisibility is ignored entirely on 0.45, so a form relying on it shows ' +
      'everything unconditionally.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (node.customVisibility !== undefined && node.customVisibility !== null && node.customVisibility !== '') {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" uses customVisibility, which 0.45 ignores — move the expression to code-mode hidden`,
            fixPointer: `${path}/customVisibility`,
          });
        }
        if (node.customEnabled !== undefined && node.customEnabled !== null && node.customEnabled !== '') {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" uses customEnabled, which is deprecated — use code-mode disabled/editMode`,
            fixPointer: `${path}/customEnabled`,
          });
        }
        // A code-mode hidden that cannot survive a missing data context fails open,
        // showing a field that should be hidden. Create forms have no data initially.
        const h = node.hidden;
        if (h && typeof h === 'object' && h._mode === 'code' && typeof h._code === 'string') {
          if (/\bdata\s*\./.test(h._code) && !/\bdata\s*\?\./.test(h._code)) {
            out.push({
              severity: 'warn',
              message: `${node.type} "${node.componentName || node.id}" hidden code dereferences data without optional chaining — a create form has no data context initially and a throw fails open`,
              fixPointer: `${path}/hidden/_code`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-046': {
    id: 'R-046',
    group: 'process',
    severity: 'fail',
    statement:
      'A validated file on disk is not a delivered form. Enforced by the push ledger and its ' +
      'Stop hook, which land in Phase 5 — not by an offline markup check.',
    applies() {
      return { skip: true, reason: 'deferred to Phase 5 (push ledger + Stop hook)' };
    },
    check() {
      return [];
    },
  },
};
