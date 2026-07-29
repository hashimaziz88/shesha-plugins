#!/usr/bin/env node
/**
 * resolve-style-plan.mjs — tokens → normalized style plan. A pure function.
 *
 * shesha-design-system owns how things look; the compiler owns what gets emitted.
 * This module is the seam. It dereferences a brand token file's roles.* indirection
 * into the flat, concrete plan described by schemas/style-plan.schema.json, and
 * validates the result — so a token file missing a role the compiler needs fails
 * here, loudly, instead of silently producing an unbranded form.
 *
 * Imported by shesha-form-edit/scripts/compile-blueprint.js. There is no later
 * free-form styling pass, and this module never touches the backend.
 *
 * CLI (inspection / CI):
 *   node scripts/resolve-style-plan.mjs shesha            # print the plan
 *   node scripts/resolve-style-plan.mjs shesha --quiet    # validate only, exit code
 * Exits 1 if the plan is incomplete, 2 on a missing theme.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THEME_DIR = path.join(SKILL_DIR, 'assets', 'themes');
const SCHEMA_PATH = path.join(SKILL_DIR, 'schemas', 'style-plan.schema.json');

const TOKEN_PREFIX = /^(palette|roles|type|spacing|radius|shadow|chrome)\./;

/** Neutral plan used when no brand applies (--no-style, or an unknown theme). */
export const NEUTRAL_PLAN = {
  brand: 'neutral',
  colors: {
    pageBg: '#f5f5f5', cardBg: '#ffffff', cardHeaderBg: '#fafafa',
    bodyText: '#262626', sectionHeading: '#262626', secondaryText: '#8c8c8c',
    inputBorder: '#d9d9d9', hairline: '#f0f0f0', appPrimary: '#1677ff',
    mutedText: '#8c8c8c', helperText: '#8c8c8c', divider: '#f0f0f0',
    hoverBg: '#fafafa', selectedBg: '#e6f4ff', readOnlyFieldBg: '#fafafa',
  },
  radius: { base: '4px', card: '8px' },
  type: {
    bodySize: '14px', semiboldWeight: 600,
    headingSizes: { 1: '24px', 2: '18px', 3: '16px', 4: '13px' },
    microSize: '12px', denseSize: '13px', mediumWeight: 500, regularWeight: 400,
  },
};

/**
 * Keys the blueprint's design-intent slots need (emphasis ink shades, table hover and
 * selected rows, dividers, dense/micro type steps) which older brand files predate.
 *
 * They resolve through a FALLBACK CHAIN rather than being required, because a brand
 * that has not named its hover shade is not a broken brand — collapsing it to the
 * neutral plan over one shade would lose the whole palette. Each chain ends in a role
 * every theme does define.
 */
const DERIVED_COLORS = {
  mutedText: ['mutedText', 'secondaryText'],
  helperText: ['helperText', 'secondaryText'],
  divider: ['divider', 'hairline'],
  hoverBg: ['hoverBg', 'cardHeaderBg'],
  selectedBg: ['selectedBg', 'cardHeaderBg'],
  readOnlyFieldBg: ['readOnlyFieldBg', 'cardHeaderBg'],
};
const DERIVED_TYPE = {
  microSize: ['type.scale.micro', 'type.scale.dense', 'type.scale.body'],
  denseSize: ['type.scale.dense', 'type.scale.body'],
  mediumWeight: ['type.weights.medium', 'type.weights.semibold'],
  regularWeight: ['type.weights.regular'],
};

function deref(tokens, dotted) {
  return String(dotted ?? '').split('.').reduce((o, k) => (o == null ? o : o[k]), tokens);
}

/**
 * Resolve a role name or an explicit token path to a concrete value.
 * roles.* values are themselves token paths, so resolution is two hops.
 */
function resolve(tokens, pathOrRole) {
  const p = TOKEN_PREFIX.test(pathOrRole) ? pathOrRole : `roles.${pathOrRole}`;
  let v = deref(tokens, p);
  if (typeof v === 'string' && TOKEN_PREFIX.test(v)) v = deref(tokens, v);
  return v;
}

/** Build the plan. Returns { plan, missing[] } — never throws on an incomplete theme. */
export function buildStylePlan(tokens) {
  const r = (k) => resolve(tokens, k);
  /** first chain entry the theme actually resolves, else the neutral value */
  const chain = (keys, neutral) => {
    for (const k of keys) {
      const v = r(k);
      if (v != null && v !== '' && !(typeof v === 'string' && TOKEN_PREFIX.test(v))) return v;
    }
    return neutral;
  };
  const plan = {
    brand: tokens?.$brand ?? 'unknown',
    colors: {
      pageBg: r('pageBg'), cardBg: r('cardBg'), cardHeaderBg: r('cardHeaderBg'),
      bodyText: r('bodyText'), sectionHeading: r('sectionHeading'),
      secondaryText: r('secondaryText'), inputBorder: r('inputBorder'),
      hairline: r('hairline'), appPrimary: r('appPrimary'),
      ...Object.fromEntries(Object.entries(DERIVED_COLORS)
        .map(([k, keys]) => [k, chain(keys, NEUTRAL_PLAN.colors[k])])),
    },
    radius: { base: r('baseRadius'), card: r('cardRadius') },
    type: {
      bodySize: r('type.scale.body'),
      semiboldWeight: r('type.weights.semibold'),
      headingSizes: {
        1: r('type.scale.title'), 2: r('type.scale.subtitle'),
        3: r('type.scale.cardHeader'), 4: r('type.scale.body'),
      },
      ...Object.fromEntries(Object.entries(DERIVED_TYPE)
        .map(([k, keys]) => [k, chain(keys, NEUTRAL_PLAN.type[k])])),
    },
  };
  const missing = [];
  const check = (obj, trail) => {
    for (const [k, v] of Object.entries(obj)) {
      const at = `${trail}.${k}`;
      if (v && typeof v === 'object') check(v, at);
      else if (v == null || v === '' || (typeof v === 'string' && TOKEN_PREFIX.test(v))) {
        missing.push(`${at}${typeof v === 'string' && v ? ` (unresolved "${v}")` : ''}`);
      }
    }
  };
  check(plan.colors, 'colors');
  check(plan.radius, 'radius');
  check(plan.type, 'type');
  return { plan, missing };
}

/**
 * Resolve a named brand to a validated plan.
 * Falls back to NEUTRAL_PLAN with a reason rather than emitting half a brand —
 * a partially-resolved plan is what produced "styled" forms that were still grey.
 */
export function loadStylePlan(themeName, { themeDir = THEME_DIR } = {}) {
  const file = path.join(themeDir, `${themeName}.tokens.json`);
  if (!fs.existsSync(file)) {
    return { plan: NEUTRAL_PLAN, source: null, warning: `theme "${themeName}" not found in ${themeDir}` };
  }
  let tokens;
  try { tokens = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return { plan: NEUTRAL_PLAN, source: file, warning: `theme "${themeName}" is not valid JSON: ${e.message}` }; }

  const { plan, missing } = buildStylePlan(tokens);
  if (missing.length) {
    return {
      plan: { ...NEUTRAL_PLAN, brand: plan.brand },
      source: file,
      warning: `theme "${themeName}" is incomplete — ${missing.length} key(s) unresolved: ${missing.join(', ')}`
        + '. Falling back to neutral values; add the missing roles to the token file.',
      missing,
    };
  }
  return { plan, source: file, warning: null, missing: [] };
}

/** Minimal structural check against style-plan.schema.json (required keys + no token paths). */
export function validateStylePlan(plan) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const errors = [];
  const walk = (node, def, trail) => {
    for (const key of def.required ?? []) {
      if (node?.[key] === undefined) { errors.push(`${trail}.${key} is required`); continue; }
      const sub = def.properties?.[key];
      const v = node[key];
      if (sub?.type === 'object' || sub?.required) walk(v, sub, `${trail}.${key}`);
      else if (typeof v === 'string' && TOKEN_PREFIX.test(v)) errors.push(`${trail}.${key} is an unresolved token path ("${v}")`);
      else if (v === null || v === '') errors.push(`${trail}.${key} is empty`);
    }
  };
  walk(plan, schema, 'plan');
  for (const [k, sub] of Object.entries(schema.properties)) {
    if (sub.required && plan?.[k]) walk(plan[k], sub, `plan.${k}`);
  }
  return errors;
}

// ---- CLI --------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const name = process.argv[2];
  const quiet = process.argv.includes('--quiet');
  if (!name) {
    console.error('usage: resolve-style-plan.mjs <brand> [--quiet]');
    process.exit(2);
  }
  const { plan, source, warning, missing } = loadStylePlan(name);
  if (warning) console.error(`WARN: ${warning}`);
  const errors = validateStylePlan(plan);
  if (!quiet) console.log(JSON.stringify(plan, null, 2));
  if (errors.length) {
    console.error(`\nstyle plan invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
  if (!quiet) console.error(`\nstyle plan OK — brand "${plan.brand}"${source ? ` from ${path.basename(source)}` : ' (neutral)'}`);
  process.exit(missing?.length ? 1 : 0);
}
