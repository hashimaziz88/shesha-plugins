/**
 * dataContext mandatory props — the compiler owns this per the task brief.
 *
 * tier2.mjs's T2-DATACONTEXT-PROPS hard-requires exactly four keys
 * (entityType, sourceType, dataFetchingMode, defaultPageSize — NOT
 * uniqueStateId, corrected out in Task 5, see tier2.mjs's own header
 * comment) on EVERY dataContext node regardless of archetype, even though
 * individual flow manifests list a slightly different prop set per
 * archetype (record-detail's flow asks for uniqueStateId instead of
 * defaultPageSize). Tier 2 is the actual "clean" gate, so every dataContext
 * this module builds carries all four required keys unconditionally.
 * `uniqueStateId` is deliberately NOT emitted even though a couple of flow
 * manifests list it: the registry's own `dataContext.props` (assets/
 * registry/registry-0.45.1.json) does not declare it, so stamping it trips
 * T1-PROP-UNKNOWN; references/components/child-tables.md's "tolerated"
 * note turns out to describe OTHER, legacy components (table/childTable/
 * dataSource/entityPicker/wizard/button), not dataContext itself (see
 * tier2.mjs's own T2-DATACONTEXT-PROPS header comment, which reconciles the
 * exact same discrepancy).
 */
export function buildDataContext(bpNode, { blueprint }) {
  const modelType = blueprint.entity?.modelType;
  return {
    componentName: bpNode.node,
    propertyName: bpNode.node,
    entityType: modelType ? { name: modelType.name, module: modelType.module } : blueprint.entity?.fullClassName,
    sourceType: 'Entity',
    dataFetchingMode: 'paging',
    defaultPageSize: 10,
  };
}
