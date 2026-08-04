# Authoring a form

You do not write Shesha form JSON. You write a **JSX spec** against a generated mirror kit,
render it, look at it, and let `compile` carry it down. The JSON is a build artefact.

## Why a mirror kit exists

A model writing form JSON directly is designing blind — it cannot see the result, so it optimises
for plausible-looking markup. The mirror kit is a set of React components generated from three
inputs, with **zero hand-written per-component code**:

- **ground truth** → which props each component really has
- **house anatomy** → structure and posture rules
- **a token file** → appearance

Because it is generated, it cannot drift from the framework. Because it is renderable, you can
`preview` it in under a second and *look* before committing.

## The vocabulary

Generated into `<app>/.shesha/kit/`, imported as `@shesha-mirror/kit`. 35 components:

**Page shell** `Page` `PageHeader` `Breadcrumbs`
**Layout** `Stack` `Row` `Card` `Tabs` `Tab` `Modal`
**Summary** `KeyInfoBar` `KeyFactsStrip` `StatCard` `Fact` `CountBadge` `ProgressBar`
**Table** `DataTable` `Column` `EmptyState`
**Actions** `ActionRow` `ButtonGroup` `Button` `SegmentedControl`
**Inputs** `Field` `Select` `Checkbox` `Switch` `Textarea`
**Text & status** `Text` `MicroLabel` `SectionLabel` `Badge` `StatusPill` `InfoCallout`
`ValidationSummary` `Toast`

`kit-manifest.json` lists each component's real props. `_forbidden.js` records what the kit
refuses to expose, and why.

## The token boundary

**Appearance is `emphasis` / `surface` / `role` / `density` — and nothing else.**

Absent from a spec, by design: no hex values, no px sizes, no `style`, no `className`, no
`desktop.*` paths, no raw `div`. Switching `--theme` must change *resolved values only* — same
components, same props, same DOM shape. A test asserts that; anything else is a leak.

```jsx
<StatCard label="Zero-g cleared" value="94" caption="training complete" emphasis="success" />
```

`emphasis` resolves through the token file. If a brand nulls an accent, the kit falls back rather
than inventing a colour.

## A spec

```jsx
import { Page, PageHeader, KeyInfoBar, StatCard, Card, Row,
         ButtonGroup, Button, DataTable, Column } from '@shesha-mirror/kit';

export default function AstronautWorklist() {
  return (
    <Page archetype="table-worklist"
          entity="boxfusion.test.Domain.Domain.Astronauts.Astronaut">
      <PageHeader title="Astronauts" subtitle="Everyone currently on the roster." />

      <KeyInfoBar>
        <StatCard label="Total crew" value="128" caption="across 9 missions" />
        <StatCard label="Grounded" value="8" caption="medical" emphasis="danger" />
      </KeyInfoBar>

      <Card title="Crew register" meta="128 records">
        <Row justify="end">
          <ButtonGroup><Button label="refresh" /><Button label="add" emphasis="primary" /></ButtonGroup>
        </Row>
        <DataTable>
          <Column bind="FullName" label="Name" />
          <Column bind="SpecialisationRole" label="Specialisation" />
        </DataTable>
      </Card>
    </Page>
  );
}
```

`archetype` selects the compiler's structural template and the fidelity calibration entry.
`entity` is the full class name from live metadata.

## Binding

**Every `bind` must be a real property of the entity.** Metadata returns PascalCase
(`FullName`); the compiler camelCases it, because Shesha camelCases the query while the cell
accessor reads the literal `propertyName`. A PascalCase column therefore fetches rows with a
correct pager count and renders **every cell blank** — R-004 catches it.

Verify against live metadata, not memory:

```bash
node scripts/shesha.mjs explain <EntityFullClassName>
```

## The loop

```bash
node scripts/shesha.mjs preview  --spec form.spec.jsx --app <p>            # ~0.7s → look at it
node scripts/shesha.mjs compile  --spec form.spec.jsx --app <p> -o form.json
node scripts/shesha.mjs check    --file form.json --app <p>
```

Iterate on `preview` until the mock is right. Only then compile. `preview` exists so design
decisions are made against pixels instead of against imagination.

Spec errors exit **6** (invalid spec), **14** (JSX will not parse) or **15** (a component that is
not in the kit). Exit 15 is not a licence to hand-write markup — either use the kit's vocabulary
or report the gap.

## What the compiler does for you

Do not hand-author these; they are emitted correctly and validated:

- deterministic ids (`nanoid(30)` seeded by spec path, so recompiling is stable)
- the current `version` per type, from that type's migrator chain
- the text contract — `textType` + `contentDisplay` + `contentType` together (R-059)
- `stylingBox` as a **stringified** JSON string (never `stylingBoxJson`, which does not exist)
- `_type: 'action-config'` on every `actionConfiguration`
- a `dataContext` wrapper (never `datatableContext`)
- table columns under `items` (never `columns`)
- micro-label content upper-cased, numerals at the theme's numeral weight

## Posture rules

`assets/house-anatomy.json` carries 10 adopted posture rules (P-01…P-10), each with an enforcer,
plus a `notAdopted` block recording rejected claims **with the evidence for rejecting them**. All
colours are `@token` references; a test asserts no literal ever appears there.
