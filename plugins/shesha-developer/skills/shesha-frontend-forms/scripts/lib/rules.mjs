/**
 * The rule registry and runner.
 *
 * A rule is `{ id, group, severity, statement, applies(ctx), check(markup, ctx) }`
 * returning an array of violations `{ ruleId, message, fixPointer, severity }`.
 *
 * DESIGN NOTE — one file per rule vs the file ceiling.
 * The brief asks for scripts/rules/R-0xx.mjs, one file per rule. Triaging the 57 ported
 * rules yields ~35 enforceable ones; at one file each, plus the artefacts Phases 3-11
 * still need, the total lands near 65 files against a hard ceiling of 55. Validators are
 * therefore grouped into domain modules. Every rule id still resolves to exactly one
 * check() and one MANIFEST row, which is the contract that matters; only the file
 * granularity differs. This is a recorded deviation, not an oversight.
 *
 * Rules never hold facts. Versions, container slots and valid types come from
 * ground-truth.json via ctx; a rule that needs a fact it cannot get from ctx must
 * degrade to a skip with a reason, never guess.
 */
import * as actions from '../rules/actions.mjs';
import * as binding from '../rules/binding.mjs';
import * as data from '../rules/data.mjs';
import * as scripts from '../rules/scripts.mjs';
import * as security from '../rules/security.mjs';
import * as structure from '../rules/structure.mjs';
import * as styling from '../rules/styling.mjs';
import * as versioning from '../rules/versioning.mjs';

const MODULES = { structure, binding, data, actions, scripts, styling, security, versioning };

/**
 * The full triage of all 57 ported rules.
 *
 * disposition:
 *   enforceable  - a check() in scripts/rules/<group>.mjs
 *   derivable    - the framework or the live backend now tells us; the prose is deleted
 *                  and the fact is read from ground-truth.json instead
 *   compile-time - the compiler or the mirror kit makes the violation unrepresentable
 *   stale        - deleted, with a reason
 *
 * `movedTo` records where a deleted rule's useful residue lives now, so nothing of value
 * is lost by a deletion.
 */
export const TRIAGE = [
  // ---- structure ----------------------------------------------------------------
  { id: 'R-001', group: 'structure', disposition: 'enforceable', note: 'also guaranteed by the compiler, but check() gates fetched and hand-edited files too' },
  { id: 'R-002', group: 'structure', disposition: 'enforceable', note: 'extended beyond the original: also asserts id uniqueness, because the flat structure is keyed by id and duplicates silently overwrite' },
  { id: 'R-006', group: 'structure', disposition: 'enforceable' },
  { id: 'R-009', group: 'structure', disposition: 'enforceable' },
  { id: 'R-018', group: 'structure', disposition: 'enforceable', note: 'the "never blanket-stamp" prose is judgment and was dropped; the checkable half survives — editMode "inherited" on a form that cannot enter edit mode renders blank' },
  { id: 'R-020', group: 'structure', disposition: 'compile-time', note: 'the compiler emits exactly the floor from the archetype; "padding is a defect" is judgment, not a markup invariant' },
  { id: 'R-021', group: 'structure', disposition: 'enforceable' },
  { id: 'R-025', group: 'structure', disposition: 'enforceable', note: 'requires --baseline; skips with a reason without one' },
  { id: 'R-031', group: 'structure', disposition: 'enforceable' },

  // ---- versioning ---------------------------------------------------------------
  { id: 'R-003', group: 'versioning', disposition: 'enforceable', note: 'the RULE survives; its DATA source is now derived — versions come from migrator.lastVersion in ground truth, not from a hand-maintained KB' },
  { id: 'R-049', group: 'versioning', disposition: 'derivable', note: 'versions drift per release, so probe derives them per app from the installed package. The KB/_index.json and the live-form harvesting apparatus are both obsolete.' },

  // ---- binding ------------------------------------------------------------------
  { id: 'R-004', group: 'binding', disposition: 'enforceable' },
  { id: 'R-014', group: 'binding', disposition: 'enforceable' },
  { id: 'R-015', group: 'binding', disposition: 'enforceable', note: 'needs live metadata in ctx; skips with a reason without it' },
  { id: 'R-016', group: 'binding', disposition: 'enforceable' },
  { id: 'R-034', group: 'binding', disposition: 'enforceable', note: 'needs live metadata in ctx' },
  { id: 'R-035', group: 'binding', disposition: 'stale', reason: 'HTML-escaping of {{ }} is renderer behaviour with no markup invariant to assert — a double brace is correct far more often than not.', movedTo: 'explain --symptom (escaped output)' },

  // ---- data ---------------------------------------------------------------------
  { id: 'R-005', group: 'data', disposition: 'enforceable' },
  { id: 'R-010', group: 'data', disposition: 'enforceable' },
  { id: 'R-011', group: 'data', disposition: 'enforceable' },
  { id: 'R-017', group: 'data', disposition: 'enforceable' },
  { id: 'R-037', group: 'data', disposition: 'enforceable', note: 'needs live metadata to know which properties are FK objects; warns without it rather than guessing' },
  { id: 'R-039', group: 'data', disposition: 'enforceable', note: 'narrowed to the checkable half: a non-empty formSettings.onInitialized is dead on a dynamic page' },
  { id: 'R-045', group: 'data', disposition: 'stale', reason: 'Its own note concedes it is not mechanically checkable — which FKs are contextually preset is a property of the CALLING screen, not this form. R-037 covers the checkable half.', movedTo: 'R-037' },

  // ---- actions ------------------------------------------------------------------
  { id: 'R-007', group: 'actions', disposition: 'enforceable' },
  { id: 'R-008', group: 'actions', disposition: 'enforceable' },
  { id: 'R-043', group: 'actions', disposition: 'compile-time', note: 'canonical CRUD wiring is what the compiler emits per archetype; the catalogue of shapes belongs in recipes.md' },
  { id: 'R-044', group: 'actions', disposition: 'enforceable' },

  // ---- scripts ------------------------------------------------------------------
  { id: 'R-012', group: 'scripts', disposition: 'enforceable' },
  { id: 'R-013', group: 'scripts', disposition: 'enforceable' },
  { id: 'R-023', group: 'scripts', disposition: 'enforceable' },
  { id: 'R-024', group: 'scripts', disposition: 'enforceable' },
  { id: 'R-038', group: 'scripts', disposition: 'enforceable', note: 'narrowed to the checkable half: http.get carrying a params object, whose params the framework drops' },

  // ---- styling ------------------------------------------------------------------
  { id: 'R-028', group: 'styling', disposition: 'enforceable', note: 'the mirror kit excludes `columns` entirely, but check() must still catch it in foreign files' },
  { id: 'R-029', group: 'styling', disposition: 'enforceable' },
  { id: 'R-030', group: 'styling', disposition: 'enforceable', note: 'narrowed to the checkable half: a truthy legacy `style` JS-string, which renders inline and wins over every breakpoint block' },
  { id: 'R-032', group: 'styling', disposition: 'stale', reason: 'The two-div rule is runtime physics, not a markup invariant — there is no authored value that is right or wrong, only a diagnosis when a header squeezes.', movedTo: 'explain --symptom (squeezed header)' },
  { id: 'R-033', group: 'styling', disposition: 'enforceable', note: 'field-level labelCol is a dead channel; authoring one is a defect by R-053 reasoning' },
  { id: 'R-036', group: 'styling', disposition: 'enforceable', note: 'now backed by live data: this app has 0 of 26 reflist items carrying a colour, so refListStatus renders grey here' },
  { id: 'R-042', group: 'styling', disposition: 'enforceable', note: 'DEFERRED TO PHASE 6 and owned by anatomy.mjs. Styledness cannot be judged offline — that is precisely how the old offline gate PASSed a form at 96% that the critic called nearly unstyled.' },
  { id: 'R-048', group: 'styling', disposition: 'stale', reason: 'A datalist row-template recipe, not an invariant.', movedTo: 'references/recipes.md' },
  { id: 'R-051', group: 'styling', disposition: 'derivable', note: 'MEASURED this session: the live Shesha.ThemeSettings carries application/sidebar/layoutBackground/text/sidebarBackground/labelSpan/componentSpan/marginPadding. No token, no components. Read it from ground-truth.backend.themeTopLevelKeys.' },
  { id: 'R-052', group: 'styling', disposition: 'enforceable' },
  { id: 'R-053', group: 'styling', disposition: 'compile-time', note: 'GAP: enforced by construction (the kit does not generate a dead prop), but NOT checkable offline for foreign files — that needed the 586KB measured-capability-matrix, which this rebuild deliberately does not carry. Recorded in ground-truth.gaps.' },
  { id: 'R-054', group: 'styling', disposition: 'enforceable' },
  { id: 'R-055', group: 'styling', disposition: 'enforceable' },
  { id: 'R-057', group: 'styling', disposition: 'enforceable' },

  // ---- security -----------------------------------------------------------------
  { id: 'R-022', group: 'security', disposition: 'enforceable' },
  { id: 'R-041', group: 'security', disposition: 'enforceable' },

  // ---- api / process ------------------------------------------------------------
  { id: 'R-026', group: 'api', disposition: 'derivable', note: 'DERIVED this session from the app\'s own per-service swagger — and the rule was WRONG: TokenAuth is at /api/TokenAuth/, not /api/services/app/, and there is no ReferenceList service at all in 0.45.' },
  { id: 'R-027', group: 'api', disposition: 'compile-time', note: 'one BOM-free read/write idiom in lib/api.mjs; nothing in the toolchain can emit a BOM, so there is nothing left to assert' },
  { id: 'R-019', group: 'process', disposition: 'stale', reason: 'Routing guidance (list vs table), not a markup invariant.', movedTo: 'references/recipes.md + AskUserQuestion when ambiguous' },
  { id: 'R-040', group: 'process', disposition: 'stale', reason: 'Backend build/boot sequencing is outside this skill\'s scope, which is form JSON plus the app theme.', movedTo: 'SKILL.md preflight' },
  { id: 'R-046', group: 'process', disposition: 'enforceable', note: 'DEFERRED TO PHASE 5: the ledger Stop hook, not an offline markup check' },
  { id: 'R-047', group: 'process', disposition: 'compile-time', note: 'push is the only write path and always re-fetches and diffs; a pushed-but-unverified state is unrepresentable' },
  { id: 'R-050', group: 'process', disposition: 'stale', reason: 'There are no large goldens in this architecture — ground truth plus the mirror kit replace the 1.4MB exemplar corpus, so there is nothing large to avoid reading.' },
  { id: 'R-056', group: 'process', disposition: 'compile-time', note: 'DEFERRED TO PHASE 6: render clears the form/form_lookup IndexedDB stores as part of its own boot, so measuring a ghost is unrepresentable' },
];

/** Every rule implementation, flattened from the domain modules. */
export function loadRules() {
  const out = [];
  for (const [group, mod] of Object.entries(MODULES)) {
    for (const rule of Object.values(mod.rules || {})) {
      out.push({ ...rule, group: rule.group || group });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Triage rows whose disposition is `enforceable`, i.e. those that must have a check(). */
export function enforceableIds() {
  return TRIAGE.filter((t) => t.disposition === 'enforceable').map((t) => t.id);
}

/**
 * Run every applicable rule. Returns ALL violations, never just the first — a report
 * that stops at the first failure turns one fix-and-rerun cycle into N.
 */
export function runRules(markup, ctx = {}) {
  const rules = loadRules();
  const violations = [];
  const skipped = [];
  const ran = [];

  for (const rule of rules) {
    let applicable = true;
    let skipReason = null;
    if (typeof rule.applies === 'function') {
      const r = rule.applies(ctx, markup);
      if (r === false) {
        applicable = false;
        skipReason = 'not applicable to this form';
      } else if (r && typeof r === 'object' && r.skip) {
        applicable = false;
        skipReason = r.reason || 'skipped';
      }
    }
    if (!applicable) {
      skipped.push({ ruleId: rule.id, reason: skipReason });
      continue;
    }
    ran.push(rule.id);
    let found;
    try {
      found = rule.check(markup, ctx) || [];
    } catch (e) {
      // A rule that throws is a bug in the rule, and must be visible as such rather than
      // silently reducing coverage.
      violations.push({
        ruleId: rule.id,
        severity: 'fail',
        message: `rule threw while checking: ${(e && e.message) || e}`,
        fixPointer: null,
        ruleError: true,
      });
      continue;
    }
    for (const v of found) {
      violations.push({
        ruleId: rule.id,
        severity: v.severity || rule.severity || 'fail',
        message: v.message,
        fixPointer: v.fixPointer || null,
      });
    }
  }

  return {
    violations,
    failures: violations.filter((v) => v.severity === 'fail'),
    warnings: violations.filter((v) => v.severity === 'warn'),
    ran,
    skipped,
  };
}

/**
 * Generate rules/MANIFEST.md. Generated, never hand-written — a hand-written manifest is
 * a second place for the triage to drift.
 */
export function renderManifest() {
  const impls = new Map(loadRules().map((r) => [r.id, r]));
  const byDisposition = { enforceable: [], derivable: [], 'compile-time': [], stale: [] };
  for (const t of TRIAGE) byDisposition[t.disposition].push(t);

  const counts = Object.fromEntries(Object.entries(byDisposition).map(([k, v]) => [k, v.length]));

  const lines = [];
  lines.push('# Rule manifest');
  lines.push('');
  lines.push('<!-- GENERATED by scripts/lib/rules.mjs via `shesha explain --manifest`. Do not edit. -->');
  lines.push('');
  lines.push(
    `All ${TRIAGE.length} rules ported from the previous stack, each dispositioned. ` +
      'Ported as ideas and re-derived, never copied.'
  );
  lines.push('');
  lines.push(
    `**enforceable ${counts.enforceable} · derivable ${counts.derivable} · ` +
      `compile-time ${counts['compile-time']} · stale ${counts.stale}**`
  );
  lines.push('');
  lines.push('| id | group | disposition | validator | note |');
  lines.push('|---|---|---|---|---|');
  for (const t of [...TRIAGE].sort((a, b) => a.id.localeCompare(b.id))) {
    const impl = impls.get(t.id);
    let validator = '—';
    if (t.disposition === 'enforceable') {
      validator = impl ? `\`scripts/rules/${t.group === 'process' ? 'structure' : t.group}.mjs\`` : '**MISSING**';
    }
    const note = (t.reason ? `_stale:_ ${t.reason}` : t.note || '') + (t.movedTo ? ` → \`${t.movedTo}\`` : '');
    lines.push(`| ${t.id} | ${t.group} | ${t.disposition} | ${validator} | ${note.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Implementations with no triage row');
  const orphans = [...impls.keys()].filter((id) => !TRIAGE.some((t) => t.id === id));
  lines.push(orphans.length ? orphans.map((o) => `- ${o}`).join('\n') : '_none_');
  lines.push('');
  lines.push('## Enforceable rows with no implementation');
  const missing = byDisposition.enforceable.filter((t) => !impls.has(t.id)).map((t) => t.id);
  lines.push(missing.length ? missing.map((m) => `- ${m}`).join('\n') : '_none_');
  lines.push('');
  return lines.join('\n');
}
