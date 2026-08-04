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
import { useFormDesignerComponents, useFormBuilderFactory } from '@shesha-io/reactjs';

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
function collectPropertyNames(node, acc, depth = 0) {
  if (!node || depth > 30) return acc;
  if (Array.isArray(node)) {
    for (const n of node) collectPropertyNames(n, acc, depth + 1);
    return acc;
  }
  if (typeof node !== 'object') return acc;

  if (typeof node.propertyName === 'string' && node.propertyName) {
    acc.add(node.propertyName);
  }
  for (const key of ['components', 'items', 'tabs', 'columns', 'panels', 'steps']) {
    if (node[key]) collectPropertyNames(node[key], acc, depth + 1);
  }
  for (const key of ['content', 'header', 'footer']) {
    if (node[key] && typeof node[key] === 'object') collectPropertyNames(node[key], acc, depth + 1);
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
    // Markup may be { formSettings, components } or a bare component array.
    collectPropertyNames(markup && markup.components ? markup.components : markup, acc);
    return {
      source: typeof m === 'function' ? 'factory' : 'literal',
      propertyNames: Array.from(acc).sort(),
      error: null,
    };
  } catch (e) {
    return { source: typeof m === 'function' ? 'factory' : 'literal', propertyNames: [], error: String((e && e.message) || e) };
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
 * Runs the probe twice — devMode off then on — because getToolboxComponents(isDevMode, ...)
 * gates which components the toolbox exposes. The delta is recorded as devOnly.
 */
async function runOnce(grid, devMode) {
  window.localStorage.setItem('application.isDevMode', JSON.stringify(!!devMode));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const result = await new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: 'probe timed out after 60s without rendering' }),
      60000
    );
    root.render(
      React.createElement(Probe, {
        grid,
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

// The page driver calls this. Exposed on the esbuild global.
export function start(grid) {
  probe(grid)
    .then((r) => {
      window.__shesha_ground_truth = r;
    })
    .catch((e) => {
      window.__shesha_ground_truth = { ok: false, error: String((e && e.stack) || e) };
    });
}
