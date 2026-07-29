import { isScaffoldingProp, classifyAuthorability } from './classify.mjs';

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
      customContainerNames: src.customContainerNames ?? [],
    };
  }

  return {
    registry: { frameworkVersion, components },
    stats,
  };
}
