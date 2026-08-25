#!/usr/bin/env node
/**
 * validate-form-markup.cjs — MANDATORY pre-push check for shesha-crud-forms
 * (and shesha-form-edit's Step 6 blocking gate).
 *
 * Enforces the "silent-drop-on-render", "React-key-collision", and "component-crash"
 * rules that agents repeatedly re-introduce despite the docs. Every rule below maps
 * to a symptom observed on a live build.
 *
 * Usage:
 *   node validate-form-markup.cjs <path-to-markup.json>
 *   cat markup.json | node validate-form-markup.cjs -
 *
 * Exit codes:
 *   0 — no critical issues (may emit warnings on stderr)
 *   1 — one or more BLOCK-push violations found (do NOT push)
 *   2 — usage / IO error
 *
 * Rules checked:
 *   R1   Every typed component has an integer `version` (dataContext version is WARN-only).
 *   R2   No plain-string `text.content` / `link.href` uses `{{data.<prop>}}` — silently
 *        renders empty. Correct form is `{{<prop>}}`.
 *   R3   Datatable column `displayComponent`/`editComponent`/`createComponent`: any real
 *        type (not `[default]` / `[not-editable]`) MUST be wrapped in `settings` with
 *        `version` — otherwise crashes with `reading 'version'` at cell render.
 *   R4   Tabs: `tab.key === tab.id` AND all `tab.id` unique within `tabs.tabs[]`.
 *        Otherwise React key collision → multiple tab bodies render on the visible tab.
 *   R5   componentName uniqueness across sibling tab bodies (WARN — seeds also violate).
 *   R6   For each `card`, every field-holding `container` under `content.components` uses
 *        `desktop.display === "grid"` with `gridColumnsCount ∈ {2, 3}`.
 *   R7   A form whose top-level component tree is a `container` wrapping a single
 *        `dataContext` is a hand-authored departure from the seed's "dataContext at root"
 *        convention — WARN.
 *   R8   Every `buttonGroup` has `isInline: true`. Otherwise buttons collapse into a "..."
 *        dropdown and the user sees no button. Observed on org-details, notification-*.
 *   R9   On a form whose `dataLoaderType === "none"` OR whose form name matches /(create|
 *        register|new-|-new)/, every input has `editMode === "editable"`. `inherited`
 *        renders dead labels with no input boxes on a standalone create page.
 *        (Details forms use `inherited` — the check runs only on create-family names.)
 *   R10  `dataContext.permanentFilter` must be JsonLogic + mustache `evaluate` — NOT
 *        `{ _mode: "code", _code: "..." }`. The backend expects the JsonLogic shape;
 *        code-mode returns a JS object that hits the Entities/GetAll endpoint with the
 *        wrong query and 400s.
 *   R11  Extends R2: plain-string `{{data.<prop>}}` is also blocked in
 *        `refListStatus.propertyName`, `button.actionArguments.target`, and any
 *        plain-string `link.href`.
 *   R12  datalist wiring: `formSelectionMode === "name"` AND `formId` is
 *        `{ name, module }` — the canonical row-template pattern. Missing either
 *        renders the list empty.
 *   R13  Grid + space-between: any `container` with `desktop.display === "grid"`
 *        MUST NOT use `justifyContent: "space-between"`. Grids distribute via
 *        `gridColumnsCount`; space-between conflicts and breaks layout.
 *   R14  Soft-shadow byte-exactness: any `container` with `desktop.shadow.blurRadius > 0`
 *        MUST use the canonical soft shadow — `{offsetX:0, offsetY:2, blurRadius:8,
 *        spreadRadius:2, color:"rgba(0,0,0,0.05)"}`. Solid `#000000` shadows produce
 *        the "too dark" render observed on the organisations form.
 *   R15  pageShell canon: any `container` with `desktop.background.color === "#fafafa"`
 *        (the grey outer page shell) MUST carry `stylingBox` padding "20" on all four
 *        sides. Missing padding produces the "content-glued-to-edge" render.
 *   R16  (informational, WARN) any container using the deprecated field `columns` at
 *        top level — the canonical seeds never do; use flex/grid containers instead.
 *
 * Add rules here as new defect patterns are observed. Every rule number maps to a
 * documented rule in references/canonical-seeds.md / binding-rules.md / functional-
 * requirements.md.
 */

const fs = require('fs');

function readMarkup(pathArg) {
  const raw = pathArg === '-'
    ? fs.readFileSync(0, 'utf8')
    : fs.readFileSync(pathArg, 'utf8');
  const parsed = JSON.parse(raw);
  // Accept both { components, formSettings } and a stringified markup wrapper
  if (typeof parsed === 'string') return JSON.parse(parsed);
  if (parsed.markup && typeof parsed.markup === 'string') return JSON.parse(parsed.markup);
  return parsed;
}

function walk(nodes, visitor, parents = []) {
  if (!Array.isArray(nodes)) return;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    visitor(n, parents);
    const stack = parents.concat(n);
    for (const k of ['components', 'items']) {
      const v = n[k];
      if (Array.isArray(v)) walk(v, visitor, stack);
    }
    if (Array.isArray(n.tabs)) {
      for (const t of n.tabs) if (Array.isArray(t.components)) walk(t.components, visitor, stack);
    }
    for (const slot of ['header', 'content']) {
      const s = n[slot];
      if (s && Array.isArray(s.components)) walk(s.components, visitor, stack);
    }
  }
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node validate-form-markup.js <path-to-markup.json | -->');
    process.exit(2);
  }
  const markup = readMarkup(arg);
  if (!markup.components || !Array.isArray(markup.components)) {
    console.error('input has no top-level `components` array — is this a Shesha form markup?');
    process.exit(2);
  }

  const errors = [];
  const warnings = [];

  // ---------- R1 : component version present ----------
  // Exceptions:
  //   - Column entries + buttonGroup items don't carry outer 'version' (wrapped-settings carries it).
  //   - dataContext version is OPTIONAL per canonical-crud-seeds.md ("sample carries no version;
  //     stamp 8 for consistency"). Emit as WARN so authors get a nudge without blocking.
  walk(markup.components, (n, parents) => {
    if (!n.type) return;
    const parent = parents[parents.length - 1];
    if (parent && (parent.type === 'datatable' || parent.type === 'buttonGroup')) return;
    if (typeof n.version !== 'number') {
      if (n.type === 'dataContext') {
        warnings.push({ rule: 'R1', where: n.componentName || n.type, msg: `dataContext missing 'version' (seed omits it; consider stamping 8 for consistency)` });
      } else {
        errors.push({ rule: 'R1', where: n.componentName || n.type, msg: `component ${n.type} missing integer 'version'` });
      }
    }
  });

  // ---------- R2 : no {{data.<x>}} in plain-string text.content or refListStatus.propertyName ----------
  const badMustache = /\{\{data\.[a-zA-Z0-9_.]+\}\}/;
  walk(markup.components, (n) => {
    if (n.type === 'text' && typeof n.content === 'string' && badMustache.test(n.content)) {
      errors.push({ rule: 'R2', where: n.componentName || 'text', msg: `text.content contains {{data.…}} — silently renders empty; use {{<prop>}} directly. content="${n.content}"` });
    }
    if (n.type === 'link' && typeof n.href === 'string' && badMustache.test(n.href)) {
      errors.push({ rule: 'R2', where: n.componentName || 'link', msg: `link.href contains {{data.…}} — use {{<prop>}} or code-mode` });
    }
  });

  // ---------- R3 : datatable cell components wrapped in settings ----------
  const SENTINELS = new Set(['[default]', '[not-editable]']);
  walk(markup.components, (n) => {
    if (n.type !== 'datatable') return;
    const cols = Array.isArray(n.items) ? n.items : [];
    for (const col of cols) {
      if (!col || typeof col !== 'object') continue;
      const pn = col.propertyName || col.caption || '?';
      for (const slot of ['displayComponent', 'editComponent', 'createComponent']) {
        const s = col[slot];
        if (!s || typeof s !== 'object') continue;
        const t = s.type;
        if (!t) {
          errors.push({ rule: 'R3', where: `col ${pn}`, msg: `${slot} has no type — must be a sentinel or a wrapped component` });
          continue;
        }
        if (SENTINELS.has(t)) continue;
        // Real component — MUST be wrapped
        if (!s.settings || typeof s.settings !== 'object') {
          errors.push({ rule: 'R3', where: `col ${pn}`, msg: `${slot}.type="${t}" needs a "settings" wrapper (crashes with reading 'version' at cell render)` });
          continue;
        }
        if (typeof s.settings.version !== 'number') {
          errors.push({ rule: 'R3', where: `col ${pn}`, msg: `${slot}.settings missing integer 'version' — crashes at cell render` });
        }
        if (s.settings.type && s.settings.type !== t) {
          errors.push({ rule: 'R3', where: `col ${pn}`, msg: `${slot}.type="${t}" but settings.type="${s.settings.type}" — must match` });
        }
      }
    }
  });

  // ---------- R4 : tabs identity ----------
  walk(markup.components, (n) => {
    if (n.type !== 'tabs') return;
    const tabs = Array.isArray(n.tabs) ? n.tabs : [];
    const ids = new Set();
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      if (!t.id) { errors.push({ rule: 'R4', where: `tabs(${n.componentName}) tab[${i}]`, msg: 'missing tab.id' }); continue; }
      if (!t.key) { errors.push({ rule: 'R4', where: `tabs(${n.componentName}) tab[${i}]`, msg: 'missing tab.key' }); continue; }
      if (t.key !== t.id) errors.push({ rule: 'R4', where: `tabs(${n.componentName}) tab[${i}] "${t.title}"`, msg: `tab.key !== tab.id (routing loses mapping — both tab bodies render)` });
      if (ids.has(t.id)) errors.push({ rule: 'R4', where: `tabs(${n.componentName}) tab[${i}] "${t.title}"`, msg: `duplicate tab.id "${t.id}" — React key collision → both bodies render` });
      ids.add(t.id);
    }
  });

  // ---------- R5 : componentName uniqueness across sibling tab bodies ----------
  walk(markup.components, (n) => {
    if (n.type !== 'tabs') return;
    const tabs = Array.isArray(n.tabs) ? n.tabs : [];
    if (tabs.length < 2) return;
    const namesPerTab = tabs.map((t, i) => {
      const seen = new Set();
      walk(t.components || [], (child) => { if (child.componentName) seen.add(child.componentName); });
      return { i, title: t.title, names: seen };
    });
    for (let i = 0; i < namesPerTab.length; i++) {
      for (let j = i + 1; j < namesPerTab.length; j++) {
        const inter = [...namesPerTab[i].names].filter(x => namesPerTab[j].names.has(x));
        if (inter.length > 0) {
          warnings.push({ rule: 'R5', where: `tabs(${n.componentName}) tab[${i}] "${namesPerTab[i].title}" vs tab[${j}] "${namesPerTab[j].title}"`, msg: `${inter.length} colliding componentName(s): ${inter.slice(0, 6).join(', ')} — uniqueStateId scopes may misroute` });
        }
      }
    }
  });

  // ---------- R6 : card content — field-holding containers use grid layout ----------
  // Seed pattern (from sample-patient-details): card.content.components can be a SEQUENCE of:
  //   • container(display:"grid", gridColumnsCount: 2 or 3) holding field-row groups
  //   • standalone span-full siblings — `address`, `htmlRender`, `textField`, `textArea`
  // Rule: any DIRECT-CHILD container of card.content that contains ≥1 field-like grandchild
  //       MUST use desktop.display === "grid" AND gridColumnsCount ∈ {2, 3}.
  //       Multiple grid containers + interleaved span-full siblings are allowed.
  const FIELD_TYPES = new Set([
    'textField','textArea','numberField','dateField','dropdown','autocomplete',
    'checkbox','checkboxGroup','address','htmlRender','refListStatus','entityReference',
  ]);
  walk(markup.components, (n) => {
    if (n.type !== 'card') return;
    const content = n.content;
    if (!content || !Array.isArray(content.components) || content.components.length === 0) {
      errors.push({ rule: 'R6', where: `card ${n.componentName}`, msg: 'card.content.components missing or empty' });
      return;
    }
    for (const child of content.components) {
      if (!child || typeof child !== 'object' || child.type !== 'container') continue;
      // Does this container hold field-like grandchildren?
      const gc = Array.isArray(child.components) ? child.components : [];
      const hasFields = gc.some(g => g && FIELD_TYPES.has(g.type));
      if (!hasFields) continue;
      const dsk = child.desktop || {};
      if (dsk.display !== 'grid') {
        errors.push({ rule: 'R6', where: `card ${n.componentName} / ${child.componentName || 'container'}`, msg: `field-holding container missing desktop.display === "grid" (seed uses grid; do not decompose into horizontal-flex rows)` });
      } else if (dsk.gridColumnsCount !== 2 && dsk.gridColumnsCount !== 3) {
        errors.push({ rule: 'R6', where: `card ${n.componentName} / ${child.componentName || 'container'}`, msg: `field-holding container has gridColumnsCount=${dsk.gridColumnsCount}; seed uses 2 or 3` });
      }
    }
  });

  // ---------- R7 : dataContext at root (table archetype hint) ----------
  const tops = markup.components;
  if (tops.length === 1 && tops[0].type === 'container') {
    const kids = tops[0].components || [];
    if (kids.length >= 1 && kids[0].type === 'dataContext') {
      warnings.push({ rule: 'R7', where: `root ${tops[0].componentName}`, msg: `Top-level is a container wrapping a dataContext — sample-patient-table seed puts dataContext AT the root. If this is a table form, unwrap.` });
    }
  }

  // ---------- R8 : every buttonGroup has isInline: true ----------
  // Without it, buttons collapse into a "..." dropdown and the user sees no button.
  walk(markup.components, (n) => {
    if (n.type !== 'buttonGroup') return;
    if (n.isInline !== true) {
      errors.push({ rule: 'R8', where: `buttonGroup(${n.componentName || '?'})`, msg: `isInline is ${n.isInline} — must be true, otherwise buttons collapse into "..."` });
    }
  });

  // ---------- R9 : create-form inputs use editMode: "editable" ----------
  // Detect create-family form via formSettings.dataLoaderType === "none" OR
  // the modelType being null (form is not bound) OR the form name (not available here).
  // Heuristic: apply the check when dataLoaderType === "none" AND some inputs have
  // editMode: "inherited". Also apply when dataSubmitterType === "gql" but
  // dataLoaderType === "none" — that's the classic create-in-modal pattern.
  const fs2 = markup.formSettings || {};
  const looksLikeCreate = fs2.dataLoaderType === 'none' && fs2.dataSubmitterType === 'gql';
  if (looksLikeCreate) {
    const INPUT_TYPES = new Set(['textField','textArea','numberField','dateField','dropdown','autocomplete','checkbox','checkboxGroup','address']);
    walk(markup.components, (n) => {
      if (!INPUT_TYPES.has(n.type)) return;
      if (n.editMode === 'inherited') {
        errors.push({ rule: 'R9', where: `${n.type}(${n.componentName || n.propertyName || '?'})`, msg: `editMode='inherited' on a create-form input — renders as a dead label with no input box. Use 'editable' on standalone create pages.` });
      }
    });
  }

  // ---------- R10 : dataContext.permanentFilter uses JsonLogic + evaluate, not code-mode ----------
  // Code-mode returns a JS object the query builder can't serialise → 400 on Entities/GetAll.
  walk(markup.components, (n) => {
    if (n.type !== 'dataContext') return;
    const pf = n.permanentFilter;
    if (!pf) return;
    if (typeof pf === 'object' && pf._mode === 'code') {
      errors.push({ rule: 'R10', where: `dataContext(${n.componentName || '?'})`, msg: `permanentFilter uses {_mode:"code"} — this 400s on Entities/GetAll. Use JsonLogic + mustache evaluate: { and: [{ "==": [{ var: "<parentFk>" }, { evaluate: [{ expression: "{{data.id}}", required: true, type: "mustache" }] }] }] }` });
      return;
    }
    // Also check: the JsonLogic shape should reference an evaluate wrapper for the mustache RHS
    // (basic shape check — the `and` array with a `==` comparator is the seed pattern).
    if (typeof pf === 'object' && !Array.isArray(pf.and)) {
      warnings.push({ rule: 'R10', where: `dataContext(${n.componentName || '?'})`, msg: `permanentFilter doesn't have the canonical { and: [...] } wrapper — check against child-tables seed shape` });
    }
  });

  // ---------- R11 : {{data.<prop>}} in refListStatus.propertyName / action targets ----------
  walk(markup.components, (n) => {
    // refListStatus binding
    if (n.type === 'refListStatus' && typeof n.propertyName === 'string' && badMustache.test(n.propertyName)) {
      errors.push({ rule: 'R11', where: `refListStatus(${n.componentName || '?'})`, msg: `propertyName contains {{data.…}} — refListStatus binds via bare property path (e.g. "status"), no mustache prefix at all` });
    }
    // buttonGroup items: check actionArguments.target for {{data.…}}
    if (n.type === 'buttonGroup' && Array.isArray(n.items)) {
      for (const it of n.items) {
        const target = it?.actionConfiguration?.actionArguments?.target;
        if (typeof target === 'string' && badMustache.test(target)) {
          errors.push({ rule: 'R11', where: `buttonGroup(${n.componentName || '?'}) item "${it.label || '?'}"`, msg: `actionArguments.target contains {{data.…}} — use {{<prop>}} or {{selectedRow.<prop>}}` });
        }
      }
    }
    // Same for column action targets inside datatable.items
    if (n.type === 'datatable' && Array.isArray(n.items)) {
      for (const col of n.items) {
        const target = col?.actionConfiguration?.actionArguments?.target;
        if (typeof target === 'string' && badMustache.test(target)) {
          errors.push({ rule: 'R11', where: `datatable(${n.componentName || '?'}) col "${col.caption || col.propertyName || '?'}"`, msg: `column actionArguments.target contains {{data.…}}` });
        }
      }
    }
  });

  // ---------- R12 : datalist wiring (formSelectionMode: "name" + formId object) ----------
  // The canonical datalist row-template pattern. Missing either renders the list empty.
  walk(markup.components, (n) => {
    if (n.type !== 'datalist') return;
    const cn = n.componentName || '?';
    if (n.formSelectionMode !== 'name') {
      errors.push({ rule: 'R12', where: `datalist(${cn})`, msg: `formSelectionMode is ${JSON.stringify(n.formSelectionMode)} — must be "name" for the canonical row-template pattern` });
    }
    const fid = n.formId || n.formIdentifier;
    if (!fid || typeof fid !== 'object' || !fid.name || !fid.module) {
      errors.push({ rule: 'R12', where: `datalist(${cn})`, msg: `formId must be { name, module } — got ${JSON.stringify(fid)}` });
    }
  });

  // ---------- R13 : Grid + space-between ----------
  // Grid containers distribute via gridColumnsCount; justifyContent:"space-between" conflicts.
  walk(markup.components, (n) => {
    if (n.type !== 'container') return;
    const dsk = n.desktop || {};
    if (dsk.display === 'grid' && dsk.justifyContent === 'space-between') {
      errors.push({ rule: 'R13', where: `container(${n.componentName || '?'})`, msg: `desktop.display:"grid" with justifyContent:"space-between" — grids distribute automatically via gridColumnsCount; use "normal" (or omit).` });
    }
  });

  // ---------- R14 : Soft-shadow byte-exactness ----------
  // Any container with a non-zero shadow must use the canonical soft shadow, not solid #000000.
  const CANONICAL_SHADOW = { offsetX: 0, offsetY: 2, blurRadius: 8, spreadRadius: 2, color: 'rgba(0,0,0,0.05)' };
  walk(markup.components, (n) => {
    if (n.type !== 'container') return;
    const sh = (n.desktop || {}).shadow;
    if (!sh || !sh.blurRadius || sh.blurRadius <= 0) return;
    const problems = [];
    if (sh.color !== CANONICAL_SHADOW.color) problems.push(`color=${JSON.stringify(sh.color)} (want "rgba(0,0,0,0.05)")`);
    if (sh.offsetY !== CANONICAL_SHADOW.offsetY) problems.push(`offsetY=${sh.offsetY} (want 2)`);
    if (sh.blurRadius !== CANONICAL_SHADOW.blurRadius) problems.push(`blurRadius=${sh.blurRadius} (want 8)`);
    if (sh.spreadRadius !== CANONICAL_SHADOW.spreadRadius) problems.push(`spreadRadius=${sh.spreadRadius} (want 2)`);
    if (problems.length) {
      errors.push({ rule: 'R14', where: `container(${n.componentName || '?'})`, msg: `non-canonical shadow — ${problems.join(', ')}. The canonical soft shadow is {offsetX:0, offsetY:2, blurRadius:8, spreadRadius:2, color:"rgba(0,0,0,0.05)"}` });
    }
  });

  // ---------- R15 : pageShell canonical padding ----------
  // Any container with bg #fafafa (the grey outer shell) must have stylingBox padding "20" all sides.
  walk(markup.components, (n) => {
    if (n.type !== 'container') return;
    const dsk = n.desktop || {};
    const bg = (dsk.background || {}).color;
    if (bg !== '#fafafa') return;
    let sb;
    try { sb = typeof dsk.stylingBox === 'string' ? JSON.parse(dsk.stylingBox || '{}') : (dsk.stylingBox || {}); }
    catch (e) {
      errors.push({ rule: 'R15', where: `container(${n.componentName || '?'})`, msg: `pageShell stylingBox is not valid JSON: ${dsk.stylingBox}` });
      return;
    }
    const want = ['paddingTop','paddingRight','paddingBottom','paddingLeft'];
    const missing = want.filter(k => sb[k] !== '20');
    if (missing.length) {
      errors.push({ rule: 'R15', where: `container(${n.componentName || '?'})`, msg: `pageShell (bg #fafafa) requires stylingBox padding "20" on all four sides — off/missing on: ${missing.join(', ')}. Current stylingBox: ${dsk.stylingBox}` });
    }
  });

  // ---------- R16 : deprecated `columns` component ----------
  // WARN only — the canonical seeds never use `columns`; flex/grid containers are the pattern.
  walk(markup.components, (n) => {
    if (n.type === 'columns') {
      warnings.push({ rule: 'R16', where: `columns(${n.componentName || '?'})`, msg: `deprecated 'columns' component — canonical seeds use flex/grid containers instead. Refactor to a flex or grid container with children sized via desktop.dimensions.width.` });
    }
  });

  // ---------- Report ----------
  const total = errors.length + warnings.length;
  if (total === 0) {
    console.log('✓ validate-form-markup: 0 issues');
    process.exit(0);
  }
  if (errors.length) {
    console.error(`\nBLOCK-PUSH violations (${errors.length}):`);
    for (const e of errors) console.error(`  [${e.rule}] ${e.where}: ${e.msg}`);
  }
  if (warnings.length) {
    console.error(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.error(`  [${w.rule}] ${w.where}: ${w.msg}`);
  }
  if (errors.length) {
    console.error('\nDO NOT push. Fix the BLOCK-PUSH violations above, then re-run.');
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) main();
