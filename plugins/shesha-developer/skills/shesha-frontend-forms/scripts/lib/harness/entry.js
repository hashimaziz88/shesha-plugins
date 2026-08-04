/**
 * The in-page ground-truth probe.
 *
 * WHY THIS EXISTS IN A BROWSER AND NOT IN NODE
 * -------------------------------------------
 * `getComponentDefinitions()` is documented in the 0.45 typings but is NOT a runtime
 * export of @shesha-io/reactjs — the rollup bundle exports 533 names and that is not
 * one of them. Neither is `Migrator`, `migrateFormSettings`, or `getNanoId`. The only
 * public route to the toolbox registry is the exported hook `useFormDesignerComponents()`.
 *
 * That hook is usable with NO provider tree at all:
 *   - useSheshaApplication(false)      -> returns undefined instead of throwing
 *   - useFormPersisterIfAvailable()    -> optional by name
 *   - app?.formDesignerComponentGroups -> optional-chained
 * ...but it also calls useIsDevMode(), which reads localStorage. Hence a browser.
 *
 * Everything below is DERIVED from the framework. Nothing here encodes a fact about
 * a component that a human typed. If you find yourself adding a lookup table to this
 * file, that is the signal the derivation failed and should be reported as a gap.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  useFormDesignerComponents,
  useFormBuilderFactory,
  componentsTreeToFlatStructure,
  componentsFlatStructureToTree,
  upgradeComponents,
} from '@shesha-io/reactjs';

/** Bounded, JSON-safe stringify. Registry values contain React elements and cycles. */
const MAX_DEPTH = 6;
function safe(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function') return { __fn: value.name || '(anonymous)', __arity: value.length };
  if (t === 'symbol' || t === 'bigint') return String(value);
  if (depth >= MAX_DEPTH) return '__depth-limit__';
  if (seen.has(value)) return '__cycle__';
  seen.add(value);
  // React elements serialise to noise; record only that one was there.
  if (value.$$typeof) return { __reactElement: true };
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => safe(v, depth + 1, seen));
  const out = {};
  for (const k of Object.keys(value)) {
    try {
      out[k] = safe(value[k], depth + 1, seen);
    } catch (e) {
      out[k] = `__threw: ${e && e.message}`;
    }
  }
  return out;
}

/**
 * Derive a component's latest migration version WITHOUT the unexported `Migrator` class.
 *
 * `def.migrator` has shape (m: Migrator) => MigratorFluent, and the fluent object only
 * needs `.add(version, upgradeFn)` returning itself. So we hand it a recorder and read
 * back the version numbers it asked for. `lastVersion` is then max(recorded), which is
 * exactly what MigratorFluent.lastVersion computes internally.
 *
 * This is the difference between deriving the version map and hand-maintaining one.
 */
function deriveVersions(def) {
  if (typeof def.migrator !== 'function') {
    return { lastVersion: null, versions: [], migratorPresent: false, error: null };
  }
  const versions = [];
  const recorder = {
    add(version, _upgrade) {
      versions.push(version);
      return recorder;
    },
    // MigratorFluent surface some component migrators reach for. Keep them chainable
    // so a migrator that uses them records its versions instead of throwing.
    get lastVersion() {
      return versions.length ? Math.max(...versions) : undefined;
    },
    upgrade(model) {
      return model;
    },
  };
  try {
    def.migrator(recorder);
  } catch (e) {
    return {
      lastVersion: versions.length ? Math.max(...versions) : null,
      versions,
      migratorPresent: true,
      error: String((e && e.message) || e),
    };
  }
  return {
    lastVersion: versions.length ? Math.max(...versions) : null,
    versions,
    migratorPresent: true,
    error: null,
  };
}

/**
 * Walk a settings-form markup tree collecting every propertyName. This is the authoritative
 * per-component prop surface — what Phase 3's mirror kit is allowed to generate props for.
 *
 * The walker must cover every container shape because 0.45 has no uniform `children`:
 * components[], content.components[], header.components[], columns[i].components[],
 * tabs[i].components[], panels[i].components[], and buttonGroup items[].
 */
/**
 * The editor component a settings form uses for a prop tells you the prop's TYPE, and for the
 * choice editors it also carries the legal VALUES. Both are harvested here rather than
 * hand-listed, because an enum table someone typed out goes stale on the next release and a
 * compiler validating against a stale table is worse than one validating nothing.
 *
 * Deliberately conservative: the editor name is recorded verbatim so an unmapped editor shows up
 * as `unknown` rather than being guessed into a type.
 */
const EDITOR_TYPES = {
  checkbox: 'boolean',
  switch: 'boolean',
  numberField: 'number',
  textField: 'string',
  textArea: 'string',
  codeEditor: 'string',
  colorPicker: 'color',
  iconPicker: 'icon',
  dropdown: 'enum',
  radio: 'enum',
  customDropdown: 'enum',
  multiColorPicker: 'color',
};

/**
 * Static choices, if the editor carries any. A reference-list dropdown carries none.
 *
 * `dropdownOptions` and `buttonGroupOptions` are the real 0.45 field names
 * (designer-components/settingsInput/interfaces.ts: IDropdownOption[] / IRadioOption[]).
 */
function choicesOf(node) {
  for (const key of ['dropdownOptions', 'buttonGroupOptions', 'values', 'options', 'items']) {
    const arr = node[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const vals = arr
      .map((o) => (o && typeof o === 'object' ? o.value : o))
      .filter((v) => v !== undefined && v !== null && typeof v !== 'object');
    if (vals.length) return vals.map((v) => String(v));
  }
  return null;
}

function collectPropertyNames(node, acc, types, depth = 0) {
  if (!node || depth > 30) return acc;
  if (Array.isArray(node)) {
    for (const n of node) collectPropertyNames(n, acc, types, depth + 1);
    return acc;
  }
  if (typeof node !== 'object') return acc;

  if (typeof node.propertyName === 'string' && node.propertyName) {
    acc.add(node.propertyName);
    // 0.45 wraps nearly every settings field in a generic `settingsInput` whose REAL editor is
    // in `inputType` (settingsInput.tsx: `isSettingsInputProps(props) ? props.inputType :
    // props.type`). Reading `type` alone returned "settingsInput" 490 times and no enum values.
    if (types && (typeof node.inputType === 'string' || typeof node.type === 'string')) {
      const editor = typeof node.inputType === 'string' ? node.inputType : node.type;
      const mapped = EDITOR_TYPES[editor] || 'unknown';
      const values = mapped === 'enum' ? choicesOf(node) : null;
      // First writer wins: a prop shown twice (e.g. once per settings tab) is the same prop, and
      // the richer record is kept only if the first had no values to offer.
      const prev = types[node.propertyName];
      if (!prev || (values && !prev.values)) {
        types[node.propertyName] = {
          editor,
          type: mapped,
          values,
          // A dropdown bound to a reference list has legal values the markup cannot show us.
          dynamic: mapped === 'enum' && !values ? true : false,
          source: 'settings-markup:' + editor,
        };
      }
    }
  }
  // `inputs` is settingsInputRow's child array — the container most 0.45 settings fields
  // actually live in. Omitting it silently hid the majority of the prop surface, including
  // every appearance channel on `text`.
  for (const key of ['components', 'items', 'tabs', 'columns', 'panels', 'steps', 'inputs']) {
    if (node[key]) collectPropertyNames(node[key], acc, types, depth + 1);
  }
  for (const key of ['content', 'header', 'footer']) {
    if (node[key] && typeof node[key] === 'object') collectPropertyNames(node[key], acc, types, depth + 1);
  }
  return acc;
}

function deriveSettingsProps(def, fbf) {
  const m = def.settingsFormMarkup;
  if (m === undefined || m === null) {
    return { source: 'absent', propertyNames: [], error: null };
  }
  try {
    const markup = typeof m === 'function' ? m({ fbf }) : m;
    const acc = new Set();
    const types = {};
    // Markup may be { formSettings, components } or a bare component array.
    collectPropertyNames(markup && markup.components ? markup.components : markup, acc, types);
    return {
      source: typeof m === 'function' ? 'factory' : 'literal',
      propertyNames: Array.from(acc).sort(),
      propTypes: types,
      error: null,
    };
  } catch (e) {
    return {
      source: typeof m === 'function' ? 'factory' : 'literal',
      propertyNames: [],
      propTypes: {},
      error: String((e && e.message) || e),
    };
  }
}

/**
 * Sample the framework's own component/property matcher rather than inventing a mapping
 * table. The grid is supplied by the caller from LIVE metadata where available, so we
 * only ever ask about {dataType, dataFormat} pairs that actually occur in this app.
 */
function deriveDataTypeSupport(def, grid) {
  if (typeof def.dataTypeSupported !== 'function') return null;
  const supported = [];
  for (const pair of grid) {
    try {
      if (def.dataTypeSupported({ dataType: pair.dataType, dataFormat: pair.dataFormat })) {
        supported.push(pair.dataFormat ? `${pair.dataType}:${pair.dataFormat}` : pair.dataType);
      }
    } catch {
      /* a matcher that throws on a pair simply does not support it */
    }
  }
  return supported;
}

function deriveContainers(def) {
  const custom = Array.isArray(def.customContainerNames) ? def.customContainerNames.slice() : null;
  let fromGetter = null;
  let getterError = null;
  if (typeof def.getContainers === 'function') {
    try {
      const probeModel = { id: '__probe__', type: def.type, parentId: 'root' };
      const r = def.getContainers(probeModel);
      fromGetter = Array.isArray(r) ? safe(r) : safe(r);
    } catch (e) {
      getterError = String((e && e.message) || e);
    }
  }
  return {
    customContainerNames: custom,
    getContainersPresent: typeof def.getContainers === 'function',
    getContainersResult: fromGetter,
    getContainersError: getterError,
  };
}

function snapshotRegistry(components, fbf, grid) {
  const out = {};
  for (const type of Object.keys(components)) {
    const def = components[type];
    if (!def) continue;
    const versionInfo = deriveVersions(def);
    out[type] = {
      type: def.type,
      name: typeof def.name === 'string' ? def.name : null,
      isInput: def.isInput === undefined ? null : !!def.isInput,
      isOutput: def.isOutput === undefined ? null : !!def.isOutput,
      isHidden: def.isHidden === undefined ? null : !!def.isHidden,
      isTemplate: def.isTemplate === undefined ? null : !!def.isTemplate,
      canBeJsSetting: def.canBeJsSetting === undefined ? null : !!def.canBeJsSetting,
      preserveDimensionsInDesigner:
        def.preserveDimensionsInDesigner === undefined ? null : !!def.preserveDimensionsInDesigner,
      tooltip: typeof def.tooltip === 'string' ? def.tooltip : null,
      lastVersion: versionInfo.lastVersion,
      migrationVersions: versionInfo.versions,
      migratorPresent: versionInfo.migratorPresent,
      migratorError: versionInfo.error,
      ...deriveContainers(def),
      settings: deriveSettingsProps(def, fbf),
      dataTypeSupported: deriveDataTypeSupport(def, grid),
      hasFactory: typeof def.Factory === 'function',
      hasValidateModel: typeof def.validateModel === 'function',
      hasValidateSettings: typeof def.validateSettings === 'function',
      hasLinkToModelMetadata: typeof def.linkToModelMetadata === 'function',
      hasGetFieldsToFetch: typeof def.getFieldsToFetch === 'function',
      hasCalculateModel:
        typeof def.calculateModel === 'function' || typeof def.useCalculateModel === 'function',
    };
  }
  return out;
}

/** Rendered once per dev-mode setting. Publishes its result and unmounts. */
function Probe({ grid, onDone }) {
  const components = useFormDesignerComponents();
  const fbf = useFormBuilderFactory();
  React.useEffect(() => {
    let payload;
    try {
      payload = { ok: true, registry: snapshotRegistry(components, fbf, grid) };
    } catch (e) {
      payload = { ok: false, error: String((e && e.stack) || e) };
    }
    onDone(payload);
  }, [components, fbf, grid, onDone]);
  return null;
}

/**
 * The round-trip gate, run with the FRAMEWORK'S OWN functions:
 *   componentsTreeToFlatStructure -> upgradeComponents -> componentsFlatStructureToTree
 *
 * This is the strongest structural check available, because it is not our opinion of what
 * valid markup is — it is what Shesha itself does to the markup before rendering. If the
 * tree does not survive its own framework's normalisation, the form is broken in a way no
 * hand-written schema would catch. (There is no JSON Schema for form markup anywhere in
 * the framework repo; the TypeScript types are the schema.)
 *
 * Every one of these functions takes an IToolboxComponents dictionary as its first
 * argument, which is exactly what is unreachable outside a React render — hence a browser.
 */
function RoundTrip({ markup, onDone }) {
  const components = useFormDesignerComponents();
  React.useEffect(() => {
    try {
      const formSettings = markup.formSettings || {};
      const input = markup.components || [];

      const flat = componentsTreeToFlatStructure(components, JSON.parse(JSON.stringify(input)));

      // upgradeComponents mutates the flat structure in place and returns void.
      let upgradeError = null;
      try {
        upgradeComponents(components, formSettings, flat, false);
      } catch (e) {
        upgradeError = String((e && e.message) || e);
      }

      const tree = componentsFlatStructureToTree(components, flat);

      onDone({
        ok: true,
        upgradeError,
        // Ids the flat structure knows about — a count mismatch means components were
        // dropped or collided (the flat structure is keyed by id).
        flatIds: Object.keys(flat.allComponents || {}),
        componentRelations: flat.componentRelations ? Object.keys(flat.componentRelations).length : null,
        tree,
      });
    } catch (e) {
      onDone({ ok: false, error: String((e && e.stack) || e) });
    }
  }, [components, markup, onDone]);
  return null;
}

/** Mount a component that resolves once, then tear it down. */
async function renderOnce(Component, props, label) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const result = await new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: `${label} timed out after 60s without rendering` }),
      60000
    );
    root.render(
      React.createElement(Component, {
        ...props,
        onDone: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
      })
    );
  });
  root.unmount();
  host.remove();
  return result;
}

/**
 * Runs the probe twice — devMode off then on — because getToolboxComponents(isDevMode, ...)
 * gates which components the toolbox exposes. The delta is recorded as devOnly.
 */
async function runOnce(grid, devMode) {
  window.localStorage.setItem('application.isDevMode', JSON.stringify(!!devMode));
  return renderOnce(Probe, { grid }, 'probe');
}

export async function probe(grid) {
  const prod = await runOnce(grid || [], false);
  if (!prod.ok) return prod;
  const dev = await runOnce(grid || [], true);
  if (!dev.ok) return dev;

  const prodTypes = new Set(Object.keys(prod.registry));
  const devOnly = Object.keys(dev.registry).filter((t) => !prodTypes.has(t));

  // Dev mode is a superset, so it is the fuller record. Flag the delta rather than
  // dropping it — a component that only exists in dev mode is a real constraint on
  // what a compiler may emit for a production form.
  const registry = dev.registry;
  for (const t of devOnly) registry[t].devOnly = true;
  for (const t of prodTypes) if (registry[t]) registry[t].devOnly = false;

  return {
    ok: true,
    registry,
    counts: {
      prod: prodTypes.size,
      dev: Object.keys(dev.registry).length,
      devOnly: devOnly.length,
    },
    devOnlyTypes: devOnly.sort(),
    react: React.version,
  };
}

export async function roundTrip(markup) {
  // Dev mode is irrelevant here (the dictionary is dev-mode-independent), but the hook
  // reads localStorage, so seed it to avoid a first-render surprise.
  window.localStorage.setItem('application.isDevMode', 'false');
  return renderOnce(RoundTrip, { markup }, 'round-trip');
}

/**
 * The page driver calls this with an operation. One bundle serves every browser-side
 * operation so the esbuild cache stays hot — bundling the whole Shesha package is ~4.3s
 * cold and ~0.1s warm, and a second entry point would halve the hit rate for no gain.
 */
export function start(op) {
  const operation = op && op.kind ? op : { kind: 'probe', grid: op || [] };
  const run =
    operation.kind === 'roundtrip'
      ? roundTrip(operation.markup)
      : probe(operation.grid || []);
  run
    .then((r) => {
      window.__shesha_ground_truth = r;
    })
    .catch((e) => {
      window.__shesha_ground_truth = { ok: false, error: String((e && e.stack) || e) };
    });
}
