import { isScaffoldingProp, classifyAuthorability } from './classify.mjs';

/**
 * Filter a raw `propTypes` map down to entries whose key both survived
 * scaffolding-removal AND is actually present in `keptProps` (the final,
 * sorted, scaffolding-free prop list for this component/formSettings). This
 * keeps `propTypes` strictly a subset of `props` — never a source of keys
 * `props` itself doesn't carry.
 */
function filterPropTypes(rawPropTypes, keptProps) {
  const kept = {};
  const keptSet = new Set(keptProps);
  for (const [propPath, info] of Object.entries(rawPropTypes ?? {})) {
    if (isScaffoldingProp(propPath)) continue;
    if (!keptSet.has(propPath)) continue;
    kept[propPath] = info;
  }
  return kept;
}

/**
 * Turn the harness's raw extraction into the committed registry.
 *
 * Pure: no filesystem, no clock, no randomness — so it is unit-testable and
 * produces byte-identical output for identical input. Timestamps belong to
 * the caller (gen-registry.mjs), which writes registry.meta.json.
 */
export function postprocess(raw, { frameworkVersion }) {
  const rawComponents = raw?.components ?? {};
  const types = Object.keys(rawComponents);

  // Fail loudly rather than committing an empty registry: a silent 0-component
  // registry would make every Phase 2 validator check vacuously pass.
  if (types.length === 0) {
    throw new Error('postprocess: extracted 0 components — the harness did not run correctly');
  }

  const stats = {
    total: types.length,
    authorable: 0,
    withoutVersion: 0,
    withoutProps: 0,
    droppedScaffoldingProps: 0,
  };

  const components = {};
  for (const type of types.sort()) {
    const src = rawComponents[type];

    const kept = [];
    for (const p of src.props ?? []) {
      if (isScaffoldingProp(p)) stats.droppedScaffoldingProps++;
      else kept.push(p);
    }
    kept.sort();

    // classifyAuthorability keys off the REAL prop count (post-filter), so a
    // component whose only "props" were scaffolding is correctly non-authorable.
    const { authorable, reason } = classifyAuthorability({
      group: src.group,
      isHidden: src.isHidden,
      propsCount: kept.length,
    });

    // undefined disappears through JSON.stringify; null round-trips, which the
    // Phase 2 validator relies on to distinguish "no migrator" from "not read yet".
    const version = Number.isInteger(src.version) ? src.version : null;

    if (authorable) stats.authorable++;
    if (version === null) stats.withoutVersion++;
    if (kept.length === 0) stats.withoutProps++;

    components[type] = {
      type,
      name: src.name ?? type,
      group: src.group ?? null,
      version,
      isInput: src.isInput === true,
      isOutput: src.isOutput === true,
      isHidden: src.isHidden === true,
      authorable,
      authorableReason: reason,
      props: kept,
      propTypes: filterPropTypes(src.propTypes, kept),
      customContainerNames: src.customContainerNames ?? [],
    };
  }

  // Form-level settings ("formSettings" on a form's markup) are extracted
  // from their own settings-form markup exactly like a component (see
  // extract.test.ts) but are not a toolbox component type, so they get their
  // own top-level key rather than a synthetic entry under `components`.
  const rawFormSettings = raw?.formSettings ?? { props: [], propTypes: {} };
  const formSettingsKept = [];
  for (const p of rawFormSettings.props ?? []) {
    if (isScaffoldingProp(p)) stats.droppedScaffoldingProps++;
    else formSettingsKept.push(p);
  }
  formSettingsKept.sort();

  return {
    registry: {
      frameworkVersion,
      components,
      formSettings: {
        props: formSettingsKept,
        propTypes: filterPropTypes(rawFormSettings.propTypes, formSettingsKept),
      },
    },
    stats,
  };
}
