---
name: shesha-spec
description: Author Shesha forms as SFS — a typed intermediate representation the compiler turns into form markup. You never write or edit form JSON by hand; you write ~800 bytes of intent and the compiler produces ~19,000 bytes of markup. Use whenever a Shesha form is created or changed.
---

# shesha-spec

## What SFS is

SFS is a typed IR for Shesha forms. You write intent; the compiler writes markup.
The compiler is the only writer of form markup — no agent, skill, or hand edits a
`*.form.json`. A form is one `*.sfs.json` file: a `kind`, an `entity`, and a `body`
of nodes. Roughly 800 bytes of SFS compiles to roughly 19,000 bytes of markup, and
the same input always produces the same bytes (ids are derived, never random).

## The examples

These are the worked forms. Open the one whose `kind` and shape are nearest your
task, read it, then write yours. They live in `packages/sfs/corpus/`.

| file | kind | what it teaches |
|---|---|---|
| `employee-table.json` | table | a data table over an entity, columns and row actions |
| `employee-create.json` | create | a create form, sections and inputs |
| `employee-detail-with-child-tables.json` | detail | a read-only detail with nested child tables |
| `employee-detail-without-child-tables.json` | detail | the same detail without children |
| `entity-card.json` | card | a single-entity card layout |
| `entity-datalist.json` | datalist | a card-per-row data list |
| `standalone-create.json` | create | a create form with no parent entity context |
| `rs-table.json` | table | a table on a second entity, for contrast |
| `rs-create-dialog.json` | create | a create rendered as a dialog |
| `rs-detail-with-header.json` | detail | a detail with a header band |
| `rs-link-add-dialog.json` | create | a link-existing / add dialog |

## Two shapes, inlined

A table is a `data` region with a `table` node naming its columns:

```
{ "node": "data", "source": "<module>/<Entity>",
  "body": [ { "node": "table", "columns": ["Name", "Status", "CreatedOn"] } ] }
```

A field resolves its input type from the entity's metadata — you name the property,
not the component:

```
{ "node": "field", "name": "EmailAddress" }
```

## The eight things you cannot write

Each is a schema or resolve constraint the compiler enforces with a named code
(`packages/sfs/config/error-catalogue.json` is the full list).

1. A compiler-owned key (an `id`, a `parentId`) — the compiler stamps those. `SFS-1003`
2. A `field` whose component is not an authorable input type. `SFS-1004`
3. A `node:"raw"` with no `raw.type` naming the component. `SFS-1802`
4. A reference list with no module prefix; write `<module>/<RefList>`. `MET-2301`
5. A literal colour; colours are only reachable through a `$role:`/`$type:` token. `TOK-2010`
6. A component the registry lacks — the banned `columns` among them. `REG-2101`
7. An action verb outside the intent grammar. `REG-2301`
8. A node with no `data` ancestor. `SFS-1201`

## The escape hatch

When the grammar cannot express something, `node:"raw"` emits a component verbatim.
It needs a `reason` of at least twelve characters saying why the grammar fell short.
Escapes are counted and published per form; a structural-escape rate above twenty
percent means the IR is wrong for that form, not that you should keep escaping —
raise it (`BACKLOG.md`), do not paper over it.

## The loop

1. Write or edit the `*.sfs.json`.
2. Compile it: `npm run sfs -- compile <input.sfs.json> --out <dir>`.
3. Read the diagnostics; each names a code and the exact path in your SFS.
4. Fix at that path and recompile.

Cap at six compiles / three repair rounds. The same code at the same path twice
means you are stuck: stop and escalate rather than guessing again.

## Where the truth is

No prose copy of any of these exists in this skill; read the source:

- **Schema** — `packages/sfs/schema/sfs.schema.json` (what a valid SFS document is)
- **Registry** — `npm run sfs -- --version` and `packages/registry/data/` (types, versions)
- **Entity metadata** — the backend `Get` for the entity (its properties and datatypes)
- **Errors** — `packages/sfs/config/error-catalogue.json` (every code and its symptom)
