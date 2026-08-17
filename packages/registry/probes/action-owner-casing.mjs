// Probe for D-034. Confirmation cell: pending-probe:action-owner-casing (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('action-owner-casing', {
  decision: 'D-034',
  question: "Does an actionOwner of \"Shesha.Common\" bind, or silently no-op against lowercase \"shesha.common\"?",
  decided: "actionOwner is lowercase dotted or a resolved component id; actionName is the spaced form",
}));
