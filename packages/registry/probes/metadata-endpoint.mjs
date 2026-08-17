// Probe for D-036. Confirmation cell: pending-probe:metadata-endpoint (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('metadata-endpoint', {
  decision: 'D-036',
  question: "Does entity metadata unwrap as result.properties[], and is the casing PascalCase in metadata?",
  decided: "Metadata is read from Get and unwrapped as result.properties[]; paths are camelCased when emitted",
}));
