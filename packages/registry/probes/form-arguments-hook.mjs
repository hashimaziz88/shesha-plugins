// Probe for D-033. Confirmation cell: pending-probe:form-arguments-hook (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('form-arguments-hook', {
  decision: 'D-033',
  question: "Which hook hydrates formArguments — onAfterDataLoad or onDataLoaded?",
  decided: "onAfterDataLoad is the only legal hook; onDataLoaded is illegal in compiler output",
}));
