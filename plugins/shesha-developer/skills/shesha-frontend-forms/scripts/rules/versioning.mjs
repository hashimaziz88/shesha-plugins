/**
 * Version invariants.
 *
 * The rule survives from the old stack; its DATA SOURCE does not. Versions used to come
 * from a hand-maintained 27KB _index.json with an accompanying rule admitting that
 * "versions DRIFT across point releases". They now come from each component's own
 * migrator chain, derived per app at probe time. That is why R-049 is dispositioned
 * `derivable` and deleted, while R-003 remains as a check.
 */
import { allComponents } from '../lib/walk.mjs';

export const rules = {
  'R-003': {
    id: 'R-003',
    severity: 'fail',
    statement:
      'Every component carries the current integer version for its type, as derived from that ' +
      'type\'s own migrator chain. Omitting version replays every migration from -1 (datatable is ' +
      '29 deep); a stale version silently drops the whole desktop style block.',
    applies(ctx) {
      return ctx.registry
        ? true
        : { skip: true, reason: 'needs the ground-truth registry (run probe first)' };
    },
    check(markup, ctx) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        const def = ctx.registry[node.type];

        // An unregistered type fails SOFT in the framework: upgradeComponents skips it and
        // the renderer shows a placeholder. A typo therefore produces a silently broken
        // form rather than an error, so it has to be caught here.
        if (!def) {
          out.push({
            message: `unknown component type "${node.type}" — it is not in the registry derived from this app's framework, and unregistered types fail soft (the renderer shows a placeholder, no error)`,
            fixPointer: `${path}/type`,
          });
          continue;
        }

        const expected = def.lastVersion;
        const actual = node.version;

        if (expected === null) {
          // The type has no migrator at all. Authoring a version is harmless but noise.
          if (actual !== undefined && actual !== null) {
            out.push({
              severity: 'warn',
              message: `${node.type} carries version ${actual} but this type has no migrator chain — the version is meaningless here`,
              fixPointer: `${path}/version`,
            });
          }
          continue;
        }

        if (actual === undefined || actual === null) {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" has no version — upgradeComponent uses (version ?? -1) and replays all ${expected + 1} migrations, which renders inputs as read-only spans or throws`,
            fixPointer: `${path}/version`,
          });
          continue;
        }
        if (actual === 'latest') continue; // IHasVersion permits the literal 'latest'
        if (!Number.isInteger(actual)) {
          out.push({
            message: `${node.type} version must be an integer or 'latest', got ${JSON.stringify(actual)}`,
            fixPointer: `${path}/version`,
          });
          continue;
        }
        if (actual < expected) {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" is at version ${actual} but this app's framework is at ${expected} — a stale version silently drops the entire desktop style block`,
            fixPointer: `${path}/version`,
          });
        } else if (actual > expected) {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" claims version ${actual}, ahead of this app's framework maximum of ${expected} — the form was authored against a newer Shesha`,
            fixPointer: `${path}/version`,
          });
        }
      }
      return out;
    },
  },
};
