// @shesha/sfs — L1+L2: the SFS language, parser, compiler, decompiler,
// normaliser, recipes and the `sfs` CLI. The only writer of form markup (D-003).
//
// This package must never import packages/verify: a compiler that calls its own
// verifier cannot be audited by it (D-041, enforced by g-workspace-hygiene).

export * from './lib/coverage.mjs';

/** SFS language version. The compiler stamps this into every compile report. */
export const SFS_LANGUAGE_VERSION = '0.1.0';
