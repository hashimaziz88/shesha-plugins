/**
 * Component `type` resolution — the compiler owns this per the task brief.
 *
 * Almost every blueprint node already carries the concrete registry type it
 * needs (textField, dateField, container, ...) — this module's real job is
 * resolving the small number of BLUEPRINT-VOCABULARY pseudo-types that are
 * not themselves registry entries:
 *
 *   - "subTable" (used by record-detail.blueprint.json's "relatedInvoices"
 *     node) is not a registry component at all — see the compile-spec
 *     report for why this is flagged back as a genuine blueprint-vocabulary
 *     gap rather than silently patched over. It resolves to "datatable"
 *     (authorable, has a real migrator), NOT the registry's "childTable"
 *     entry, which is authorable: false ("hidden") and cannot be hand-built
 *     by any authoring tool including this one.
 *
 * Any OTHER unknown type is a hard compile error — silently emitting an
 * unrecognized type would just relocate the T1-TYPE-UNKNOWN failure from
 * "caught here, at compile time, with a clear message" to "caught later, by
 * validate-form.mjs, with no indication of which blueprint node caused it."
 */
const TYPE_ALIASES = {
  subTable: 'datatable',
};

export function resolveComponentType(blueprintType, registry) {
  const direct = registry?.components?.[blueprintType];
  if (direct) return { type: blueprintType, aliasedFrom: null };

  const alias = TYPE_ALIASES[blueprintType];
  if (alias && registry?.components?.[alias]) {
    return { type: alias, aliasedFrom: blueprintType };
  }

  const known = Object.keys(registry?.components ?? {}).length;
  throw new Error(
    `compileSpec: blueprint type "${blueprintType}" is not one of the ${known} known registry types and has no `
    + 'recognized alias. Add a mapping in scripts/lib/compile/type-registry.mjs or fix the blueprint node.',
  );
}
