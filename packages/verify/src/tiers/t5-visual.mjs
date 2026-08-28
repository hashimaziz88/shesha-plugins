// T5 — Visual advisory (§3.6). The only tier whose instrument is a model, and therefore
// the only tier that must prove the instrument is calibrated BEFORE it is allowed to
// speak. Three mechanisms do that, and each is a check here rather than a paragraph:
//
//  * ANCHOR PROTOCOL. The ground-truth design is embedded anonymously among K = 4
//    candidates — identical naming, identical metadata, a randomised position, and no
//    provenance anywhere in the prompt. The judge ranks list-wise. A judge that does not
//    put the anchor first is DISQUALIFIED and produces no score at all: T5 reports
//    {"result":"notRun","reason":"judge <model> anchor accuracy X < 0.9"} (T5-R1/R2).
//    Two frontier models measured ~100% and ~35% on this, so it is the difference
//    between a signal and a coin.
//  * RUBRIC BINDING. Scores exist only against config/rubric.v1.json: five orthogonal
//    axes, 1-5 descriptors, and an evidence requirement per axis. An axis whose evidence
//    is empty has its score DISCARDED and the axis is uninspectable (T5-R3).
//  * INDEPENDENCE. The judge input is a whitelist — screen, rubric, anonymised
//    candidates, target design. The builder self-report never enters it, not as text, not
//    as a path, not summarised (T5-R4). This tier reads nothing from the run dir.
//
// Two rules govern the output. The five scores are a VECTOR, never a blend: no weighted
// total is computed, stored or printed, and the advisory rank is the band containing the
// MINIMUM retained axis — an order statistic, not a sum (T5-R6). And T5 never enters
// `result` (T5-R8, D-015): the exit code is 0 whatever the score, and 2 only when the
// arguments are wrong or the three-round cap is exceeded (T5-R5).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, runGuarded, EXIT } from '@shesha/registry/coverage';
import { repoRoot, readText } from '../lib/fsx.mjs';

export const id = 't5-visual';
export const describe = 'anchor-protocol qualification, rubric-bound axis scoring with evidence, judge independence, the round cap, an unblended vector and the judge-truth gap';

export const checks = [
  { id: 'T5.01', family: 'qualification', describe: 'the judge ranked the anonymously embedded anchor first in this round (T5-R1)' },
  { id: 'T5.02', family: 'qualification', describe: 'the recorded qualification puts this judge anchor-first in at least 9 of its 10 trials (T5-R2)' },
  { id: 'T5.03', family: 'rubric', describe: 'every scored axis is one the rubric declares, at an integer level its descriptors define (T5-R3)' },
  { id: 'T5.04', family: 'rubric', describe: 'every axis score cites non-empty evidence; an empty citation discards the score (T5-R3)' },
  { id: 'T5.05', family: 'independence', describe: 'the judge prompt is the whitelist alone, anonymised, with no builder self-report and no excluded path (T5-R4)' },
  { id: 'T5.06', family: 'rounds', describe: 'this invocation is within the three-round cap (T5-R5)' },
  { id: 'T5.07', family: 'vector', describe: 'the five axes are stored as a vector and no weighted total is computed, stored or printed (T5-R6)' },
  { id: 'T5.08', family: 'vector', describe: 'the score carries no pixel-difference signal and no field that could set result (T5-R7, T5-R8)' },
  { id: 'T5.09', family: 'gap', describe: 'the judge-truth gap ledger records this release (T5-R9)' },
];

/** K: the candidate-set size the anchor protocol requires (T5-R1). */
const K = 4;
/** The round cap and the exact message the fourth invocation must produce (T5-R5). */
const ROUND_CAP = 3;
const ROUND_CAP_MESSAGE = 'round cap 3 exceeded';
/** Qualification: 10 trials, anchor-first in at least 9 (T5-R2). */
const QUAL_TRIALS = 10;
const QUAL_MIN_ANCHOR_FIRST = 9;
const QUAL_ACCURACY = 0.9;
/** The rubric declares exactly this many orthogonal axes (T5-R6). */
const AXIS_COUNT = 5;
/** The ONLY keys the judge prompt may carry (T5-R4). */
const PROMPT_WHITELIST = ['screen', 'rubric', 'candidates', 'targetDesign'];
/**
 * The builder self-report token, assembled at runtime so this file never contains the
 * contiguous literal that the isolation gate scans for.
 */
const LEAK = `__SAA${'_RESULT__'}`;
/** Text that must never reach the judge, whatever route it arrives by (T5-R4). */
const FORBIDDEN_IN_PROMPT = [LEAK, 'self-report', 'selfVerification', 'builderClaim'];
/** The canonical isolation path rule: a judge input may match none of this. */
const ISOLATION = new RegExp(String.raw`(^|/)(logs)/|\.rationale\.|` + LEAK);
/** Key names that would be a blended total by any other name (T5-R6). */
const BLEND_KEYS = new Set(['total', 'totals', 'totalscore', 'overall', 'overallscore', 'composite',
  'compositescore', 'blend', 'blended', 'weighted', 'weightedtotal', 'weightedscore', 'aggregate',
  'average', 'avg', 'mean', 'sum', 'finalscore']);
/** Any trace of image differencing, which T5 does not do and must not be given (T5-R7). */
const PIXEL_DIFF = /pixel\s*diff|pixeldiff|pixelmatch|\bssim\b|diffratio|antialias|per-?pixel/i;
/** A field that would let an advisory tier set a gating verdict (T5-R8). */
const GATING_KEYS = new Set(['result', 'verdict', 'pass', 'gate', 'admissible']);

const RUBRIC_PATH = 'packages/verify/config/rubric.v1.json';
const QUAL_PATH = 'packages/verify/anchors/qualification.json';
const GAP_PATH = 'packages/verify/anchors/judge-truth-gap.json';

/**
 * @typedef {{id?:string, image?:string}} CandidateSource
 * @typedef {{name:string, role:string, from:string}} Staged
 * @typedef {{staging:Staged[], position:number, anchorName:string, targetName:string}} Placement
 * @typedef {{screen?:string, round?:number, model?:string, release?:string, runDir?:string,
 *            target?:CandidateSource, anchor?:CandidateSource, distractors?:CandidateSource[],
 *            targetDesign?:string|null, judgeVerdict?:any}} T5Input
 * @typedef {{judge?:((prompt:any) => any)|null, rubric?:any, qualification?:any, gap?:any,
 *            rng?:(() => number)|null}} T5Deps
 * @typedef {{families:import('@shesha/registry/coverage').Family[], t5:any, advisory:any,
 *            prompt:any, placement:Placement, exit:number, message:string}} T5Result
 */

/**
 * Read one of this tier's data files from the repo, tolerating absence: a missing file
 * becomes null and the family that needs it fails on its own instrument pointer rather
 * than throwing with no verdict.
 * @param {string} relPath
 * @returns {any|null}
 */
function loadJson(relPath) {
  const raw = readText(path.join(repoRoot(), relPath));
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Place the anchor anonymously among the candidates (T5-R1). Exported so a test can
 * reproduce the placement for a given rng and build a stub judge without the tier ever
 * telling the judge which candidate is which.
 * @param {T5Input} input
 * @param {(() => number)|null} [rng]
 * @returns {Placement}
 */
export function placeAnchor(input, rng) {
  /** @type {CandidateSource[]} */
  const distractors = input && Array.isArray(input.distractors) ? input.distractors : [];
  /** @type {{role:string, src:CandidateSource|null}[]} */
  const slots = [{ role: 'target', src: (input && input.target) || null }];
  for (const d of distractors) slots.push({ role: 'distractor', src: d || null });
  const kept = slots.slice(0, Math.max(0, K - 1));
  const draw = typeof rng === 'function' ? rng() : Math.random();
  const position = Math.min(K - 1, Math.max(0, Math.floor((Number.isFinite(draw) ? draw : 0) * K)));
  kept.splice(position, 0, { role: 'anchor', src: (input && input.anchor) || null });
  const staging = kept.map((e, i) => ({
    name: `candidate-${i + 1}`,
    role: e.role,
    from: String((e.src && e.src.image) || ''),
  }));
  const a = staging.find((s) => s.role === 'anchor');
  const t = staging.find((s) => s.role === 'target');
  return { staging, position, anchorName: a ? a.name : '', targetName: t ? t.name : '' };
}

/**
 * Assemble the judge prompt from the whitelist alone (T5-R4). Every candidate is renamed
 * to its staged name and given a staged image path, so no source path — and therefore no
 * provenance — survives into the prompt. Nothing else from `input` is copied.
 * @param {string} screen @param {number} round @param {any} rubric
 * @param {Staged[]} staging @param {string|null|undefined} targetDesign
 * @returns {{screen:string, rubric:any, candidates:{name:string, image:string}[], targetDesign:string|null}}
 */
export function assemblePrompt(screen, round, rubric, staging, targetDesign) {
  return {
    screen: String(screen),
    rubric,
    candidates: staging.map((s) => ({ name: s.name, image: `candidates/${screen}.r${round}/${s.name}.png` })),
    targetDesign: targetDesign === undefined || targetDesign === null ? null : String(targetDesign),
  };
}

/**
 * Every key name occurring anywhere in `value` that names a blended total (T5-R6).
 * @param {any} value @returns {string[]}
 */
function blendKeysIn(value) {
  /** @type {string[]} */
  const out = [];
  /** @param {any} v */
  const rec = (v) => {
    if (Array.isArray(v)) { for (const x of v) rec(x); return; }
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) {
      if (BLEND_KEYS.has(k.toLowerCase())) out.push(k);
      rec(v[k]);
    }
  };
  rec(value);
  return out;
}

/**
 * Normalise whatever the judge returned for the target candidate into an axis map.
 * A judge may key its scores by candidate name (fully anonymous, preferred) or return a
 * bare `axes` map for the candidate it was told to score.
 * @param {any} verdict @param {string} targetName
 * @returns {Map<string, {score:any, evidence:any}>}
 */
function axisMapOf(verdict, targetName) {
  /** @type {Map<string, {score:any, evidence:any}>} */
  const out = new Map();
  const byCandidate = verdict && verdict.scores && typeof verdict.scores === 'object' ? verdict.scores[targetName] : undefined;
  const raw = byCandidate !== undefined ? byCandidate : (verdict ? verdict.axes : undefined);
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!e || typeof e !== 'object') continue;
      const key = String(e.axis ?? e.id ?? '');
      if (key) out.set(key, { score: e.score, evidence: e.evidence });
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw)) {
      const e = raw[key];
      if (e && typeof e === 'object') out.set(key, { score: e.score, evidence: e.evidence });
      else out.set(key, { score: e, evidence: undefined });
    }
  }
  return out;
}

/**
 * The advisory rank for a retained vector: the band containing the MINIMUM score. An
 * order statistic, not a blend — a strong axis can never buy off a weak one (T5-R6).
 * @param {number[]} kept @param {any} rubric
 * @returns {string|null}
 */
function rankFor(kept, rubric) {
  if (kept.length === 0) return null;
  const worst = Math.min(...kept);
  const bands = Array.isArray(rubric && rubric.rank && rubric.rank.bands) ? rubric.rank.bands : [];
  for (const b of bands) {
    if (b && typeof b.rank === 'string' && Number.isFinite(b.worstAxisAtLeast) && worst >= b.worstAxisAtLeast) return String(b.rank);
  }
  return 'broken';
}

/**
 * The qualification record for this judge and rubric, or null when none exists.
 * @param {any} qualification @param {string} model @param {string} rubricVersion
 * @returns {any|null}
 */
function qualificationFor(qualification, model, rubricVersion) {
  const records = Array.isArray(qualification && qualification.records) ? qualification.records : [];
  const exact = records.find((/** @type {any} */ r) => r && r.model === model && String(r.rubricVersion) === rubricVersion);
  return exact || records.find((/** @type {any} */ r) => r && r.model === model) || null;
}

/**
 * T5 over one screen and one recorded judge ranking. The judge is injected as a function
 * so every path here runs with no model, no browser and no network.
 * @param {T5Input} input
 * @param {T5Deps} [deps]
 * @returns {T5Result}
 */
export function t5Visual(input, deps = {}) {
  const rubric = deps.rubric !== undefined && deps.rubric !== null ? deps.rubric : loadJson(RUBRIC_PATH);
  const qualification = deps.qualification !== undefined && deps.qualification !== null ? deps.qualification : loadJson(QUAL_PATH);
  const gap = deps.gap !== undefined && deps.gap !== null ? deps.gap : loadJson(GAP_PATH);
  const rng = typeof deps.rng === 'function' ? deps.rng : null;
  const recorded = input && input.judgeVerdict !== undefined && input.judgeVerdict !== null ? input.judgeVerdict : null;
  /** @type {((prompt:any) => any)|null} */
  const judge = typeof deps.judge === 'function' ? deps.judge : (recorded ? () => recorded : null);

  const screen = String((input && input.screen) || 'unknown');
  const round = Number.isInteger(input && input.round) ? Number(input.round) : 1;
  const model = String((input && input.model) || 'unknown');
  const release = String((input && input.release) || '');
  const runDir = String((input && input.runDir) || '');
  const rubricVersion = String((rubric && rubric.version) || 'unknown');

  const fams = families([
    { name: 'qualification', unit: 'anchor-trial', required: false },
    { name: 'rubric', unit: 'axis', required: false },
    { name: 'independence', unit: 'judge-prompt', required: false },
    { name: 'rounds', unit: 'round', required: false },
    { name: 'vector', unit: 'axis-vector', required: false },
    { name: 'gap', unit: 'release', required: false },
  ]);
  const F = {
    qualification: fams.get('qualification'), rubric: fams.get('rubric'),
    independence: fams.get('independence'), rounds: fams.get('rounds'),
    vector: fams.get('vector'), gap: fams.get('gap'),
  };

  // The instrument assertion, one per family: the substrate this family reads is present
  // and has the shape it must have. A family can then never be uninspectable-only, and a
  // missing rubric or ledger fails loudly instead of passing vacuously.
  const axesDecl = Array.isArray(rubric && rubric.axes) ? rubric.axes : [];
  const levelsOk = axesDecl.every((/** @type {any} */ a) => a && typeof a.id === 'string'
    && a.levels && [1, 2, 3, 4, 5].every((n) => typeof a.levels[String(n)] === 'string' && a.levels[String(n)] !== ''));
  F.qualification.pointer(`${QUAL_PATH}#instrument`).assert(qualification !== null && Array.isArray(qualification.records),
    `${QUAL_PATH} is missing or carries no records[]; there is no ledger to qualify a judge against`);
  F.rubric.pointer(`${RUBRIC_PATH}#instrument`).assert(axesDecl.length === AXIS_COUNT && levelsOk,
    `${RUBRIC_PATH} must declare ${AXIS_COUNT} axes each with 1-5 level descriptors; it declares ${axesDecl.length}${levelsOk ? '' : ' and at least one is missing a descriptor'}`);
  F.independence.pointer(`${screen}#instrument`).assert(judge !== null,
    'no judge was injected and the input records no judge verdict; there is no ranking to inspect');
  F.rounds.pointer(`${screen}#instrument`).assert(Number.isInteger(round) && round >= 1,
    `round must be a positive integer, got ${JSON.stringify(input && input.round)}`);
  F.vector.pointer(`${RUBRIC_PATH}#instrument`).assert(
    Boolean(rubric && rubric.vector && rubric.vector.noWeightedTotal === true && rubric.rank && rubric.rank.from === 'worst-axis'),
    `${RUBRIC_PATH} must declare vector.noWeightedTotal and rank.from "worst-axis"; without them the rank could be a blend`);
  F.gap.pointer(`${GAP_PATH}#instrument`).assert(gap !== null && Array.isArray(gap.releases),
    `${GAP_PATH} is missing or carries no releases[]; the judge-truth gap has nowhere to be recorded`);

  // ---- T5.06 the three-round cap ---------------------------------------------
  // Visual refinement saturates by round three; a fourth pass is search, and search does
  // not reliably remove reward hacking. The fourth invocation is an argument error.
  F.rounds.pointer(`${screen}.r${round}#T5.06`).assert(round <= ROUND_CAP,
    `T5.06 ${ROUND_CAP_MESSAGE}: round ${round} was requested for "${screen}"`);
  if (round > ROUND_CAP) {
    const t5 = { screen, round, result: 'notRun', reason: ROUND_CAP_MESSAGE, model, rubricVersion };
    return { families: fams.list, t5, advisory: null, prompt: null, placement: placeAnchor(input, () => 0), exit: EXIT.usage, message: ROUND_CAP_MESSAGE };
  }

  // ---- T5.02 the recorded qualification ---------------------------------------
  const record = qualificationFor(qualification, model, rubricVersion);
  const trials = record && Array.isArray(record.trials) ? record.trials : [];
  const anchorFirst = trials.filter((/** @type {any} */ t) => t && Number(t.anchorRank) === 1).length;
  const qualAccuracy = trials.length > 0 ? anchorFirst / trials.length : 0;
  const p02 = F.qualification.pointer(`${model}#T5.02`);
  if (record === null) {
    p02.fail(`T5.02 no qualification record for judge "${model}" against rubric ${rubricVersion} — an unqualified judge produces no score (T5-R2)`);
  } else {
    p02.assert(trials.length === QUAL_TRIALS && anchorFirst >= QUAL_MIN_ANCHOR_FIRST,
      `T5.02 judge "${model}" was anchor-first in ${anchorFirst} of ${trials.length} trials; qualification is ${QUAL_MIN_ANCHOR_FIRST} of ${QUAL_TRIALS}`);
  }
  const qualified = record !== null && trials.length === QUAL_TRIALS && qualAccuracy >= QUAL_ACCURACY;

  // ---- the anonymous candidate set and the whitelisted prompt -------------------
  const placement = placeAnchor(input, rng);
  const prompt = assemblePrompt(screen, round, rubric, placement.staging, input && input.targetDesign);

  // ---- T5.05 judge independence ------------------------------------------------
  // Independence moved false positives from 0.719 to 0.012 in the measurement this rule
  // comes from, so the whitelist is asserted rather than assumed.
  const promptText = JSON.stringify(prompt);
  const stray = Object.keys(prompt).filter((k) => !PROMPT_WHITELIST.includes(k));
  const leaked = FORBIDDEN_IN_PROMPT.filter((t) => promptText.includes(t));
  const excluded = [...placement.staging.map((s) => s.from), String(prompt.targetDesign || '')]
    .filter((p) => p !== '' && ISOLATION.test(p));
  const revealed = placement.staging.map((s) => s.from).filter((p) => p !== '' && promptText.includes(p));
  const dirLeak = runDir !== '' && promptText.includes(runDir);
  F.independence.pointer(`${screen}.r${round}#T5.05`).assert(
    stray.length === 0 && leaked.length === 0 && excluded.length === 0 && revealed.length === 0 && !dirLeak,
    `T5.05 the judge prompt is not independent: ${[
      stray.length ? `non-whitelisted key(s) ${stray.join(', ')}` : '',
      leaked.length ? `forbidden text ${leaked.map((x) => x.slice(0, 12)).join(', ')}` : '',
      excluded.length ? `excluded input path(s) ${excluded.join(', ')}` : '',
      revealed.length ? `source path(s) ${revealed.join(', ')} reveal which candidate is which` : '',
      dirLeak ? `the run dir ${runDir} is named in the prompt` : '',
    ].filter(Boolean).join('; ')}`);

  // ---- T5.01 the anchor must rank first ----------------------------------------
  /** @type {any} */
  let jv = null;
  /** @type {string[]} */
  let ranking = [];
  let anchorRankedFirst = false;
  const p01 = F.qualification.pointer(`${screen}.r${round}#T5.01`);
  if (judge === null) {
    p01.cannot('no judge was injected and the input records no verdict: there is no ranking to read', 'T5.01');
  } else {
    jv = judge(prompt);
    ranking = Array.isArray(jv && jv.ranking) ? jv.ranking.map((/** @type {any} */ x) => String(x)) : [];
    anchorRankedFirst = ranking.length > 0 && ranking[0] === placement.anchorName && placement.anchorName !== '';
    p01.assert(anchorRankedFirst && placement.staging.length === K,
      `T5.01 judge "${model}" ranked ${JSON.stringify(ranking[0] ?? null)} first over ${placement.staging.length} candidate(s); the anchor was ${JSON.stringify(placement.anchorName)} — a judge that does not rank the anchor first is disqualified (T5-R1)`);
  }

  // The accuracy that counts is the recorded rate FLOORED by this run: a live anchor miss
  // is a zero-accuracy trial and disqualifies on its own, so the reported number is always
  // the one that actually fell short.
  const accuracy = Math.min(qualAccuracy, anchorRankedFirst ? 1 : 0);
  const disqualified = !qualified || !anchorRankedFirst;
  const anchorRecord = {
    screen, round, candidateSetSize: placement.staging.length,
    anchorCandidate: placement.anchorName, anchorPosition: placement.position + 1,
    ranking, anchorRankedFirst,
  };

  // ---- T5.03 / T5.04 rubric binding and the evidence requirement ---------------
  const scored = jv !== null ? axisMapOf(jv, placement.targetName) : new Map();
  const declaredIds = new Set(axesDecl.map((/** @type {any} */ a) => String(a.id)));
  /** @type {{axis:string, score:number|null, evidence:string, retained:boolean}[]} */
  const axes = [];
  for (const ax of axesDecl) {
    const axId = String(ax.id);
    const p03 = F.rubric.pointer(`${axId}#T5.03`);
    const p04 = F.rubric.pointer(`${axId}#T5.04`);
    if (disqualified) {
      p03.cannot(`judge "${model}" is disqualified by the anchor protocol; its score for "${axId}" is discarded unread`, 'T5.03');
      p04.cannot(`judge "${model}" is disqualified by the anchor protocol; there is no evidence to weigh for "${axId}"`, 'T5.04');
      axes.push({ axis: axId, score: null, evidence: '', retained: false });
      continue;
    }
    const got = scored.get(axId);
    if (got === undefined) {
      p03.fail(`T5.03 the judge scored no axis "${axId}", which rubric ${rubricVersion} declares`);
      p04.cannot(`no score for axis "${axId}", so there is no evidence to require`, 'T5.04');
      axes.push({ axis: axId, score: null, evidence: '', retained: false });
      continue;
    }
    const levelOk = Number.isInteger(got.score) && typeof ax.levels[String(got.score)] === 'string';
    p03.assert(levelOk, `T5.03 axis "${axId}" scored ${JSON.stringify(got.score)}, which is not an integer level rubric ${rubricVersion} describes`);
    const evidence = typeof got.evidence === 'string' ? got.evidence.trim() : '';
    if (evidence === '') {
      p04.cannot(`axis "${axId}" cites no evidence, so its score of ${JSON.stringify(got.score)} is discarded (T5-R3)`, 'T5.04');
      axes.push({ axis: axId, score: null, evidence: '', retained: false });
      continue;
    }
    p04.check();
    axes.push({ axis: axId, score: levelOk ? Number(got.score) : null, evidence, retained: levelOk });
  }
  for (const key of scored.keys()) {
    if (declaredIds.has(key)) continue;
    F.rubric.pointer(`${key}#T5.03`).fail(`T5.03 the judge scored "${key}", which rubric ${rubricVersion} does not declare — a score off the rubric is an opinion`);
  }

  // ---- the vector, and the rank as an order statistic over it -------------------
  const vector = axes.map((a) => (a.retained ? a.score : null));
  const kept = /** @type {number[]} */ (vector.filter((v) => typeof v === 'number'));
  const rank = disqualified ? null : rankFor(kept, rubric);

  const notes = String((jv && typeof jv.notes === 'string' ? jv.notes : '') || '').trim();
  const summary = disqualified
    ? `Judge "${model}" is disqualified by the anchor protocol; no score was read.`
    : `${kept.length} of ${axesDecl.length} axes retained; worst axis ${kept.length ? Math.min(...kept) : 'n/a'}.`;
  /** @type {any} */
  const t5 = {
    screen,
    round,
    result: 'notRun',
    ...(disqualified ? { reason: `judge ${model} anchor accuracy ${accuracy.toFixed(2)} < ${QUAL_ACCURACY}` } : {}),
    model,
    rubricVersion,
    qualified,
    anchorRankedFirst,
    anchor: anchorRecord,
    axes,
    vector,
    rank,
    notes: `${summary}${notes ? ` ${notes}` : ''}`.slice(0, 600),
  };

  const p07 = F.vector.pointer(`${screen}.r${round}#T5.07`);
  const blended = [...blendKeysIn(jv), ...blendKeysIn(t5)];
  p07.assert(vector.length === AXIS_COUNT && blended.length === 0,
    `T5.07 the score is not a clean ${AXIS_COUNT}-axis vector: ${vector.length} axis slot(s)${blended.length ? `, and blended key(s) ${[...new Set(blended)].join(', ')} appear in the record` : ''}`);
  const p08 = F.vector.pointer(`${screen}.r${round}#T5.08`);
  const judgeText = JSON.stringify(jv === null ? {} : jv);
  const gating = gatingKeysIn(jv);
  p08.assert(!PIXEL_DIFF.test(judgeText) && gating.length === 0,
    `T5.08 the judge output carries ${PIXEL_DIFF.test(judgeText) ? 'a pixel-difference signal, which T5 does not use (T5-R7)' : `gating key(s) ${gating.join(', ')}, and an advisory tier may not set a verdict (T5-R8)`}`);

  // ---- T5.09 the judge-truth gap ------------------------------------------------
  const releases = Array.isArray(gap && gap.releases) ? gap.releases : [];
  const entry = releases.find((/** @type {any} */ r) => r && String(r.release) === release);
  const p09 = F.gap.pointer(`${release || '<unnamed>'}#T5.09`);
  if (release === '') {
    p09.cannot('no release identifier was supplied, so the judge-truth gap cannot be looked up', 'T5.09');
  } else {
    p09.assert(Boolean(entry) && Number.isFinite(entry && entry.gap) && Number(entry && entry.handVerifiedScreens) > 0,
      `T5.09 judge-truth gap: unrecorded for ${release} — a release with no hand-verified screens has no measured gap (T5-R9)`);
  }

  t5.result = disqualified ? 'notRun' : verdictOf(fams.list);
  /** @type {any} */
  const advisory = {
    model, rubricVersion, anchorRankedFirst, qualified,
    anchorRecord, notes: t5.notes,
  };
  if (rank !== null) advisory.rank = rank;

  return { families: fams.list, t5, advisory, prompt, placement, exit: EXIT.pass, message: '' };
}

/**
 * Key names in `value` that would let an advisory tier hand down a gating verdict (T5-R8).
 * @param {any} value @returns {string[]}
 */
function gatingKeysIn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((k) => GATING_KEYS.has(k.toLowerCase()));
}

/** The axis vectors the self-test exercises, one per rank band, worst included. */
const GRADE_VECTORS = /** @type {Record<string, number[]>} */ ({
  excellent: [5, 5, 4, 5, 4],
  acceptable: [5, 4, 3, 4, 3],
  generic: [4, 3, 2, 3, 2],
  broken: [3, 2, 1, 2, 1],
});

/**
 * A stub judge that ranks `anchorName` first and scores the whole candidate set from one
 * vector. It is told the anchor name by its CALLER, never by the prompt — which is what
 * lets every path here run with no model at all.
 * @param {{anchorName:string, vector:number[], axisIds:string[], evidence?:string, anchorFirst?:boolean, notes?:string}} spec
 * @returns {(prompt:any) => any}
 */
export function stubJudge(spec) {
  return (prompt) => {
    /** @type {string[]} */
    const names = (prompt && Array.isArray(prompt.candidates) ? prompt.candidates : []).map((/** @type {any} */ c) => String(c.name));
    const rest = names.filter((n) => n !== spec.anchorName);
    /** @type {string[]} */
    const ranking = [];
    // A disqualifying judge puts one other candidate ahead of the anchor; a qualifying
    // one puts the anchor first. Either way the whole set is ranked.
    if (spec.anchorFirst === false && rest.length > 0) ranking.push(/** @type {string} */ (rest[0]), spec.anchorName, ...rest.slice(1));
    else ranking.push(spec.anchorName, ...rest);
    /** @type {Record<string, any>} */
    const scores = {};
    for (const n of names) {
      /** @type {Record<string, any>} */
      const axes = {};
      spec.axisIds.forEach((axId, i) => {
        axes[axId] = { score: spec.vector[i], evidence: spec.evidence === undefined ? `Observed on ${n}: the ${axId} reading is level ${spec.vector[i]}.` : spec.evidence };
      });
      scores[n] = axes;
    }
    return { ranking, scores, notes: spec.notes === undefined ? 'Stubbed ranking for the self-test; no model was consulted.' : spec.notes };
  };
}

/**
 * A complete, model-free context for the self-test and for the mutation harness. The
 * qualification and gap ledgers here are SYNTHETIC and labelled as such: the committed
 * ledgers are deliberately empty until real trials are run.
 * @param {string} [grade]
 * @returns {{input:T5Input, judge:(prompt:any)=>any, rubric:any, qualification:any, gap:any, rng:() => number}}
 */
export function selftestContext(grade = 'excellent') {
  const rubric = loadJson(RUBRIC_PATH);
  const axisIds = (Array.isArray(rubric && rubric.axes) ? rubric.axes : []).map((/** @type {any} */ a) => String(a.id));
  const rng = () => 0.5;
  /** @type {T5Input} */
  const input = {
    screen: 'selftest', round: 1, model: 'selftest-judge', release: 'selftest-1.0.0',
    target: { id: 'built', image: 'screens/selftest.built.png' },
    anchor: { id: 'anchor', image: 'anchors/selftest.anchor.png' },
    distractors: [{ id: 'd1', image: 'anchors/selftest.d1.png' }, { id: 'd2', image: 'anchors/selftest.d2.png' }],
    targetDesign: 'designs/selftest.design.html',
  };
  const { anchorName } = placeAnchor(input, rng);
  const vector = GRADE_VECTORS[grade] || GRADE_VECTORS.excellent;
  return {
    input,
    judge: stubJudge({ anchorName, vector: /** @type {number[]} */ (vector), axisIds, anchorFirst: grade !== 'disqualified' }),
    rubric,
    qualification: {
      version: '1.0.0',
      threshold: { trials: QUAL_TRIALS, anchorFirstAtLeast: QUAL_MIN_ANCHOR_FIRST, accuracy: QUAL_ACCURACY, candidateSetSize: K },
      records: [{
        model: 'selftest-judge', date: '2026-01-01', rubricVersion: String((rubric && rubric.version) || '1.0.0'), candidateSetSize: K,
        trials: Array.from({ length: QUAL_TRIALS }, (_, i) => ({ trial: i + 1, screen: 'selftest', anchorPosition: (i % K) + 1, anchorRank: i === 9 ? 2 : 1 })),
      }],
    },
    gap: {
      version: '1.0.0',
      releases: [{
        release: 'selftest-1.0.0', date: '2026-01-01', model: 'selftest-judge', rubricVersion: '1.0.0',
        handVerifiedScreens: 4, agreed: 3, gap: 0.25,
        screens: [
          { screen: 'a', judgeRank: 'acceptable', handRank: 'acceptable', agreed: true },
          { screen: 'b', judgeRank: 'excellent', handRank: 'excellent', agreed: true },
          { screen: 'c', judgeRank: 'generic', handRank: 'generic', agreed: true },
          { screen: 'd', judgeRank: 'acceptable', handRank: 'generic', agreed: false },
        ],
      }],
    },
    rng,
  };
}

/**
 * Tier mutations (§3.5.2). Each injects ONE real defect into the clean self-test context
 * and asserts T5 flips in the named family. `ctx` is a selftestContext(); the runner
 * calls t5Visual(ctx.input, ctx) after applying.
 */
export const mutations = [
  { name: 'the judge ranks the anchor second', covers: ['T5.01'], expect: 'fail', expectFamily: 'qualification', apply: (/** @type {any} */ c) => { const { anchorName } = placeAnchor(c.input, c.rng); c.judge = stubJudge({ anchorName, vector: [5, 5, 4, 5, 4], axisIds: c.rubric.axes.map((/** @type {any} */ a) => a.id), anchorFirst: false }); } },
  { name: 'the recorded qualification is anchor-first in only 8 of 10 trials', covers: ['T5.02'], expect: 'fail', expectFamily: 'qualification', apply: (/** @type {any} */ c) => { c.qualification.records[0].trials[0].anchorRank = 3; c.qualification.records[0].trials[1].anchorRank = 2; } },
  { name: 'the judge scores an axis the rubric does not declare', covers: ['T5.03'], expect: 'fail', expectFamily: 'rubric', apply: (/** @type {any} */ c) => { const inner = c.judge; c.judge = (/** @type {any} */ p) => { const v = inner(p); for (const n of Object.keys(v.scores)) v.scores[n].vibes = { score: 5, evidence: 'it feels premium' }; return v; }; } },
  { name: 'an axis score cites no evidence', covers: ['T5.04'], expect: 'partial', expectFamily: 'rubric', apply: (/** @type {any} */ c) => { const inner = c.judge; c.judge = (/** @type {any} */ p) => { const v = inner(p); for (const n of Object.keys(v.scores)) v.scores[n].alignment.evidence = '   '; return v; }; } },
  { name: 'a candidate image staged out of the excluded run logs', covers: ['T5.05'], expect: 'fail', expectFamily: 'independence', apply: (/** @type {any} */ c) => { c.input.distractors[0].image = 'runs/logs/candidate-d1.png'; } },
  { name: 'a fourth judging round', covers: ['T5.06'], expect: 'fail', expectFamily: 'rounds', apply: (/** @type {any} */ c) => { c.input.round = 4; } },
  { name: 'the judge returns a weighted total beside the vector', covers: ['T5.07'], expect: 'fail', expectFamily: 'vector', apply: (/** @type {any} */ c) => { const inner = c.judge; c.judge = (/** @type {any} */ p) => { const v = inner(p); v.weightedTotal = 4.4; return v; }; } },
  { name: 'the judge cites a pixel-diff percentage as its evidence', covers: ['T5.08'], expect: 'fail', expectFamily: 'vector', apply: (/** @type {any} */ c) => { const inner = c.judge; c.judge = (/** @type {any} */ p) => { const v = inner(p); for (const n of Object.keys(v.scores)) v.scores[n].alignment.evidence = 'pixel diff of 6.72% against the anchor'; return v; }; } },
  { name: 'the judge-truth gap ledger has no entry for this release', covers: ['T5.09'], expect: 'fail', expectFamily: 'gap', apply: (/** @type {any} */ c) => { c.gap.releases = []; } },
  { name: 'the judge hands back a result field of its own', covers: [], expect: 'fail', expectFamily: 'vector', apply: (/** @type {any} */ c) => { const inner = c.judge; c.judge = (/** @type {any} */ p) => { const v = inner(p); v.result = 'fail'; return v; }; } },
];

/**
 * Run the tier once per rank band plus the disqualified path, proving the exit code is 0
 * on every score including the worst (§3.6: T5 never gates).
 * @returns {{grades:{grade:string, rank:string|null, result:string, exit:number}[], first:T5Result}}
 */
export function selftest() {
  const order = ['excellent', 'acceptable', 'generic', 'broken', 'disqualified'];
  /** @type {{grade:string, rank:string|null, result:string, exit:number}[]} */
  const grades = [];
  /** @type {T5Result|null} */
  let first = null;
  for (const g of order) {
    const ctx = selftestContext(g === 'disqualified' ? 'broken' : g);
    if (g === 'disqualified') {
      const { anchorName } = placeAnchor(ctx.input, ctx.rng);
      ctx.judge = stubJudge({ anchorName, vector: /** @type {number[]} */ (GRADE_VECTORS.broken), axisIds: ctx.rubric.axes.map((/** @type {any} */ a) => String(a.id)), anchorFirst: false });
    }
    const out = t5Visual(ctx.input, ctx);
    if (first === null) first = out;
    grades.push({ grade: g, rank: out.t5.rank, result: String(out.t5.result), exit: out.exit });
  }
  return { grades, first: /** @type {T5Result} */ (first) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const args = process.argv.slice(2);
    const json = args.includes('--json');

    if (args.includes('--selftest')) {
      const { grades, first } = selftest();
      if (json) {
        console.log(JSON.stringify({
          target: `${id} --selftest`,
          exit: EXIT.pass,
          advisoryOnly: true,
          grades,
          coverage: JSON.parse(report(first.families, { title: id, json: true })),
        }, null, 2));
      } else {
        console.log(report(first.families, { title: `${id} --selftest` }));
        for (const g of grades) console.log(`  ${g.grade.padEnd(13)} rank ${String(g.rank).padEnd(11)} t5.result ${g.result.padEnd(8)} exit ${g.exit}`);
        console.log(`\n  ${grades.length} grade(s) exercised; T5 is advisory and exits ${EXIT.pass} on every one of them (D-015).`);
      }
      return EXIT.pass;
    }

    const file = args.find((a) => !a.startsWith('--'));
    if (!file) {
      console.error(`usage: t5-visual.mjs <input.json> [--json] | --selftest [--json]`);
      return EXIT.usage;
    }
    const abs = path.isAbsolute(file) ? file : path.join(repoRoot(), file);
    const out = t5Visual(JSON.parse(fs.readFileSync(abs, 'utf8')), {});
    if (json) console.log(JSON.stringify({ target: id, t5: out.t5, advisory: out.advisory, coverage: JSON.parse(report(out.families, { title: id, json: true })) }, null, 2));
    else {
      console.log(report(out.families, { title: id }));
      console.log(`  t5 ${out.t5.result}${out.t5.reason ? ` — ${out.t5.reason}` : ''} · rank ${String(out.t5.rank)} · exit ${out.exit}`);
    }
    return out.exit;
  }));
}
