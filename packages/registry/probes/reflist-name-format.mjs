// Probe for D-030. Confirmation cell: pending-probe:reflist-name-format (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('reflist-name-format', {
  decision: 'D-030',
  question: "Does a referenceListId with a module prefix inside `name` load, or raise ConfigurationLoadingError?",
  decided: "referenceListId is always { module, name }; a module prefix inside name is illegal everywhere",
}));
