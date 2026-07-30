# The blueprint -> markup compiler

`scripts/compile-spec.mjs` is the deterministic replacement for hand-authoring a form's
markup from a layout blueprint. It exists because the previous path — "copy the matching
seed and change modelType/propertyName/captions" — was followed correctly and still
produced broken forms: a form built that way can score **114** Tier 1 + Tier 2
findings against `validate-form.mjs`, while the compiled equivalent, built from a blueprint with
the same structure and bindings, scores **0**.

## The one-command path

```
node scripts/compile-spec.mjs <screen>.blueprint.json --out <form>.json
node scripts/validate-form.mjs <form>.json
```

`compileSpec(blueprint, {registry, roles, tokens, flows}) => {markup, report}` (importable
directly, or via the CLI above) takes a `<screen>.blueprint.json` — the artifact
`shesha-developer:shesha-design-comprehension` produces per screen, conforming to
`../shesha-design-comprehension/assets/blueprint.schema.json` — and returns a complete,
already-normalized Shesha form config. No hand-written per-form translation script stands
between a validated blueprint and pushable markup. `validate-form.mjs` is the second half of
the command pair: it is the actual "is this clean" gate (Tier 1 + Tier 2, exit 0/1) — a
compile that produces markup is not yet a compile that's done; run the validator before
treating the output as pushable. All 8 archetype fixtures plus a `card`/`collapsiblePanel`
fixture compile to zero Tier 1 and zero Tier 2 findings today
(`tests/e2e-compile.test.mjs`, `tests/card-collapsible-fixture.test.mjs`), and
`compile` then `normalize` is a no-op (idempotence, `tests/normalize.test.mjs`).

If the blueprint fails its own schema validation, `compileSpec` throws before building
anything — fix the blueprint (that is `shesha-design-comprehension`'s artifact, not this
skill's to hand-patch) and recompile, rather than patching the compiled output.

## What the compiler owns (don't re-derive these by hand)

Each of these used to be prose rules in this skill's `SKILL.md` that a model had to
remember and apply correctly on every build. They are now mechanical, emitted by a specific
step in the compile pipeline, and independently re-checked by a `validate-form.mjs` code —
so a hand-edit that gets one wrong is caught by the validator even when the compiler wasn't
used to produce it.

| Owned by the compiler | Emitter | Re-checked by |
|---|---|---|
| `parentId` on every component | `normalize-form.mjs` Phase B2 (`node.parentId = ctx.parent ? ctx.parent.id : 'root'`) | `T1-PARENT-MISSING` |
| `id` minting (real UUIDs/nanoids, no short placeholders, no duplicates) | `normalize-form.mjs` Phase B1 (`fixId`/`deterministicUuid`, seeded from the node's tree path — same input -> same id) | `T1-ID-EMPTY`, `T1-ID-DUPLICATE` |
| Per-component `version` (the hardcoded per-framework-version list this doc used to carry) | `normalize-form.mjs` Phase B3 (`stampVersion`, reads `assets/registry/registry-0.45.1.json` — the single source of truth, not a doc-maintained list) | `T1-VERSION-MISSING`, `T1-VERSION-STALE` |
| `dataContext` mandatory props (`entityType`, `sourceType: "Entity"`, `dataFetchingMode: "paging"`, `defaultPageSize: 10`) | `scripts/lib/compile/datacontext.mjs`'s `buildDataContext()` | `T2-DATACONTEXT-PROPS` |
| `buttonGroup` item shape + Submit/exit wiring (`{ actionName: "Submit", actionOwner: "shesha.form" }` paired with a Navigate/Close Dialog/Cancel Edit exit) | `scripts/lib/compile/actions.mjs`'s `buildButtonGroupItem()`/`buildButtonGroupItems()`, completed against the archetype's flow manifest when a required action is missing (`flow-complete.mjs`) | `T2-SUBMIT-WIRING`, `T2-EXIT-MISSING`, `T2-LOOSE-BUTTON` |
| `validationErrors` presence on any form with a required field | the archetype's flow manifest lists it as a required node; `flow-complete.mjs` synthesizes it (`addedBy: "flow-manifest"`) if the blueprint omitted it | `T2-VALIDATIONERRORS-MISSING` |
| `propertyName` casing (camelCase, including datatable column `propertyName`s) | `scripts/lib/compile/leaf.mjs`'s `camelCase()` | `T2-PROPERTYNAME-CASE` |
| JSON-safety of the pushed markup (no template literals / unescaped newlines in script strings) | the compiler never emits template-literal or raw-newline script strings — it builds structured JSON, not string-templated markup | `T1-JSON-UNSAFE` (also gates the push itself — see `references/push-hook.md` Group A) |
| Flex-row splits (`columns` -> flex `container`, bare children wrapped, `display:"flex"` added where a flex prop is set without it) | `normalize-form.mjs` Phase A2/A3/A6 | `T2-COLUMNS-PRESENT`, `T2-FLEXCHILD-NOT-CONTAINER`, `T2-FLEX-NO-DISPLAY` |

None of the above needs to be remembered as a rule anymore. When building from a blueprint,
run the compiler and trust its output; when a check still fires, that names a real gap
(in the blueprint, or — rarely — in the compiler) to fix at the source, not a markup detail
to patch by hand.

## What the compiler does NOT do

- **It does not edit an existing live form.** Compiling produces a brand-new, complete
  markup tree from a blueprint. Adding a field to a form that's already pushed, rewiring one
  action, or any other targeted change to markup that already exists in the backend is the
  **GET -> edit -> PUT/POST round-trip** this skill has always done (Steps 3-8 of
  `SKILL.md`) — never re-run the compiler over live markup to make a small change.
- **It does not choose the archetype or capture the design.** That is
  `shesha-developer:shesha-design-comprehension`'s job — it produces the
  `<screen>.blueprint.json` this compiler consumes. A blueprint that's wrong (wrong
  archetype, wrong bindings, an unreachable node) is a `shesha-design-comprehension` /
  authoring bug, not something to patch downstream in the compiled markup.
- **It does not style the form.** Colours, shadows, surfaces, and v7 style blocks are
  `shesha-developer:shesha-design-system`'s job, applied after this skill builds structure.
- **It has no way to express an absence claim, an ordering/alignment claim, or a
  binding/type-identity claim** — see the blueprint's `assertions[]` grammar
  (`shesha-design-comprehension/scripts/lib/assertions.mjs`) for what placement facts it
  *can* check; those gaps are a `shesha-design-comprehension` concern, not this compiler's.

## Seeds still matter — for these two things only

- **Reference reading.** `assets/exemplars/`, `assets/blocks/`, and `assets/examples/`
  remain the fastest way to see a correct, current shape for a component or a whole
  archetype — read them to understand a pattern, or when building a form with no design
  source at all (no blueprint exists, so there is nothing to compile).
- **Editing an existing live form.** The GET -> edit -> PUT/POST round-trip (`SKILL.md`
  Steps 3-8) is not the compiler's job (see above) — a seed is still the right reference
  for what a correct fragment looks like when hand-editing.

## The acceptance property

Compiled output validates clean: `node scripts/validate-form.mjs <compiled-form>.json` exits
0 with zero Tier 1 and zero Tier 2 findings, for every one of the 8 archetypes and the
card/collapsiblePanel fixture (`tests/e2e-compile.test.mjs`,
`tests/card-collapsible-fixture.test.mjs`). This is the property that makes "run the
compiler" a stronger instruction than "copy a seed and change the fields" — the seed-copy
path had no equivalent guarantee, and the regression trace (`tests/forensic-regression.test.mjs`)
is the evidence: 114 findings by hand, 0 compiled.
