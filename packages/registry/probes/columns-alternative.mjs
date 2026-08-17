// Probe for D-035. Confirmation cell: pending-probe:columns-alternative (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('columns-alternative', {
  decision: 'D-035',
  question: "Does a flex container row sized by desktop.dimensions.width reproduce the columns component layout?",
  decided: "The columns component is banned unconditionally; multi-column layout is a flex container row",
}));
