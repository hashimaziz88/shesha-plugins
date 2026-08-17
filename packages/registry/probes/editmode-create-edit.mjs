// Probe for D-032. Confirmation cell: pending-probe:editmode-create-edit (D-065).
//
// Exits 3 uninspectable when no backend is reachable. It never exits 0 in that
// case: "could not look" and "looked and it was fine" must not share an exit code.

import { runProbe } from './lib/probe.mjs';

process.exit(await runProbe('editmode-create-edit', {
  decision: 'D-032',
  question: "Is editMode honoured at form level only, and does a component-level editMode change rendering?",
  decided: "editMode is emitted only at form level, derived from kind: list/details readOnly, create/edit editable",
}));
