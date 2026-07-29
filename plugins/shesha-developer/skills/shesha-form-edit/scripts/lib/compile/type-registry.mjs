/**
 * Component `type` resolution — the compiler owns this per the task brief.
 *
 * Every blueprint node must already carry a concrete registry type
 * (textField, dateField, container, datatable, ...). There is no alias
 * table here: a prior version of this module mapped the blueprint-only
 * pseudo-type "subTable" to "datatable" so a fixture using a non-existent
 * type would still compile — but an alias in the compiler just hides an
 * invalid vocabulary from validation, letting the next blueprint author
 * repeat the same mistake with no signal anywhere that "subTable" was never
 * real. The fix was at the fixture: record-detail.blueprint.json's
 * "relatedInvoices" node now authors "datatable" directly (authorable, has
 * a real migrator) — never the registry's "childTable" entry, which is
 * authorable: false ("hidden") and cannot be hand-built by any authoring
 * tool including this one.
 *
 * An unknown type is a hard compile error — silently emitting an
 * unrecognized type would just relocate the T1-TYPE-UNKNOWN failure from
 * "caught here, at compile time, with a clear message" to "caught later, by
 * validate-form.mjs, with no indication of which blueprint node caused it."
 */
export function resolveComponentType(blueprintType, registry) {
  const direct = registry?.components?.[blueprintType];
  if (direct) return { type: blueprintType, aliasedFrom: null };

  const known = Object.keys(registry?.components ?? {}).length;
  throw new Error(
    `compileSpec: blueprint type "${blueprintType}" is not one of the ${known} known registry types. `
    + 'Fix the blueprint node to use a real, authorable registry type.',
  );
}
