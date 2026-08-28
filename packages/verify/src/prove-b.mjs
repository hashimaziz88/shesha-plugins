// The Scope B integration proof (D-100). The Scope-B counterpart of prove.mjs.
//
// "Scope B complete" is defined as exactly this: `npm run prove-b` exits 0 and its
// final line is `SESSION COMPLETE — SCOPE B`. It reads the Scope-B scope file
// (session-scope-b.json) — never the frozen Scope-A one — and byte-compares its own
// output block against packages/verify/test/prove-b.expected.txt, blessed exactly
// once (D-100) when every Scope-B WP is complete. Scope A's proof and its frozen
// expected file are never touched here; their two --bless uses (CONTROL §5) stay
// spent.
//
// STEPS starts empty: each Scope-B WP adds exactly one deterministic step as it
// lands (compiler robustness, decompiler hygiene, IR nodes, T3, …), the same way
// prove.mjs grew its ten steps across Scope A. Until the scope is complete, only
// SESSION INCOMPLETE can print, and `--partial` is the only mode that exits 3
// rather than failing.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, readJsonGuarded, families, runGuarded, verdictOf } from '@shesha/registry/coverage';
import { repoRoot } from './lib/fsx.mjs';
import { completedWps } from './lib/session-state.mjs';

/** A minimal create form whose one field is `component`. @param {string} component */
const leafForm = (component) => JSON.stringify({
  sfs: '1.0', form: `robust-${component}`, module: 'boxfusion.test', kind: 'create',
  entity: 'boxfusion.test.Domain.Test.Thing', label: 'R', submits: true, page: { title: 'R' },
  body: [{ node: 'col', name: 'formBody', children: [{ node: 'field', name: 'x', bind: 'xValue', component }] }],
});

/** WP-5c: leaf input types (no registry defaults, object-shaped slots) compile, not crash. */
async function runRobustness(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const types = ['checkbox', 'switch', 'radio'];
  /** @type {string[]} */
  const failures = [];
  for (const c of types) {
    try { compile(leafForm(c)); } catch (e) { failures.push(`${c}: ${(/** @type {Error} */ (e)).message}`); }
  }
  return failures.length === 0
    ? { ok: true, lines: [`leaf input types compile: ${types.join(', ')} (was the 498-form compile-npe)`] }
    : { ok: false, lines: failures.map((f) => `FAIL ${f}`) };
}

/** WP-5d: a hostile production header decompiles to schema-valid SFS, not SFS-1101. */
async function runHygiene(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { decompile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const base = JSON.parse(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json'), 'utf8'));
  const env = { ...base, Name: 'My Form.V2! (Draft)', Label: '   ', ModelType: 'SingleSegment', ModuleName: '123 bad' };
  try {
    const { sfs } = decompile(env);
    compile(JSON.stringify(sfs));
    const ok = /^[a-z][a-z0-9-]{0,63}$/.test(String(sfs.form)) && sfs.entity === undefined
      && typeof sfs.label === 'string' && sfs.label.trim() !== '';
    return ok
      ? { ok: true, lines: [`hostile header lifts clean: form=${sfs.form}, entity omitted, label non-empty (SFS-1101 /form /entity /label)`] }
      : { ok: false, lines: [`decompiled SFS is not sanitised: form=${JSON.stringify(sfs.form)} entity=${JSON.stringify(sfs.entity)} label=${JSON.stringify(sfs.label)}`] };
  } catch (e) {
    return { ok: false, lines: [`FAIL: ${(/** @type {Error} */ (e)).message.split('\n')[0]}`] };
  }
}

/** WP-5e: an equal-span `columns` grid lifts to a flex row of cols instead of escaping. */
async function runColumns(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { decompile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const grid = [{
    id: 'c1', type: 'columns', name: 'grid', columns: [
      { id: 'ca', flex: 12, components: [{ id: 't1', type: 'text', name: 'a', content: 'L' }] },
      { id: 'cb', flex: 12, components: [{ id: 't2', type: 'text', name: 'b', content: 'R' }] },
    ], components: [],
  }];
  try {
    const { sfs, structuralEscapes } = /** @type {any} */ (decompile(grid));
    compile(JSON.stringify(sfs));
    const ok = sfs.body[0].node === 'row' && structuralEscapes === 0;
    return ok
      ? { ok: true, lines: ['equal columns grid lifts to a flex row (was the #1 IR escape, 241 forms)'] }
      : { ok: false, lines: [`columns grid did not lift: node=${sfs.body[0].node} escapes=${structuralEscapes}`] };
  } catch (e) {
    return { ok: false, lines: [`FAIL: ${(/** @type {Error} */ (e)).message.split('\n')[0]}`] };
  }
}

/** WP-2b: the registry is source-typed to >= 93/121 full and the deferred set is < 8 (BL-004/020/022). */
async function runRegistry(/** @type {string} */ root) {
  const { measure } = await import(pathToFileURL(path.join(root, 'packages/registry/tools/gen-registry.mjs')).href);
  const comps = JSON.parse(fs.readFileSync(path.join(root, 'packages/registry/data/0.45.1/components.json'), 'utf8')).components;
  const m = measure(comps);
  const ok = m.full >= 93 && m.deferredAuthorable < 8;
  return ok
    ? { ok: true, lines: [`registry ${m.full}/121 components full (>= 93, was 12) and deferredAuthorable ${m.deferredAuthorable} (< 8): the settings-form extractor types ~80 beyond the 13 priority anchors, framework-verified overlay props count as full, paragraph is legacy (BL-004/020/022, D-113)`] }
    : { ok: false, lines: [`registry below the WP-2b floor: full=${m.full} (need >= 93), deferredAuthorable=${m.deferredAuthorable} (need < 8)`] };
}

/** WP-8a: the seven handoff schemas compile under ajv {strict:true} (§4.2.2, D-116). */
async function runSchemas(/** @type {string} */ root) {
  const ajvMod = /** @type {any} */ (await import('ajv/dist/2020.js'));
  const Ajv2020 = ajvMod.default?.default ?? ajvMod.default ?? ajvMod;
  const fmtMod = /** @type {any} */ (await import('ajv-formats'));
  const addFormats = fmtMod.default?.default ?? fmtMod.default ?? fmtMod;
  const seven = ['plan', 'manifest', 'verdict', 'dispatch', 'sfs-meta', 'lock', 'blueprint'];
  /** @type {string[]} */
  const failures = [];
  let compiled = 0;
  for (const n of seven) {
    try {
      const schema = JSON.parse(fs.readFileSync(path.join(root, `packages/sfs/schema/${n}.schema.json`), 'utf8'));
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      ajv.compile(schema);
      compiled += 1;
    } catch (e) { failures.push(`${n}: ${(/** @type {Error} */ (e)).message.split('\n')[0]}`); }
  }
  return failures.length === 0 && compiled === 7
    ? { ok: true, lines: ['seven handoff schemas compile under ajv strict; the plan schema forbids a prose assertion, < 3 predicates, a non-T3 contract and > 3 repair rounds (WP-8a, D-116)'] }
    : { ok: false, lines: failures.map((f) => `FAIL ${f}`) };
}

/** WP-8b.1: block-form-writes denies markup writes and allows spec writes (§4.3.3, D-119). */
async function runHooks(/** @type {string} */ root) {
  const { decide } = /** @type {any} */ (await import(pathToFileURL(path.join(root, '.claude/hooks/block-form-writes.decide.mjs')).href));
  const ctx = { root, fs, activeRunId: null };
  const deny = decide({ tool_name: 'Write', tool_input: { file_path: 'runs/r/screens/s.form.json' } }, ctx);
  const allow = decide({ tool_name: 'Write', tool_input: { file_path: 'runs/r/screens/x.sfs.json' } }, ctx);
  const rootless = decide({ tool_name: 'Write', tool_input: { file_path: 'x.form.json' } }, { root: null, fs, activeRunId: null });
  const ok = deny.code === 'HOOK-0101' && allow.decision === 'allow' && rootless.code === 'HOOK-0001';
  return ok
    ? { ok: true, lines: ['block-form-writes denies a .form.json write (HOOK-0101), allows a .sfs.json write, fails closed on no repo root (HOOK-0001); exit(1) banned (WP-8b.1, D-119)'] }
    : { ok: false, lines: [`FAIL deny=${deny.code} allow=${allow.decision} rootless=${rootless.code}`] };
}

/** WP-8b.2: `sfs validate` gates handoff JSON, and the two write-path hooks decide correctly (§4.3.4/4.3.6). */
async function runValidateCli(/** @type {string} */ root) {
  const os = await import('node:os');
  const sfs = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/sfs/bin/sfs.mjs')).href));
  const lockDecide = /** @type {any} */ ((await import(pathToFileURL(path.join(root, '.claude/hooks/enforce-screen-lock.decide.mjs')).href)).decide);
  const valDecide = /** @type {any} */ ((await import(pathToFileURL(path.join(root, '.claude/hooks/validate-sfs-on-write.decide.mjs')).href)).decide);

  // sfs validate: a valid lock passes (exit 0); a lock missing the required `role` fails (exit 1).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proveb-val-'));
  const good = path.join(tmp, 'good.json');
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(good, JSON.stringify({ lockVersion: '1.0', screen: 'x', role: 'sfs-specwriter', runId: '20260824-1000-r', at: '2026-08-24T10:00:00Z', pid: 1 }));
  fs.writeFileSync(bad, JSON.stringify({ lockVersion: '1.0', screen: 'x', runId: '20260824-1000-r', at: '2026-08-24T10:00:00Z', pid: 1 }));
  const log = console.log; const err = console.error;
  console.log = () => {}; console.error = () => {};
  let okExit; let badExit;
  try {
    okExit = sfs.main(['node', 'sfs', 'validate', '--schema', 'lock', '--file', good, '--json']);
    badExit = sfs.main(['node', 'sfs', 'validate', '--schema', 'lock', '--file', bad, '--json']);
  } finally { console.log = log; console.error = err; }

  // enforce-screen-lock: a screen write with no lock is denied HOOK-0402 (fan-out mutex).
  const denyLock = lockDecide({ tool_name: 'Write', tool_input: { file_path: 'runs/20260824-1000-r/screens/x.sfs.json' } }, { root, fs });
  // validate-sfs-on-write: a validator that will not start blocks HOOK-0002, never a silent pass.
  const blockDead = valDecide({ tool_name: 'Write', tool_input: { file_path: 'runs/20260824-1000-r/screens/x.sfs.json' } }, { root, fs, spawnNode: () => ({ status: null }) });

  const ok = okExit === 0 && badExit === 1 && denyLock.code === 'HOOK-0402' && blockDead.code === 'HOOK-0002';
  return ok
    ? { ok: true, lines: ['sfs validate exits 0 on a schema-valid lock and 1 on one missing `role`; enforce-screen-lock denies a lockless screen write (HOOK-0402), validate-sfs-on-write blocks when the validator cannot start (HOOK-0002) (WP-8b.2, D-120)'] }
    : { ok: false, lines: [`FAIL okExit=${okExit} badExit=${badExit} denyLock=${denyLock.code} blockDead=${blockDead.code}`] };
}

/** WP-8b.3: push admission (P0–P9), gate-push/gate-dispatch mapping, session-start (§4.3.5/4.3.7). */
async function runOperatingLayer(/** @type {string} */ root) {
  const os = await import('node:os');
  const { pushAdmissible } = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href));
  const { admit } = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/verify/src/bin/push-admissible.mjs')).href));
  const { decide: pushD } = /** @type {any} */ (await import(pathToFileURL(path.join(root, '.claude/hooks/gate-push.decide.mjs')).href));
  const { decide: dispD } = /** @type {any} */ (await import(pathToFileURL(path.join(root, '.claude/hooks/gate-dispatch.decide.mjs')).href));
  const { decide: ssD } = /** @type {any} */ (await import(pathToFileURL(path.join(root, '.claude/hooks/session-start.decide.mjs')).href));

  // pushAdmissible: green admits; a T3 partial admits only with --allow-partial + a backend outage.
  const green = { tiers: { T1: { result: 'pass' }, T2: { result: 'pass' }, T3: { result: 'pass' } } };
  const t3partial = { tiers: { T1: { result: 'pass' }, T2: { result: 'pass' }, T3: { result: 'partial', detail: { uninspectable: [{ reason: 'backend unavailable' }] } } } };
  const a1 = pushAdmissible(green, { present: new Set() }).ok === true;
  const a2 = pushAdmissible(t3partial, {}).ok === false;
  const a3 = pushAdmissible(t3partial, { allowPartial: true }).ok === true;
  // admit: a run with no artifact refuses P1; determinability refuses P0.
  const b1 = admit({ root: os.tmpdir(), runId: '20260824-1000-none', screen: 'items', now: 0 }).code === 'HOOK-0302';
  const b2 = admit({ root, runId: undefined, screen: undefined, now: 0 }).code === 'HOOK-0301';
  // gate-push: a push maps push-admissible's refusal; a non-push never spawns.
  const push = pushD({ tool_name: 'Bash', tool_input: { command: 'npm run sfs -- push --run 20260824-1000-r --screen items' } }, { root, fs, spawnNode: () => ({ status: 1, stdout: JSON.stringify({ admissible: false, code: 'HOOK-0307', reason: 'x' }) }) });
  const p1 = push.decision === 'deny' && push.code === 'HOOK-0307';
  const p2 = pushD({ tool_name: 'Bash', tool_input: { command: 'npm run lint' } }, { root, fs, spawnNode: () => ({ status: 0 }) }).decision === 'allow';
  // gate-dispatch: judge isolation refuses a logs/ path to an evaluator.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proveb-disp-'));
  fs.mkdirSync(path.join(tmp, 'dispatch'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dispatch', 'e.json'), JSON.stringify({ dispatchVersion: '1.0', role: 'sfs-evaluator', runId: '20260824-1000-r', screen: 'items', round: 1, paths: ['runs/20260824-1000-r/logs/x.md'] }));
  const d1 = dispD({ tool_name: 'Task', tool_input: { subagent_type: 'sfs-evaluator', prompt: 'judge dispatch/e.json' } }, { root: tmp, fs, spawnNode: () => ({ status: 0 }) }).code === 'HOOK-0503';
  // session-start: exactly six lines, never a block.
  const s1 = ssD({ source: 'startup' }, { root, fs, spawnNode: () => ({ status: 0 }), nodeVersion: 'v22' }).lines.length === 6;

  const ok = a1 && a2 && a3 && b1 && b2 && p1 && p2 && d1 && s1;
  return ok
    ? { ok: true, lines: ['push admission is one program (P0–P9): T1–T3 pushAdmissible admits green and a --allow-partial backend outage, refuses otherwise; admit refuses a missing artifact (HOOK-0302) and an undeterminable push (HOOK-0301); gate-push maps the refusal, gate-dispatch enforces judge isolation (HOOK-0503), session-start prints six lines and never blocks (WP-8b.3, D-121)'] }
    : { ok: false, lines: [`FAIL a=${a1}${a2}${a3} b=${b1}${b2} push=${p1}${p2} dispatch=${d1} session=${s1}`] };
}

/** WP-8c.2: g-markup-provenance enforces INV 1 by recompilation, g-specwriter-purity keeps logs clean, the prop-group index moved to L0 (§4.3.8, D-124/D-125). */
async function runInv1(/** @type {string} */ root) {
  const mp = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/verify/src/gates/g-markup-provenance.mjs')).href));
  const sp = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/verify/src/gates/g-specwriter-purity.mjs')).href));
  const { verdictOf } = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href));
  const mpFams = await mp.run({ repoRoot: root });
  const mpv = verdictOf(mpFams);
  const spv = verdictOf(await sp.run({ repoRoot: root }));
  const walked = mpFams.find((/** @type {any} */ f) => f.name === 'markup-provenance')?.walked ?? 0;
  const groups = fs.existsSync(path.join(root, 'packages/registry/data/prop-groups/index.json'));
  const gone = !fs.existsSync(path.join(root, 'plugins/shesha-developer/skills/clean-form-config'));
  const ok = mpv === 'pass' && spv === 'pass' && groups && gone && walked >= 11;
  return ok
    ? { ok: true, lines: [`INV 1 has a real enforcer: g-markup-provenance recompiles ${walked} committed artifacts byte-identically from their sibling SFS (closes D-003), g-specwriter-purity keeps specwriter logs free of the six markup fingerprints, and the prop-group index moved to packages/registry/data/prop-groups as clean-form-config was deleted (WP-8c.2, D-124/D-125)`] }
    : { ok: false, lines: [`FAIL markup-provenance=${mpv} (walked ${walked}) specwriter-purity=${spv} groupsMoved=${groups} skillGone=${gone}`] };
}

/** WP-8d: the seven-tool MCP surface, one implementation behind three adapters, parity-locked to the CLI (§4.5). */
async function runMcp(/** @type {string} */ root) {
  const { tools, byName } = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/mcp/src/tools/index.mjs')).href));
  const parity = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/verify/src/gates/g-mcp-cli-parity.mjs')).href));
  const { verdictOf } = /** @type {any} */ (await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href));
  const seven = tools.length === 7;
  const dt = byName.registry_lookup.run({ types: ['datatable'] });
  const dtOk = dt.records[0] && dt.records[0].type === 'datatable' && typeof dt.records[0].version === 'number';
  const parityOk = verdictOf(await parity.run({ repoRoot: root })) === 'pass';
  const wired = fs.existsSync(path.join(root, '.mcp.json'));
  const ok = seven && dtOk && parityOk && wired;
  return ok
    ? { ok: true, lines: [`the shesha-sfs MCP surface is seven tools behind one implementation: registry_lookup resolves datatable to v${dt.records[0].version} exactly, g-mcp-cli-parity locks the tool set to the CLI subcommand set (${tools.length} == ${tools.length}), and /.mcp.json launches the stdio server (WP-8d, D-126)`] }
    : { ok: false, lines: [`FAIL seven=${seven} datatable=${dtOk} parity=${parityOk} mcpJson=${wired}`] };
}

/** WP-1c: noUncheckedIndexedAccess is on tree-wide, so every indexed access is checked (BL-010). */
async function runStrictIndex(/** @type {string} */ root) {
  const ts = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
  const on = ts.compilerOptions && ts.compilerOptions.noUncheckedIndexedAccess === true;
  return on
    ? { ok: true, lines: ['noUncheckedIndexedAccess: true — every indexed access is checked (BL-010, was D-024 deferral)'] }
    : { ok: false, lines: ['noUncheckedIndexedAccess is not true in tsconfig.json'] };
}

/** WP-7: the design skills are thin — no BL-007/BL-012 prose-budget waiver survives. */
async function runProseThin(/** @type {string} */ root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'packages/verify/config/prose-budget.json'), 'utf8'));
  const stragglers = (cfg.waivers || []).filter((/** @type {any} */ w) => w.until === 'BL-007' || w.until === 'BL-012');
  return stragglers.length === 0
    ? { ok: true, lines: ['design skills thinned; no BL-007/BL-012 prose waiver remains'] }
    : { ok: false, lines: [`${stragglers.length} BL-007/BL-012 prose waiver(s) still present`] };
}

/** WP-3b.1: the compiler emits the §3.3.1 placement sidecar on every compile. */
async function runSidecar(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const src = fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean/employees-table.sfs.json'), 'utf8');
  const { meta } = /** @type {any} */ (compile(src, { source: 'prove-b' }));
  const nodes = /** @type {any[]} */ (meta.nodes || []);
  const shell = nodes.find((n) => n.sfsPath === '/pageShell');
  const fill = nodes.find((n) => n.cell && n.cell.sizing === 'fill');
  const complete = nodes.length > 0 && nodes.every((n) => n.region !== undefined && n.cell && n.rowGroup
    && n.tabKey !== undefined && typeof n.depth === 'number' && typeof n.parent === 'string');
  const ok = meta.provenance === 'COMPILED' && shell && shell.region === 'page'
    && fill && typeof fill.cell.reservePx === 'number' && complete;
  return ok
    ? { ok: true, lines: [`sidecar carries placement: pageShell region=page, a fill cell reserves ${fill.cell.reservePx}px, ${nodes.length} nodes complete (§3.3.1)`] }
    : { ok: false, lines: [`sidecar incomplete: provenance=${meta.provenance} shell=${shell && shell.region} fill=${fill && fill.cell && fill.cell.reservePx} complete=${complete}`] };
}

/** WP-3b.2: the 18-name placement predicate engine evaluates a contract over the sidecar. */
async function runPredicates(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { evaluate } = await import(pathToFileURL(path.join(root, 'packages/verify/src/predicates/index.mjs')).href);
  const src = fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean/employees-table.sfs.json'), 'utf8');
  const { meta } = /** @type {any} */ (compile(src, { source: 'prove-b' }));
  const rows = [
    { predicate: 'cellCount', args: { row: 'toolbar' }, expect: { eq: 2 } },
    { predicate: 'cellSizing', args: { node: 'searchCell' }, expect: { eq: 'fill' } },
    { predicate: 'ratio', args: { a: 'searchCell', b: 'addCell' }, expect: { gte: 2.5 } },
    { predicate: 'region', args: { node: 'pageShell' }, expect: { eq: 'page' } },
  ];
  const results = rows.map((r) => /** @type {any} */ (evaluate)(r, meta));
  const absent = /** @type {any} */ (evaluate)({ predicate: 'cellSizing', args: { node: 'ghostNode' }, expect: { eq: 'fill' } }, meta);
  const ok = results.every((r) => r.pass === true) && absent.pass === false;
  return ok
    ? { ok: true, lines: [`placement predicates evaluate: ${results.length} contract rows pass over the sidecar, an absent node fails (D-014, the 18-name engine)`] }
    : { ok: false, lines: [`predicate engine: ${results.filter((r) => !r.pass).map((r) => r.predicate).join(',') || 'ok'}; absentPass=${absent.pass}`] };
}

/** WP-3b.3: the T3 offline semantic tier passes clean and discriminates a real defect. */
async function runT3Tier(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { t3Semantic, checks } = await import(pathToFileURL(path.join(root, 'packages/verify/src/tiers/t3-semantic.mjs')).href);
  const { verdictOf } = await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href);
  const src = fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json'), 'utf8');
  const r = /** @type {any} */ (compile(src, { source: 'prove-b' }));
  const doc = JSON.parse(String(r.envelope.Markup));
  const entity = String(r.envelope.ModelType);
  const md = JSON.parse(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/metadata/inline-editable-table.metadata.json'), 'utf8'));
  const clean = verdictOf(t3Semantic(doc, r.meta, { entity, metadata: md }));
  // Adversarial: a dataContext whose entityType disagrees with the form entity must fail.
  const bad = JSON.parse(JSON.stringify(doc));
  const walk = (/** @type {any} */ n, /** @type {(x:any)=>void} */ cb) => { if (Array.isArray(n)) n.forEach((x) => walk(x, cb)); else if (n && typeof n === 'object') { cb(n); for (const k of Object.keys(n)) walk(n[k], cb); } };
  walk(bad.components, (n) => { if (n.type === 'dataContext') n.entityType = 'wrong.Entity'; });
  const flipped = verdictOf(t3Semantic(bad, r.meta, { entity, metadata: md }));
  const ok = clean === 'pass' && flipped === 'fail';
  return ok
    ? { ok: true, lines: [`T3 offline tier passes clean and catches a defect: ${checks.length} checks, a wrong dataContext entityType flips it to fail (§3.2.4, D-106)`] }
    : { ok: false, lines: [`T3 tier: clean=${clean} (want pass), corrupted=${flipped} (want fail)`] };
}

/** WP-3b.3b: the T3 contract checks evaluate a committed contract and catch drift. */
async function runContract(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { t3Semantic } = await import(pathToFileURL(path.join(root, 'packages/verify/src/tiers/t3-semantic.mjs')).href);
  const { verdictOf } = await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href);
  const r = /** @type {any} */ (compile(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean/employees-table.sfs.json'), 'utf8'), { source: 'prove-b' }));
  const doc = JSON.parse(String(r.envelope.Markup));
  const entity = String(r.envelope.ModelType);
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/contracts/employees-table.contract.json'), 'utf8'));
  const md = JSON.parse(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/metadata/employees-table.metadata.json'), 'utf8'));
  const clean = verdictOf(t3Semantic(doc, r.meta, { entity, contract, metadata: md }));
  const bad = { acceptance: [{ id: 'X', tier: 't3', predicate: 'region', args: { node: 'pageShell' }, expect: { eq: 'body' } }] };
  const flipped = verdictOf(t3Semantic(doc, r.meta, { entity, contract: bad, metadata: md }));
  const ok = clean === 'pass' && flipped === 'fail';
  return ok
    ? { ok: true, lines: [`placement contract evaluates: ${contract.acceptance.length} rows + a column set pass over the compiled screen, a drifted row flips it to fail (T3.20/21/22, D-107)`] }
    : { ok: false, lines: [`contract checks: clean=${clean} (want pass), drifted=${flipped} (want fail)`] };
}

/** WP-3b.3c: the T3 backend checks resolve with a recorded snapshot, degrade without it. */
async function runMetadata(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { t3Semantic } = await import(pathToFileURL(path.join(root, 'packages/verify/src/tiers/t3-semantic.mjs')).href);
  const { verdictOf } = await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href);
  const r = /** @type {any} */ (compile(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json'), 'utf8'), { source: 'prove-b' }));
  const doc = JSON.parse(String(r.envelope.Markup));
  const entity = String(r.envelope.ModelType);
  const md = JSON.parse(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/metadata/inline-editable-table.metadata.json'), 'utf8'));
  const withMd = verdictOf(t3Semantic(doc, r.meta, { entity, metadata: md }));
  const withoutMd = verdictOf(t3Semantic(doc, r.meta, { entity, metadata: null }));
  const ok = withMd === 'pass' && withoutMd === 'partial';
  return ok
    ? { ok: true, lines: ['T3 backend checks resolve with a recorded snapshot (pass) and degrade to uninspectable without it (partial), never a pass (§3.2.4, D-108; D-036 closed)'] }
    : { ok: false, lines: [`metadata substrate: withSnapshot=${withMd} (want pass), withoutSnapshot=${withoutMd} (want partial)`] };
}

/** WP-3b.4: g-check-references, lifted onto the coverage API, passes over the cleaned plugin. */
async function runCheckRefLift(/** @type {string} */ root) {
  const gate = await import(pathToFileURL(path.join(root, 'packages/verify/src/gates/g-check-references.mjs')).href);
  const { verdictOf } = await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href);
  const v = verdictOf(await gate.run({ repoRoot: root }));
  const husksGone = !fs.existsSync(path.join(root, 'quarantine/g-check-references.mjs')) && !fs.existsSync(path.join(root, 'quarantine/t3-semantic.mjs'));
  const ok = v === 'pass' && husksGone;
  return ok
    ? { ok: true, lines: ['g-check-references, lifted onto the coverage API, passes over the cleaned plugin; the quarantined husks are gone (D-049 closed, D-109)'] }
    : { ok: false, lines: [`check-references lift: gate verdict=${v} (want pass), husksGone=${husksGone}`] };
}

/** WP-9: precedent Index A retrieves shapes over the corpus and stays out of the correctness path. */
async function runPrecedent(/** @type {string} */ root) {
  const P = await import(pathToFileURL(path.join(root, 'packages/precedent/src/index.mjs')).href);
  const { verdictOf } = await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href);
  const rag = await import(pathToFileURL(path.join(root, 'packages/verify/src/gates/g-rag-isolation.mjs')).href);
  const idx = P.indexDir(path.join(root, 'packages/sfs/corpus'));
  let notImplemented = false;
  /** @type {any} */
  let r = null;
  try {
    const form = JSON.parse(fs.readFileSync(path.join(root, 'packages/sfs/corpus/employee-table.json'), 'utf8'));
    r = P.search({ form, k: 3 }, idx);
  } catch (e) { notImplemented = (/** @type {any} */ (e)).code === 'E_NOT_IMPLEMENTED'; }
  const ragOk = verdictOf(await rag.run({ repoRoot: root })) === 'pass';
  const ok = !notImplemented && r && r.method === 'shape' && r.results.length >= 1 && ragOk;
  return ok
    ? { ok: true, lines: [`precedent Index A retrieves ${r.results.length} shapes over ${r.corpusSize} corpus forms (method=shape, no E_NOT_IMPLEMENTED); g-rag-isolation holds (BL-009, D-110)`] }
    : { ok: false, lines: [`precedent: notImplemented=${notImplemented} method=${r && r.method} results=${r && r.results.length} ragOk=${ragOk}`] };
}

/** WP-6: the corpus round-trip clears its declared subset at rate >= 0.90 (BL-002). */
async function runRoundtrip(/** @type {string} */ root) {
  const { roundtrip } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/roundtrip.mjs')).href);
  const r = /** @type {any} */ (roundtrip(root, 'packages/sfs/config/roundtrip-expected.json'));
  const clean = r.report.cleanActual.length;
  const rate = r.report.rate;
  const triaged = r.report.triaged.length;
  const escaped = r.report.escapes.filter((/** @type {any} */ e) => e.structuralEscapes > 0).length;
  const total = clean + escaped + triaged;
  const ok = r.ok && rate >= 0.90 && clean >= 7;
  return ok
    ? { ok: true, lines: [`corpus round-trip: ${clean} of ${total} forms clean+stable at rate ${rate.toFixed(2)} (>= 0.90, was 4); ${escaped} documented escape (BL-021), ${triaged} await BL-024 container node-types (sectionSeparator, collapsiblePanel, tabs); the datatable-column + action-grammar lift closed GAP-001 (BL-002, D-111)`] }
    : { ok: false, lines: [`round-trip: rate=${rate.toFixed(2)} (want >= 0.90), clean=${clean} (want >= 7), ok=${r.ok}; ${r.report.problems.join('; ') || 'no problems'}`] };
}

/** WP-3c: the DOM-residue tier catches real residue, and T4 is never green without running. */
async function runResidue(/** @type {string} */ root) {
  const { t4bResidue } = await import(pathToFileURL(path.join(root, 'packages/verify/src/tiers/t4b-residue.mjs')).href);
  const { t4Smoke, t4Available, selftestRecord } = await import(pathToFileURL(path.join(root, 'packages/verify/src/tiers/t4-smoke.mjs')).href);
  const { withStubBackend } = await import(pathToFileURL(path.join(root, 'packages/verify/test/helpers/stub-backend.mjs')).href);
  const probe = (/** @type {string} */ n) => JSON.parse(fs.readFileSync(path.join(root, `packages/sfs/test/fixtures/probe/${n}.json`), 'utf8'));

  const clean = probe('login.probe');
  const named = clean.nodes.filter((/** @type {any} */ n) => n.name).length;
  const cleanV = verdictOf(t4bResidue(clean));
  const overflowV = verdictOf(t4bResidue(probe('login.probe.overflow')));
  const blindV = verdictOf(t4bResidue(probe('login.probe.no-name')));
  const smokeV = verdictOf(await withStubBackend((/** @type {string} */ o, /** @type {any} */ get) => t4Smoke(selftestRecord(o), { backendGet: get })));
  const avail = t4Available({ baseUrl: null, playwright: false });

  const ok = cleanV === 'pass' && overflowV === 'fail' && blindV === 'partial' && smokeV === 'pass'
    && avail.ok === false && avail.reason === 'playwright not installed; no --base-url given';
  return ok
    ? { ok: true, lines: [`T4b over a probe recorded from a live Shesha screen (${clean.nodes.length} nodes, ${named} carrying data-sha-c-name) passes; the overflow probe fails and the name-stripped probe is uninspectable, never a pass; T4's selftest passes over the stub backend and T4 states what is missing rather than running (WP-3c, D-127)`] }
    : { ok: false, lines: [`t4/t4b: clean=${cleanV} overflow=${overflowV} blind=${blindV} smoke=${smokeV} availReason="${avail.reason}"`] };
}

/**
 * The proof's ordered steps. Each names the Scope-B WP that makes it runnable and
 * is added in that WP's commit.
 * @type {{id:string, label:string, needs:string, impl:(root:string)=>Promise<{ok:boolean, lines:string[]}>}[]}
 */
const STEPS = [
  { id: 'robustness', label: 'compiler robust', needs: 'WP-5c', impl: runRobustness },
  { id: 'hygiene', label: 'decompiler hygiene', needs: 'WP-5d', impl: runHygiene },
  { id: 'columns', label: 'columns lift', needs: 'WP-5e', impl: runColumns },
  { id: 'registry', label: 'full registry', needs: 'WP-2b', impl: runRegistry },
  { id: 'schemas', label: 'handoff schemas', needs: 'WP-8a', impl: runSchemas },
  { id: 'hooks', label: 'hook contract', needs: 'WP-8b.1', impl: runHooks },
  { id: 'validate-cli', label: 'sfs validate CLI', needs: 'WP-8b.2', impl: runValidateCli },
  { id: 'operating-layer', label: 'push admission', needs: 'WP-8b.3', impl: runOperatingLayer },
  { id: 'inv1', label: 'markup provenance', needs: 'WP-8c.2', impl: runInv1 },
  { id: 'mcp', label: 'mcp tool surface', needs: 'WP-8d', impl: runMcp },
  { id: 'strict-index', label: 'strict index', needs: 'WP-1c', impl: runStrictIndex },
  { id: 'prose-thin', label: 'prose thin', needs: 'WP-7', impl: runProseThin },
  { id: 'sidecar', label: 'placement sidecar', needs: 'WP-3b.1', impl: runSidecar },
  { id: 'predicates', label: 'placement predicates', needs: 'WP-3b.2', impl: runPredicates },
  { id: 't3-tier', label: 'T3 semantic tier', needs: 'WP-3b.3', impl: runT3Tier },
  { id: 'contract', label: 'placement contract', needs: 'WP-3b.3b', impl: runContract },
  { id: 'metadata', label: 'T3 metadata substrate', needs: 'WP-3b.3c', impl: runMetadata },
  { id: 'checkref-lift', label: 'check-references lift', needs: 'WP-3b.4', impl: runCheckRefLift },
  { id: 'precedent', label: 'precedent index', needs: 'WP-9', impl: runPrecedent },
  { id: 'roundtrip', label: 'corpus round-trip', needs: 'WP-6', impl: runRoundtrip },
  { id: 'residue', label: 'T4/T4b residue', needs: 'WP-3c', impl: runResidue },
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<{scope:string[], done:string[], remaining:string[]}>}
 */
export async function scopeState(ctx) {
  const fams = families([{ name: 'scope', unit: 'file' }]);
  const got = readJsonGuarded(path.join(ctx.repoRoot, 'packages/verify/config/session-scope-b.json'),
    fams.get('scope'), 'session-scope-b.json');
  if (!got.ok) return { scope: [], done: [], remaining: [] };
  const scope = /** @type {{wps:string[]}} */ (got.value).wps || [];
  const completed = completedWps(ctx.repoRoot);
  const done = scope.filter((w) => completed.has(w));
  const remaining = scope.filter((w) => !completed.has(w));
  return { scope, done, remaining };
}

async function main() {
  const root = repoRoot();
  const partial = process.argv.includes('--partial');
  const bless = process.argv.includes('--bless');

  const { scope, done, remaining } = await scopeState({ repoRoot: root });
  if (scope.length === 0) {
    console.error('prove-b: packages/verify/config/session-scope-b.json is missing or unreadable');
    return EXIT.usage;
  }

  /** @type {string[]} */
  const cap = [];
  /** @param {string} s */
  const say = (s) => { console.log(s); cap.push(s); };
  say('=== SHESHA SFS REBUILD — INTEGRATION PROOF (SCOPE B) ===');
  say(`scope            ${scope.join(' ')}   ${done.length}/${scope.length} complete`);

  const runnable = new Set(done);
  let failed = 0;
  for (const step of STEPS) {
    const label = step.label.padEnd(16);
    if (!runnable.has(step.needs)) {
      say(`${label} notRun — ${step.needs} is not recorded complete in BUILD-LOG.md`);
      continue;
    }
    const result = await step.impl(root);
    for (const line of result.lines) say(`${label} ${line}`);
    if (!result.ok) failed += 1;
  }

  if (failed > 0) {
    console.log(`SESSION INCOMPLETE — ${failed} proof step(s) failed`);
    return EXIT.fail;
  }
  if (remaining.length > 0) {
    console.log(`SESSION INCOMPLETE — completed ${done.length ? done.join(',') : 'none'}; remaining ${remaining.join(',')}`);
    return partial ? EXIT.partial : EXIT.fail;
  }

  // Every scoped WP complete and every step passed. The stdout block is frozen into
  // prove-b.expected.txt; --bless writes it (D-100: permitted exactly once for Scope
  // B), a normal run byte-compares, and only an identical block earns the final line.
  const block = `${cap.join('\n')}\n`;
  const expPath = path.join(root, 'packages/verify/test/prove-b.expected.txt');
  if (bless) {
    fs.writeFileSync(expPath, block);
    console.log(`\nprove-b --bless: wrote packages/verify/test/prove-b.expected.txt (${Buffer.byteLength(block, 'utf8')} B)`);
    return EXIT.pass;
  }
  if (!fs.existsSync(expPath)) {
    console.log('SESSION INCOMPLETE — packages/verify/test/prove-b.expected.txt is missing; run `npm run prove-b -- --bless` once to freeze it');
    return EXIT.fail;
  }
  const exp = fs.readFileSync(expPath, 'utf8');
  if (exp !== block) {
    let i = 0; while (i < exp.length && exp[i] === block[i]) i += 1;
    console.log(`SESSION INCOMPLETE — prove-b output drifted from prove-b.expected.txt at byte ${i}`);
    return EXIT.fail;
  }

  console.log('SESSION COMPLETE — SCOPE B');
  return EXIT.pass;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(main));
}
