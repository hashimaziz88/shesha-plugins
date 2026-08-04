/**
 * Binding invariants. These are the dominant cause of the "case-specific correctness"
 * failures the rebuild exists to fix: the form renders, looks right, and shows nothing.
 */
import { allComponents, ownStrings, tableColumns } from '../lib/walk.mjs';

/** Properties whose values are code or JSON and must not be scanned for mustache. */
const NON_TEMPLATE_KEYS =
  /(_code|onInitialized|onDataLoaded|onUpdate|onBeforeDataLoad|onAfterDataLoad|onValuesUpdate|onPrepareSubmitData|onBeforeSubmit|onSubmitSuccess|onSubmitFailed|actionScript|expression|customStyle|style|styleJson|stylingBox|styleName)/i;

function camelish(s) {
  return typeof s === 'string' && s.length > 0 && s[0] === s[0].toLowerCase();
}

/** Flatten metadata into a path set for a container, lowercased for tolerant lookup. */
function propertyIndex(properties) {
  const set = new Map();
  for (const p of properties || []) {
    if (typeof p.path === 'string') set.set(p.path.toLowerCase(), p);
  }
  return set;
}

export const rules = {
  'R-004': {
    id: 'R-004',
    severity: 'fail',
    statement:
      'Every propertyName is camelCase, INCLUDING datatable column propertyNames. Metadata ' +
      'returns PascalCase paths but GQL row keys are camelCase, so a PascalCase column fetches ' +
      'rows and a correct pager count, then renders every cell blank.',
    check(markup, ctx) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        // Only a DATA BINDING has to be camelCase. A dataContext's propertyName is a
        // context identifier (referenced as contexts.<name>) and a datatable's is a table
        // name — neither is a property path, and the shipped PBF form names a context
        // "Application_Table" deliberately.
        //
        // `isInput` does NOT discriminate: it is true for datatableContext and datatable
        // as well as textField, because in Shesha it means "participates in form data
        // flow". The framework's own discriminator for "binds an entity property" is
        // dataTypeSupported — the matcher it uses for exactly that decision. Components
        // that bind without declaring one (subForm, entityPicker) are therefore not
        // covered here; that is a deliberate narrowing, because a fail-severity rule must
        // not produce false positives.
        const def = ctx.registry ? ctx.registry[node.type] : null;
        const isBinding = def ? def.dataTypeSupported !== null : !/[Cc]ontext$/.test(node.type);
        if (isBinding && typeof node.propertyName === 'string' && node.propertyName && !camelish(node.propertyName)) {
          out.push({
            message: `${node.type} propertyName "${node.propertyName}" is not camelCase — bindings resolve against camelCase keys`,
            fixPointer: `${path}/propertyName`,
          });
        }
        // Column propertyNames are the classic miss: the count is right, the cells are blank.
        for (let i = 0; i < tableColumns(node).length; i += 1) {
          const col = tableColumns(node)[i];
          if (col && col.columnType === 'data' && typeof col.propertyName === 'string' && col.propertyName) {
            // Dotted paths must be camelCase segment-wise.
            const bad = col.propertyName.split('.').filter((seg) => seg && !camelish(seg));
            if (bad.length) {
              out.push({
                message: `datatable column "${col.caption || col.propertyName}" propertyName "${col.propertyName}" has non-camelCase segment(s) ${bad.join(', ')} — rows will load with a correct count and blank cells`,
                fixPointer: `${path}/items/${i}/propertyName`,
              });
            }
          }
        }
      }
      return out;
    },
  },

  'R-014': {
    id: 'R-014',
    severity: 'fail',
    statement:
      'Mustache expressions use {{double braces}}. A single-brace {expr} is silently ignored, ' +
      'producing an empty value with no error anywhere.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        for (const { path: p, value } of ownStrings(node)) {
          if (NON_TEMPLATE_KEYS.test(p)) continue;
          if (typeof value !== 'string' || value.length > 2000) continue;
          // Strip valid double/triple braces, then look for a surviving single brace.
          const stripped = value.replace(/\{\{\{[^}]*\}\}\}/g, '').replace(/\{\{[^}]*\}\}/g, '');
          const m = stripped.match(/\{\s*[A-Za-z_$][\w.$?[\]]*\s*\}/);
          if (m) {
            out.push({
              message: `${node.type} "${node.componentName || node.id}" ${p} contains single-brace "${m[0]}" — single braces are silently ignored; use {{ }}`,
              fixPointer: `${path}/${p}`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-015': {
    id: 'R-015',
    severity: 'fail',
    statement:
      'A reference list identity is copied VERBATIM from the bound property metadata ' +
      '(referenceListName / referenceListModule). Deriving it from the property name is the ' +
      'canonical silent killer — the dropdown renders empty with no error.',
    applies(ctx) {
      return ctx.metadata && ctx.modelProperties
        ? true
        : { skip: true, reason: 'needs live metadata for the form modelType (run probe with a reachable backend)' };
    },
    check(markup, ctx) {
      const out = [];
      const idx = propertyIndex(ctx.modelProperties);
      for (const { node, path } of allComponents(markup)) {
        const refId = node.referenceListId;
        if (!refId || typeof refId !== 'object') continue;
        if (!node.propertyName) continue;
        const meta = idx.get(String(node.propertyName).toLowerCase());
        if (!meta) continue; // R-034 reports the unknown property itself
        if (!meta.referenceListName) {
          out.push({
            message: `${node.type} "${node.propertyName}" carries a referenceListId but the property is not a reference-list property (dataType "${meta.dataType}")`,
            fixPointer: `${path}/referenceListId`,
          });
          continue;
        }
        if (refId.name !== meta.referenceListName) {
          out.push({
            message: `${node.type} "${node.propertyName}" binds reference list "${refId.name}" but metadata says "${meta.referenceListName}" — copy it verbatim; a derived name renders an empty dropdown`,
            fixPointer: `${path}/referenceListId/name`,
          });
        }
        if (meta.referenceListModule && refId.module !== meta.referenceListModule) {
          out.push({
            message: `${node.type} "${node.propertyName}" reference list module is "${refId.module}" but metadata says "${meta.referenceListModule}"`,
            fixPointer: `${path}/referenceListId/module`,
          });
        }
      }
      return out;
    },
  },

  'R-016': {
    id: 'R-016',
    severity: 'fail',
    statement:
      'formSettings.modelType is the {name, module} object resolved from live EntityConfig, ' +
      'while dataContext.entityType stays the fullClassName STRING. Conflating the two 500s at ' +
      'runtime.',
    check(markup) {
      const out = [];
      const mt = markup?.formSettings?.modelType;
      if (mt !== undefined && mt !== null) {
        if (typeof mt === 'string') {
          // The live PBF form ships a string here, so this is a real-world shape. It is
          // reported as a warning rather than a failure precisely because shipped forms
          // do it and still render.
          out.push({
            severity: 'warn',
            message: `formSettings.modelType is the string "${mt}" — 0.45 expects the {name, module} object resolved from EntityConfig`,
            fixPointer: 'formSettings/modelType',
          });
        } else if (typeof mt === 'object' && !(mt.name && mt.module)) {
          out.push({
            message: `formSettings.modelType is an object missing ${!mt.name ? 'name' : 'module'}`,
            fixPointer: 'formSettings/modelType',
          });
        }
      }
      for (const { node, path } of allComponents(markup)) {
        if (node.type !== 'datatableContext') continue;
        if (node.entityType !== undefined && node.entityType !== null && typeof node.entityType !== 'string') {
          out.push({
            message: `datatableContext "${node.componentName || node.id}" entityType must be the fullClassName string, got ${typeof node.entityType}`,
            fixPointer: `${path}/entityType`,
          });
        }
      }
      return out;
    },
  },

  'R-034': {
    id: 'R-034',
    severity: 'fail',
    statement:
      'A bound value renders only when propertyName is a real entity property — it is what ' +
      'drives the gql fetch. Mutating data in onAfterDataLoad or calling setFieldsValue never ' +
      'populates a read-only field display.',
    applies(ctx) {
      return ctx.modelProperties
        ? true
        : { skip: true, reason: 'needs live metadata for the form modelType (run probe with a reachable backend)' };
    },
    check(markup, ctx) {
      const out = [];
      const idx = propertyIndex(ctx.modelProperties);
      const known = (name) => {
        const lower = String(name).toLowerCase();
        if (idx.has(lower)) return true;
        // Dotted paths: accept when the first segment resolves; deeper segments need the
        // related entity's own metadata, which we do not have here.
        const first = lower.split('.')[0];
        return idx.has(first);
      };
      for (const { node, path } of allComponents(markup)) {
        // Same discriminator as R-004: dataTypeSupported, not isInput, because isInput is
        // true for datatableContext and datatable whose propertyName is an identifier
        // rather than an entity property path.
        const def = ctx.registry && ctx.registry[node.type];
        if (def && def.dataTypeSupported === null) continue;
        const name = node.propertyName;
        if (typeof name !== 'string' || !name) continue;
        if (!known(name)) {
          out.push({
            message: `${node.type} binds propertyName "${name}", which is not a property of ${ctx.modelTypeName || 'the form model'} — the value will never render`,
            fixPointer: `${path}/propertyName`,
          });
        }
      }
      return out;
    },
  },
};
