import * as fs from 'fs';
import * as path from 'path';
import { getComponentDefinitions } from '@/providers/form/defaults/toolboxComponents';
import { makeFormBuliderFactory } from '@/form-factory/implementation';
import { Migrator } from '@/utils/fluentMigrator/migrator';
import { getSettings as getFormSettingsMarkup } from '@/components/formDesigner/formSettings';

/**
 * Maps a settings-form control's OWN type — its `type` field, or for a
 * `settingsInput` node its `inputType` (verified against
 * `src/form-factory/implementation.ts`'s `_addProperty(props, type, meta)`:
 * every `addXxx()` builder stamps a fixed `type` on the node it produces,
 * and `addSettingsInput` stamps `type: 'settingsInput'` while the CALLER
 * supplies the real widget as `inputType`, e.g. `inputType: 'switch'`,
 * `inputType: 'dropdown'` — grep -rho "inputType: '[a-zA-Z0-9_]+'" across
 * src/designer-components confirms switch/checkbox/numberField/textField/
 * textArea/codeEditor/colorPicker/dropdown/radio/permissions etc. are the
 * real vocabulary) — to a coarse runtime-value category. This is the type
 * information a hand-maintained index used to carry and the registry cutover
 * dropped; it now comes straight from the same settings-form leaf that
 * already yields `propertyName`, so no separate index is reintroduced.
 *
 * Used only for the runtime-type-mismatch check (clean-form-config's
 * restored Step 4c) — catching e.g. a boolean-typed prop carrying the
 * string `"true"`, or a numeric-typed prop carrying the string `"42"`.
 */
const BOOLEAN_CONTROL_TYPES = new Set(['switch', 'checkbox']);
const NUMBER_CONTROL_TYPES = new Set(['numberField', 'slider']);
const STRING_CONTROL_TYPES = new Set(['textField', 'textArea', 'codeEditor', 'colorPicker', 'Password', 'link', 'text']);
const ENUM_CONTROL_TYPES = new Set(['dropdown', 'customDropdown', 'radio', 'editModeSelector']);
const ARRAY_CONTROL_TYPES = new Set(['permissions', 'multiColorPicker', 'editableTagGroup', 'labelValueEditor', 'filtersList', 'columnsList']);

// Settings-form structural/container control types that can carry a
// `propertyName` purely as their OWN panel/tab/row identifier in the
// settings-form UI tree, NOT as a real settable leaf of the component being
// configured — e.g. a `collapsiblePanel` titled "Custom Styles" keyed
// `customStyle`, an inline `settingsInputRow` keyed `font` that groups
// `font.size`/`font.weight`/`font.color` underneath it (see checkbox's
// settingsForm.ts). Recording a scalar type for these would assert a
// runtime-shape check against a key that isn't actually a scalar model
// value, so they are deliberately left unclassified (no propTypes entry) —
// exactly mirroring how classify.mjs's `isScaffoldingProp` already treats
// most of these same keys as non-props further downstream.
const CONTROL_STRUCTURAL_TYPES = new Set([
  'settingsInputRow', 'tabs', 'searchableTabs', 'collapsiblePanel', 'container',
  'columns', 'column', 'propertyRouter', 'KeyInformationBar',
]);

/**
 * Classify one settings-form leaf node into a coarse runtime-value category.
 * Returns undefined when the control is structural (see
 * CONTROL_STRUCTURAL_TYPES) or otherwise unclassifiable — callers must treat
 * "no entry" as "unknown", never as "any scalar goes".
 */
function classifyControlType(node: any): { type: string; values?: Array<string | number> } | undefined {
  const rawType = node.type === 'settingsInput' ? node.inputType : node.type;
  if (!rawType || typeof rawType !== 'string') return undefined;
  if (CONTROL_STRUCTURAL_TYPES.has(rawType)) return undefined;

  if (BOOLEAN_CONTROL_TYPES.has(rawType)) return { type: 'boolean' };
  if (NUMBER_CONTROL_TYPES.has(rawType)) return { type: 'number' };
  if (STRING_CONTROL_TYPES.has(rawType)) return { type: 'string' };

  if (ENUM_CONTROL_TYPES.has(rawType)) {
    // Enumerated controls carry their allowed values as `dropdownOptions`
    // (dropdown/customDropdown) or `buttonGroupOptions` (radio), each an
    // array of `{ value, label }` — confirmed against
    // src/designer-components/_settings/utils/font/utils.tsx's
    // `fontWeightsOptions` and multiple settingsForm.ts call sites. Some
    // options are computed via an `IPropertySetting` `{_code,_value}`
    // wrapper (see formSettings.ts's `dataLoaderType`) rather than a plain
    // array — in that case there is no static value list to record, so the
    // entry is emitted without `values`, never invented.
    const optionSource = node.dropdownOptions ?? node.buttonGroupOptions;
    const values = Array.isArray(optionSource)
      ? optionSource.map((o: any) => o?.value).filter((v: any) => v !== undefined)
      : undefined;
    return values && values.length > 0 ? { type: 'enum', values } : { type: 'enum' };
  }

  if (ARRAY_CONTROL_TYPES.has(rawType)) return { type: 'array' };

  // A known, non-structural control we don't further classify (autocompletes,
  // queryBuilder, styleBox, iconPicker, fileUpload, …) — genuinely
  // object/compound-shaped, not a boolean/number/string/enum/array leaf.
  return { type: 'object' };
}

/**
 * Recursively collect every `propertyName` in a settings-form markup tree,
 * plus (additively) a parallel `propTypes` map of `propertyName -> classifyControlType(node)`
 * for every leaf classifyControlType can resolve. `propTypes` is strictly a
 * bonus map alongside the existing `out` string set — every existing
 * consumer of the flat prop-name set is unaffected.
 */
function collectPropertyNames(node: any, out: Set<string>, propTypes?: Map<string, { type: string; values?: Array<string | number> }>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectPropertyNames(n, out, propTypes);
    return;
  }
  if (typeof node.propertyName === 'string' && node.propertyName.length > 0) {
    out.add(node.propertyName);
    if (propTypes && !propTypes.has(node.propertyName)) {
      const classified = classifyControlType(node);
      if (classified) propTypes.set(node.propertyName, classified);
    }
  }
  // Settings forms nest leaves through a variety of structural keys depending
  // on the component (`components`, `columns`, `tabs`, `content`, `header`,
  // `items`, and critically `inputs` for settingsInputRow/settingsInput — the
  // home of the dimensions/border/background/shadow surface). Rather than
  // enumerate keys (which silently under-extracts the moment a settings form
  // is refactored to nest one level deeper), walk every array- or
  // object-valued child generically. `node.propertyName` above is the only
  // thing we harvest, so descending into value payloads (e.g. dropdown
  // `options`, `validate` blocks) is safe — it never invents props unless a
  // node genuinely carries a non-empty string `propertyName`.
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') collectPropertyNames(value, out, propTypes);
  }
}

// Mirrors tier1.mjs's own STRUCTURAL_KEYS/BREAKPOINT_KEYS exactly (duplicated
// here rather than imported: this harness is copied standalone into the
// framework checkout at generation time and has no access to the plugin's
// own scripts/lib/*.mjs). These are child-COMPONENT slots, not props of the
// component itself — a runtime model produced by initModel/migrator replay
// can legitimately carry a `components`/`items` array (e.g. a fresh
// container's `components: []`, a fresh datatable's `items: []`), and that
// must never be harvested as if it were a settable leaf prop.
const STRUCTURAL_KEYS = new Set(['components', 'columns', 'tabs', 'content', 'header', 'customHeader', 'items']);
const BREAKPOINT_KEYS = new Set(['desktop', 'tablet', 'mobile']);

/**
 * Recursively collect dotted paths for every own key of a plain-object model
 * value (both intermediate group keys, e.g. `tableSettings`, AND their leaves,
 * e.g. `tableSettings.rowHeight` — tier1.mjs's own `isKnownProp` matches on
 * ANY ancestor prefix, so recording both is harmless and strictly more
 * useful). Arrays are recorded as a leaf at their own key but never descended
 * into: array entries here are always per-item collections (datatable
 * columns, buttonGroup items, tabs) whose shape belongs to a different part
 * of the model, not the flat settable-prop surface this harvests.
 *
 * Two exclusions, both mirroring tier1.mjs's own `collectOwnPropPaths`
 * exactly (see its header comment) so the registry's path VOCABULARY matches
 * how the validator actually reconciles a real node's own keys against it:
 * `STRUCTURAL_KEYS` are child-component slots, never props, at any depth;
 * `desktop`/`tablet`/`mobile` wrappers are transparent AT THE TOP LEVEL ONLY
 * — real markup nests the same style keys one level deeper under a
 * breakpoint, and tier1 flattens that away before matching, so recording
 * `desktop.border.hideBorder` as a distinct registry path would just be
 * redundant with `border.hideBorder` (four near-identical copies of every
 * style leaf), never additionally correct.
 */
function collectValuePaths(node: any, out: Set<string>, prefix = ''): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) return;
  for (const key of Object.keys(node)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    const value = node[key];

    if (!prefix && BREAKPOINT_KEYS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      collectValuePaths(value, out, '');
      continue;
    }

    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectValuePaths(value, out, path);
    }
  }
}

/**
 * `settingsFormMarkup` only carries props a settings-FORM CONTROL has been
 * wired up for. Investigation against framework source (docs/corpus-report.md
 * Task 9/10) found a large class of real, settable props that never get a
 * literal `propertyName` leaf anywhere in the settings form at all — they are
 * only ever produced at runtime by a component's `initModel` defaulting
 * function (e.g. datatable's `tableSettings.*`, built by
 * `getTableSettingsDefaults()` and merged into `initModel`'s return value —
 * "a framework type/runtime mismatch" per the investigation) or by one of its
 * `migrator` steps (e.g. datatable's `crud`/`flexibleHeight`, "only visible
 * via the component's own migrator, not the current interface"). Rather than
 * hand-list the ~50 paths this surfaced, run BOTH extra sources generically
 * for every component and harvest whatever keys they actually produce:
 *
 * - `initModel`, called with an empty seed model, same as the designer does
 *   the instant a component is first dropped onto the canvas.
 * - every registered `migrator` step, replayed in order from an empty seed
 *   (mirrors how the framework upgrades a very old/versionless form),
 *   collecting the UNION of keys seen after each step — not just the final
 *   result — so a field a later step stops setting (deprecated but still a
 *   real, producible path) is still recovered.
 *
 * Both are best-effort: a step written assuming a pre-populated shape (e.g.
 * an existing `columns` array) can throw against our synthetic empty seed.
 * That must never abort the whole component's extraction — we simply stop
 * replaying further steps / skip initModel for that component and keep
 * whatever was harvested so far, exactly like the existing settingsFormMarkup
 * try/catch below.
 */
function collectModelSourcePaths(def: any, out: Set<string>): void {
  if (typeof def.initModel === 'function') {
    try {
      const model = def.initModel({});
      collectValuePaths(model, out);
    } catch {
      // best-effort — initModel assuming pre-existing fields on an empty
      // synthetic seed is not this extraction's problem to solve.
    }
  }

  if (typeof def.migrator === 'function') {
    try {
      const registrar = new Migrator() as any;
      def.migrator(registrar);
      const steps = [...(registrar.migrations ?? [])].sort((a: any, b: any) => a.version - b.version);
      const stubContext = {
        formSettings: undefined,
        flatStructure: { allComponents: {}, componentRelations: [] },
        componentId: 'shesha-registry-extraction-stub',
        isNew: true,
      };
      let current: any = { version: -1 };
      for (const step of steps) {
        try {
          current = step.up(current, stubContext);
          current.version = step.version;
          collectValuePaths(current, out);
        } catch {
          // A step assumed a shape our empty synthetic seed doesn't have —
          // stop replaying further steps rather than let one broken
          // assumption abort the whole component's extraction.
          break;
        }
      }
    } catch {
      // best-effort — same rationale as initModel above.
    }
  }
}

describe('component registry extraction', () => {
  it('extracts every registered component', () => {
    // `getComponentDefinitions()` takes no arguments and returns every registered
    // component, Dev group included (verified: the extraction yields `settingsInput`,
    // `searchableTabs` etc.). Do NOT confuse it with `getToolboxComponents(devMode, …)`,
    // which filters by devMode — that is the designer's UI path, not ours.
    const defs = getComponentDefinitions();
    const fbf = makeFormBuliderFactory();

    const components: Record<string, any> = {};
    let settingsOk = 0;
    let settingsFail = 0;

    for (const [type, def] of defs.entries()) {
      const props = new Set<string>();
      const propTypes = new Map<string, { type: string; values?: Array<string | number> }>();
      try {
        const markup =
          typeof def.settingsFormMarkup === 'function'
            ? (def.settingsFormMarkup as any)({ fbf })
            : def.settingsFormMarkup;
        if (markup) collectPropertyNames(markup, props, propTypes);
        settingsOk++;
      } catch (e) {
        // Record the failure rather than aborting the whole extraction — one
        // broken settings form must not cost us the other 115 components.
        settingsFail++;
        // eslint-disable-next-line no-console
        console.warn(`settingsFormMarkup failed for ${type}: ${(e as Error).message}`);
      }

      let version: number | undefined;
      try {
        version = def.migrator ? def.migrator(new Migrator() as any)?.lastVersion : undefined;
      } catch (e) {
        version = undefined;
        // eslint-disable-next-line no-console
        console.warn(`migrator failed for ${type}: ${(e as Error)?.stack ?? e}`);
      }

      // settingsFormMarkup only sees props a settings-form CONTROL exists
      // for. Also harvest whatever initModel/migrator actually produce at
      // runtime — see collectModelSourcePaths' header comment. Those extra
      // paths carry no settings-form control, so they can never be
      // classified — collectModelSourcePaths deliberately takes no
      // propTypes map.
      collectModelSourcePaths(def, props);

      components[type] = {
        name: (def as any).name ?? type,
        group: (def as any).group ?? null,
        isInput: (def as any).isInput === true,
        isOutput: (def as any).isOutput === true,
        isHidden: (def as any).isHidden === true,
        version,
        propsCount: props.size,
        props: [...props],
        propTypes: Object.fromEntries(propTypes),
        customContainerNames: (def as any).customContainerNames ?? [],
      };
    }

    // Form-level settings ("formSettings" on a form's markup — layout,
    // labelCol/wrapperCol, dataLoaderType, permissions, lifecycle scripts,
    // etc.) are edited through their own settings-form markup exactly like a
    // component's: `src/components/formDesigner/formSettings.ts` exports the
    // same `SettingsFormMarkupFactory` shape and is fed straight into
    // `ConfigurableForm` by `formSettingsEditor.tsx` (`useFormViaFactory(getSettings)`).
    // So it is extracted the same way as every component above, not invented.
    let formSettingsResult: { props: string[]; propTypes: Record<string, any> } = { props: [], propTypes: {} };
    try {
      const formSettingsMarkup = (getFormSettingsMarkup as any)({ fbf });
      const formSettingsProps = new Set<string>();
      const formSettingsPropTypes = new Map<string, { type: string; values?: Array<string | number> }>();
      if (formSettingsMarkup) collectPropertyNames(formSettingsMarkup, formSettingsProps, formSettingsPropTypes);
      formSettingsResult = {
        props: [...formSettingsProps],
        propTypes: Object.fromEntries(formSettingsPropTypes),
      };
    } catch (e) {
      // Best-effort, same rationale as a single component's settingsFormMarkup
      // failing above — never let this abort the whole extraction.
      // eslint-disable-next-line no-console
      console.warn(`formSettings extraction failed: ${(e as Error).message}`);
    }

    const out = {
      summary: { totalTypes: defs.size, settingsOk, settingsFail },
      components,
      formSettings: formSettingsResult,
    };

    const target = process.env.SHESHA_REGISTRY_OUT;
    if (!target) throw new Error('SHESHA_REGISTRY_OUT is not set');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');

    // Sanity guards. 100 is a deliberate floor, not the expected count — the
    // exact count is asserted in the plugin's acceptance test (Task 6), which
    // is the right place for it, because that is where a drop should fail CI.
    expect(defs.size).toBeGreaterThan(100);
    expect(settingsFail).toBe(0);
  });
});
