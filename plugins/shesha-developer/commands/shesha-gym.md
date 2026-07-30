---
description: Rerun the component gym against a backend to regenerate the measured capability matrix
argument-hint: [--backend url] [--portal url] [--only type1,type2]
---

Rerun the Shesha component gym using `shesha-developer:shesha-gym` (invoke
the skill now and follow its process exactly).

Arguments: `$ARGUMENTS` — forwarded as-is to
`shesha-form-edit/scripts/generate-component-gym.js`/`shesha-form-edit/scripts/run-gym.js`
(e.g. `--backend url`, `--portal url`, `--only type1,type2`).

The skill owns the authoritative procedure (preconditions, KB/enum/schema
regeneration order, generate + measure, merge, verify + commit — including
the green-tests requirement before committing). Do not shortcut its steps
here.
