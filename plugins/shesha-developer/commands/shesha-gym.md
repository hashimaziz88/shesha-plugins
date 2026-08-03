---
description: Rerun the component gym against a backend to regenerate the measured capability matrix
argument-hint: [--backend url] [--portal url] [--only type1,type2]
---

Rerun the Shesha component gym per
`plugins/shesha-developer/skills/shesha-form-edit/references/gym.md` — all
scripts below live in `plugins/shesha-developer/skills/shesha-form-edit/scripts/`:

1. Preconditions: backend + adminportal running; `npm install && npx
   playwright install chromium` in the shesha-form-edit skill folder.
2. If the target Shesha release differs from `assets/components-kb/_meta.json`:
   regenerate the KB first (`generate-component-kb.js` against that release's
   `designer-components` source) and re-extract enums (`extract-enums.js`),
   then regenerate the schema (`generate-schema.js`).
3. `node scripts/generate-component-gym.js $ARGUMENTS` →
   `node scripts/run-gym.js $ARGUMENTS` (baseline-salvage any form-level
   crashes with `--baseline-only --only <types>`).
4. `node scripts/merge-capability.js --dry-run`, review contradictions, then
   run it for real.
5. Report the coverage summary (renderStatus counts, per-effect totals,
   contradictions) and commit the regenerated artifacts.
