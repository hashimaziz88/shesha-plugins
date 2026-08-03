# Style capability — the two matrices and how to read them

"Does style channel X actually work on component Y?" has one authoritative answer and one annotation layer. The props index says what's *legal*; these say what *renders*.

## 1. The measured matrix — THE AUTHORITY

`shesha-form-edit/assets/measured-capability-matrix.json` is the gym-measured 0.45 authority; schema, effect vocabulary, and regeneration procedure are canonical in `shesha-form-edit/references/gym.md` — read that, not a restatement here.

## 2. The local matrix — ANNOTATION ONLY

[`../assets/capability-matrix.json`](../assets/capability-matrix.json) — the hand-curated layer the measured matrix can't express:

- **technique keys** — the exact working key path per row (e.g. `desktop.background{type:'color',color}`, per-side borders need `borderType:'custom'`);
- **`crossCuttingRules`** — version-must-match-live [R-003], `display:"flex"` required [R-029], sizing via `dimensions.width` [R-028], font-on-container no-op, live-measurement gotchas;
- **fixes** — multi-step recipes (the datalist row-template overflow/collapse fix [R-048], code-mode `hidden` over `customVisibility` in row templates [R-031]).

`shesha-form-edit/scripts/merge-capability.js` overlays measured evidence onto each row (`measured: {summary, effects, generation, measuredAt}`) and stamps `contradicted: true` where the gym categorically disagrees with a hand verdict — those are the leaky-abstraction bugs to fix. `validate-blocks.js` already gates blocks against the measured matrix.

## How to answer a capability question

1. **Measured matrix first** — look up `components.<Type>.settings` for the path; the `effect` is the verdict.
2. **Technique key second** — the local row tells you the *shape* that makes the channel work (key path, prerequisites, multi-step fix).
3. Path not measured (`not-measured`/absent) → treat the hand verdict as provisional; probe a live form before relying on it, and queue the path for the next gym run (`shesha-form-edit/references/gym.md`).
4. A `contradicted` row → the measured verdict wins; do not author from the hand verdict.
