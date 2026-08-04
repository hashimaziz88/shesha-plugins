/**
 * The offline gate chain behind `shesha check`.
 *
 * Five gates in order: structural -> round-trip -> rules -> bindings -> dead-channel.
 * ALL of them run and ALL failures are reported together. Stopping at the first failure
 * turns one fix-and-rerun cycle into N, which is how a gate becomes something people
 * route around.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: judge whether the form looks styled. That is a
 * rendered gate (Phase 6, lib/anatomy.mjs). The previous stack's offline styledness
 * validator counted emitted style blocks and passed a form at 96% that the critic called
 * nearly unstyled, because seven of its nine style blocks were inert. Counting markup is
 * not measuring appearance, and `check` does not claim otherwise.
 */
import { allComponents, styleBlocks } from './walk.mjs';
import { runRules } from './rules.mjs';

/** IFormSettingsCommon requires these; the renderer assumes them. */
const REQUIRED_FORM_SETTINGS = ['layout', 'colon', 'labelCol', 'wrapperCol'];

/**
 * Fields confirmed deprecated in the 0.45 typings. NOTE the absentee:
 * `stylingBox` is NOT here. The brief called it deprecated in favour of
 * `stylingBoxJson`, but stylingBoxJson has zero occurrences in the 0.45 typings AND zero
 * in the runtime bundle — stylingBox (a stringified JSON string) is the live key, and the
 * shipped PBF form uses it. Flagging it would have pushed authors onto a channel that
 * does not exist.
 */
const DEPRECATED_FIELDS = {
  customVisibility: 'use code-mode `hidden` instead',
  customEnabled: 'use code-mode `disabled`/`editMode` instead',
  allStyles: 'deprecated in 0.45; use the desktop/tablet/mobile blocks',
  permissions: 'use `visiblePermissions` / `editModePermissions` on components',
};

/** Top-level style channels a breakpoint block may carry. */
const STYLE_CHANNELS = ['border', 'background', 'font', 'shadow', 'dimensions', 'size', 'overflow'];

function violation(gate, message, { severity = 'fail', fixPointer = null, ruleId = null } = {}) {
  return { gate, severity, message, fixPointer, ruleId };
}

/**
 * Accept either a raw markup document or an UpdateMarkup-shaped wrapper, because `markup`
 * in the DTO is a STRINGIFIED blob of {formSettings, components} — double-encoded relative
 * to the entity. A file fetched from the API looks different from one we authored.
 */
export function normaliseMarkup(raw) {
  const notes = [];
  let doc = raw;

  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc.charCodeAt(0) === 0xfeff ? doc.slice(1) : doc);
      notes.push('input was a JSON string; parsed one level');
    } catch (e) {
      return { doc: null, notes, error: `not valid JSON: ${(e && e.message) || e}` };
    }
  }
  if (!doc || typeof doc !== 'object') {
    return { doc: null, notes, error: 'top level is not an object' };
  }

  // Wrapper shapes: {markup: "<stringified>"} or {result: {markup: ...}}
  if (doc.result && typeof doc.result === 'object' && doc.result.markup !== undefined) {
    doc = doc.result;
    notes.push('unwrapped an ABP {result} envelope');
  }
  if (typeof doc.markup === 'string') {
    try {
      doc = JSON.parse(doc.markup);
      notes.push('unwrapped a stringified `markup` blob (the UpdateMarkup DTO shape)');
    } catch (e) {
      return { doc: null, notes, error: `the \`markup\` field is not valid JSON: ${(e && e.message) || e}` };
    }
  } else if (doc.markup && typeof doc.markup === 'object') {
    doc = doc.markup;
    notes.push('unwrapped an object `markup` field');
  }

  return { doc, notes, error: null };
}

// ---------------------------------------------------------------------------- gate 1
export function gateStructural(markup, ctx) {
  const out = [];

  if (!Array.isArray(markup.components)) {
    out.push(violation('structural', 'components is not an array — this is not a form markup document', { fixPointer: 'components' }));
    return out; // nothing further is meaningful
  }
  if (!markup.formSettings || typeof markup.formSettings !== 'object') {
    out.push(violation('structural', 'formSettings is missing', { fixPointer: 'formSettings' }));
  } else {
    for (const key of REQUIRED_FORM_SETTINGS) {
      if (markup.formSettings[key] === undefined) {
        out.push(
          violation('structural', `formSettings.${key} is missing — the renderer assumes it`, {
            severity: 'warn',
            fixPointer: `formSettings/${key}`,
          })
        );
      }
    }
  }

  const comps = allComponents(markup);
  if (comps.length === 0) {
    out.push(violation('structural', 'the form has no components', { fixPointer: 'components' }));
  }

  for (const { node, path } of comps) {
    if (typeof node.type !== 'string' || !node.type) {
      out.push(violation('structural', 'a component has no `type`', { fixPointer: `${path}/type` }));
    }
    if (typeof node.id !== 'string' || !node.id) {
      out.push(violation('structural', `${node.type || 'a component'} has no \`id\``, { fixPointer: `${path}/id` }));
    }
    for (const [field, advice] of Object.entries(DEPRECATED_FIELDS)) {
      if (node[field] !== undefined && node[field] !== null && node[field] !== '') {
        out.push(
          violation('structural', `${node.type} "${node.componentName || node.id}" carries deprecated \`${field}\` — ${advice}`, {
            severity: 'warn',
            fixPointer: `${path}/${field}`,
          })
        );
      }
    }
  }

  // Unknown types fail SOFT in the framework (upgradeComponents skips them, the renderer
  // shows a placeholder), so a typo yields a silently broken form unless caught here.
  if (ctx.registry) {
    for (const { node, path } of comps) {
      if (node.type && !ctx.registry[node.type]) {
        out.push(
          violation('structural', `unknown component type "${node.type}" — unregistered types fail soft, so this renders a placeholder with no error`, {
            fixPointer: `${path}/type`,
          })
        );
      }
    }
  } else {
    out.push(
      violation('structural', 'no derived registry available, so component types were not validated — run `probe --app <path>` first', {
        severity: 'warn',
      })
    );
  }

  return out;
}

// ---------------------------------------------------------------------------- gate 2
/**
 * Compare the framework's own normalisation against the input.
 *
 * Two classes of difference are EXPECTED and are not failures:
 *   - parentId, which componentsTreeToFlatStructure recomputes
 *   - version, which upgradeComponents bumps when the input is stale (R-003 owns that)
 * Anything else means the framework rewrote or dropped something.
 */
export function gateRoundTrip(markup, roundTripResult) {
  const out = [];
  if (!roundTripResult) {
    return [
      violation('round-trip', 'skipped — pass --app so the framework\'s own tree/flat/upgrade cycle can run', {
        severity: 'warn',
      }),
    ];
  }
  if (roundTripResult.error) {
    return [violation('round-trip', `the framework could not process this markup: ${roundTripResult.error}`)];
  }
  if (roundTripResult.upgradeError) {
    out.push(violation('round-trip', `upgradeComponents threw: ${roundTripResult.upgradeError}`));
  }

  const before = allComponents(markup);
  const after = allComponents({ components: roundTripResult.tree || [] });

  if (after.length !== before.length) {
    out.push(
      violation(
        'round-trip',
        `the framework's own round-trip changed the component count from ${before.length} to ${after.length} — components were dropped or their ids collided (the flat structure is keyed by id)`
      )
    );
  }

  const flatIds = new Set(roundTripResult.flatIds || []);
  if (flatIds.size && flatIds.size !== before.length) {
    out.push(
      violation(
        'round-trip',
        `the flat structure holds ${flatIds.size} components but the tree has ${before.length} — duplicate ids silently overwrite each other`
      )
    );
  }
  for (const { node } of before) {
    if (flatIds.size && node.id && !flatIds.has(node.id)) {
      out.push(
        violation('round-trip', `${node.type} "${node.componentName || node.id}" (id ${node.id}) did not survive flattening`)
      );
    }
  }

  /**
   * Field-level rewrites.
   *
   * A migration REWRITING fields is the whole point of a migration, so a component whose
   * stored version is behind the framework will legitimately come back changed. Reporting
   * those as surprises buried the signal: the shipped PBF form produced 23 such warnings,
   * every one of them just "this component is stale", which R-003 already says once per
   * component. So the field diff only runs where the version was ALREADY current — there,
   * a rewrite is genuinely unexpected and worth a human's attention.
   */
  const byId = new Map(after.map((h) => [h.node.id, h.node]));
  const migrated = [];
  for (const { node, path } of before) {
    const post = byId.get(node.id);
    if (!post) continue;

    const wasCurrent = node.version !== undefined && post.version !== undefined && node.version === post.version;
    if (!wasCurrent) {
      migrated.push(`${node.componentName || node.type} ${node.version ?? '(none)'}→${post.version ?? '?'}`);
      continue;
    }

    for (const key of Object.keys(node)) {
      if (key === 'parentId' || key === 'version') continue;
      if (['components', 'items', 'content', 'header', 'customHeader', 'footer', 'columns', 'tabs', 'steps', 'panels'].includes(key)) continue;
      const a = JSON.stringify(node[key]);
      const b = JSON.stringify(post[key]);
      if (a !== b) {
        out.push(
          violation(
            'round-trip',
            `the framework rewrote ${node.type} "${node.componentName || node.id}" ${key} even though its version was already current — the authored value is not what will render`,
            { severity: 'warn', fixPointer: `${path}/${key}` }
          )
        );
      }
    }
  }

  if (migrated.length) {
    out.push(
      violation(
        'round-trip',
        `${migrated.length} component(s) were migrated by the framework, so their fields were rewritten as expected: ${migrated.slice(0, 8).join(', ')}${migrated.length > 8 ? `, +${migrated.length - 8} more` : ''}. R-003 reports each stale version individually; field diffs are suppressed for these because a migration rewriting fields is not a defect.`,
        { severity: 'warn' }
      )
    );
  }

  return out;
}

// ---------------------------------------------------------------------------- gate 3
export function gateRules(markup, ctx) {
  const res = runRules(markup, ctx);
  return {
    violations: res.violations.map((v) =>
      violation('rules', v.message, { severity: v.severity, fixPointer: v.fixPointer, ruleId: v.ruleId })
    ),
    ran: res.ran,
    skipped: res.skipped,
  };
}

// ---------------------------------------------------------------------------- gate 4
/**
 * Bindings are mostly enforced by R-004/R-015/R-016/R-034, which need live metadata. This
 * gate exists to make the ABSENCE of that metadata loud: a binding check that silently
 * did not run looks exactly like a binding check that passed, and bindings — not styling —
 * are the dominant interactive failure.
 */
export function gateBindings(markup, ctx, ruleSkips) {
  const out = [];
  const bindingRules = ['R-004', 'R-015', 'R-016', 'R-034', 'R-037'];
  const skippedBinding = (ruleSkips || []).filter((s) => bindingRules.includes(s.ruleId));

  if (!ctx.modelProperties) {
    const bound = allComponents(markup).filter(({ node }) => typeof node.propertyName === 'string' && node.propertyName);
    out.push(
      violation(
        'bindings',
        `${bound.length} bound propert${bound.length === 1 ? 'y' : 'ies'} could NOT be verified against live metadata` +
          (ctx.modelTypeName ? ` for ${ctx.modelTypeName}` : ' (no modelType resolved)') +
          ` — ${skippedBinding.length} binding rule(s) skipped. Run \`probe --app <path>\` against a reachable backend to close this gap.`,
        { severity: 'warn' }
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------- gate 5
/**
 * Dead-channel detection, honestly scoped.
 *
 * The previous stack answered this with a 586 KB measured-capability-matrix built from 150
 * gym forms and a browser. This rebuild deliberately does not carry that asset, so the
 * full check is NOT available offline — R-053 is dispositioned compile-time for exactly
 * that reason, and the kit simply never generates a dead prop.
 *
 * What IS derivable is narrower but real: a component authoring a style channel that its
 * own settingsFormMarkup does not expose. That is a signal from the framework rather than
 * from a measurement corpus, so it is reported as a warning and labelled as narrow.
 */
export function gateDeadChannel(markup, ctx) {
  const out = [];
  if (!ctx.registry) {
    return [violation('dead-channel', 'skipped — needs the derived registry', { severity: 'warn' })];
  }

  for (const { node, path } of allComponents(markup)) {
    const def = ctx.registry[node.type];
    if (!def || !def.settings || def.settings.source === 'absent') continue;
    const names = def.settings.propertyNames || [];
    if (names.length === 0) continue;
    const exposes = (channel) => names.some((n) => n.toLowerCase().includes(channel.toLowerCase()));

    for (const { breakpoint, block } of styleBlocks(node)) {
      for (const channel of STYLE_CHANNELS) {
        if (block[channel] === undefined || block[channel] === null) continue;
        if (!exposes(channel)) {
          out.push(
            violation(
              'dead-channel',
              `${node.type} "${node.componentName || node.id}" authors ${breakpoint}.${channel}, but this component's own settings form exposes no ${channel} property — likely a no-op. (Narrow check: derived from settingsFormMarkup, not from a measured render.)`,
              { severity: 'warn', fixPointer: `${path}/${breakpoint}/${channel}`, ruleId: 'R-053' }
            )
          );
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- runner
/**
 * Run every gate and return one consolidated report.
 * `roundTripResult` is optional; without it the round-trip gate degrades to a warning
 * rather than silently passing.
 */
export function runGates(markup, ctx = {}, roundTripResult = null) {
  const structural = gateStructural(markup, ctx);

  // If the document is not structurally a form, the remaining gates would produce noise
  // about a shape that does not exist.
  const fatalShape = structural.some((v) => v.severity === 'fail' && /not an array|no components/.test(v.message));

  const rules = fatalShape ? { violations: [], ran: [], skipped: [] } : gateRules(markup, ctx);
  const roundTrip = fatalShape ? [] : gateRoundTrip(markup, roundTripResult);
  const bindings = fatalShape ? [] : gateBindings(markup, ctx, rules.skipped);
  const dead = fatalShape ? [] : gateDeadChannel(markup, ctx);

  const all = [...structural, ...roundTrip, ...rules.violations, ...bindings, ...dead];
  const failures = all.filter((v) => v.severity === 'fail');
  const warnings = all.filter((v) => v.severity === 'warn');

  return {
    ok: failures.length === 0,
    counts: {
      total: all.length,
      failures: failures.length,
      warnings: warnings.length,
      byGate: all.reduce((acc, v) => {
        acc[v.gate] = (acc[v.gate] || 0) + 1;
        return acc;
      }, {}),
    },
    violations: all,
    failures,
    warnings,
    rulesRan: rules.ran,
    rulesSkipped: rules.skipped,
    // Named explicitly so nobody reads a pass here as "this form looks right".
    notChecked: [
      'styled-ness and brand fidelity (rendered gate, Phase 6 lib/anatomy.mjs)',
      'layout anatomy (rendered gate, Phase 6)',
      'the full measured dead-channel matrix (see gate 5 — narrow derived substitute only)',
    ],
  };
}
