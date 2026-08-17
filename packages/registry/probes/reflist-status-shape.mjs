// Probe for D-031. Confirmation cell: pending-probe:reflist-status-shape (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('reflist-status-shape', {
  decision: 'D-031',
  question: "Does refListStatus accept flat module / referenceListName keys, or only referenceListId { module, name }?",
  decided: "refListStatus carries referenceListId { module, name } and nothing else",
}));
