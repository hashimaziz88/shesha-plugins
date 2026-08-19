// @shesha/registry — L0 ground truth: component registry, capability matrix,
// tokens, probes, and the single coverage-accounting implementation (D-002).
//
// Zero runtime dependencies, so anything in the repo may import it and the
// dependency arrow registry <- sfs <- verify is never reversed (D-041).

export * from './coverage.mjs';
export * from './load.mjs';

/** Semantic version of the registry package surface. */
export const REGISTRY_API_VERSION = '0.1.0';
