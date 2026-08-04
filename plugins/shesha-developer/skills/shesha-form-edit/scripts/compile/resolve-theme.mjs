// resolve-theme.mjs — the compiler's ONE token authority, and it FAILS CLOSED.
//
// Design is COMPILED IN, not painted on afterwards [R-042]: the brand token file is a
// compile-time input and every colour / type / spacing / radius the emitters reach for comes
// through `tk`. Three rules follow from that, and they are the whole point of this stage:
//
//   1. INHERITANCE, NOT DUPLICATION. A brand file may carry `extends: "<base>"` and hold ONLY
//      the keys that differ. The chain is flattened IN MEMORY into a complete theme (deep merge:
//      objects merge key-by-key, arrays and scalars replace wholesale). A duplicated base value
//      in an override is drift waiting to happen, so it is deleted from the file, not restated.
//   2. FAIL CLOSED. An unknown theme name, an unreadable file, a resolved theme missing a role
//      the compiler reads, or a role pointing at a token path nothing resolves — every one of
//      those THROWS. A misspelled brand must never ship an unbranded form that passes every gate.
//   3. `--no-style` IS THE ONLY OPT-OUT. Explicitly, by name, at the call site. It is the one road
//      where `tokens` stays null and every lookup yields its neutral fallback.
//
// Beside the schema live the two checks a JSON Schema cannot express: dangling token references
// (fatal) and the WCAG AA 4.5:1 body-text contrast floor (reported, non-fatal — a brand's own
// contrast is the brand's call to make, but never silently).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEME_DIR = path.join(HERE, '..', '..', '..', 'shesha-design-system', 'assets', 'themes');
export const THEME_SCHEMA_PATH = path.join(HERE, '..', '..', '..', 'shesha-design-system', 'schemas', 'theme.schema.json');

/** ajv lives in THIS skill's node_modules — the one tree in the plugin. */
const Ajv2020 = (() => {
  const mod = createRequire(path.join(HERE, '..', '..', 'package.json'))('ajv/dist/2020');
  return mod.default ?? mod;
})();

const MAX_EXTENDS_DEPTH = 8;

// Neutral spacing scale — the fallback when no theme is loaded. It carries the numeric
// STEPS as well as the aliases, so the key '4' still resolves to 16 rather than to 4px.
const SPACE = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80,
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32,
};
const TOKEN_ROOTS = /^(roles|palette|type|spacing|radius|shadow|chrome)\./;

// ---- file + inheritance plumbing --------------------------------------------------

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));

/**
 * A theme NAME resolves inside assets/themes; anything that looks like a path is one.
 * `from` is the directory a relative path is resolved against — the cwd for a CLI argument,
 * the child file's own directory for an `extends` target.
 */
const resolveThemePath = (nameOrPath, { isFile = false, from = null } = {}) => (
  isFile || /[\\/]/.test(nameOrPath) || /\.json$/i.test(nameOrPath)
    ? path.resolve(from ?? process.cwd(), nameOrPath)
    : path.join(THEME_DIR, `${nameOrPath}.tokens.json`)
);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge `child` OVER `base`. Objects merge key-by-key; arrays and scalars are
 * replaced wholesale (a lifecycle `order` is a sequence, not a set of slots to patch).
 */
function mergeThemes(base, child) {
  const out = { ...base };
  for (const [k, v] of Object.entries(child)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? mergeThemes(base[k], v) : v;
  }
  return out;
}

/**
 * Flatten an `extends` chain into one complete theme object. Depth-limited and cycle-safe:
 * a self-reference or a loop is a named error, not a stack overflow.
 * @returns {{tokens: object, chain: string[]}} chain is base-first, e.g. ['shesha', 'shesha-bold']
 */
function resolveChain(file, seen = [], depth = 0) {
  const abs = path.resolve(file);
  if (seen.includes(abs)) {
    throw new Error(`theme inheritance CYCLE: ${[...seen, abs].map((f) => path.basename(f)).join(' → ')}`);
  }
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new Error(`theme inheritance deeper than ${MAX_EXTENDS_DEPTH} levels at ${path.basename(abs)} — flatten the chain`);
  }
  let own;
  try { own = readJson(abs); }
  catch (err) {
    throw new Error(`theme file unreadable: ${abs}\n  ${err.message}`);
  }
  if (!isPlainObject(own)) throw new Error(`theme file is not a JSON object: ${abs}`);
  if (typeof own.extends !== 'string' || own.extends === '') {
    return { tokens: own, chain: [own.$brand ?? path.basename(abs)] };
  }
  const parentFile = resolveThemePath(own.extends, { from: path.dirname(abs) });
  if (!fs.existsSync(parentFile)) {
    throw new Error(`theme "${path.basename(abs)}" extends "${own.extends}", which does not resolve to a token file (${parentFile})`);
  }
  const parent = resolveChain(parentFile, [...seen, abs], depth + 1);
  return { tokens: mergeThemes(parent.tokens, own), chain: [...parent.chain, own.$brand ?? path.basename(abs)] };
}

// ---- validation --------------------------------------------------------------------

let compiledSchema = null;
function schemaValidator() {
  if (!compiledSchema) {
    const schema = readJson(THEME_SCHEMA_PATH);
    compiledSchema = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema);
  }
  return compiledSchema;
}

const finding = (path_, rule, actual, expected, message, severity = 'error') => (
  { path: path_, rule, actual, expected, message, severity }
);

/** dotted path → value, on the RESOLVED theme */
const at = (tokens, dotted) => (dotted || '').split('.').reduce((o, k) => (o == null ? o : o[k]), tokens);

// ---- contrast (WCAG 2.x relative luminance) ----------------------------------------

/** #rgb / #rrggbb / #rrggbbaa → [r,g,b] 0-255, or null for anything non-hex */
export function parseHex(v) {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  if (h.length < 6) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const luminance = ([r, g, b]) => {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

/** WCAG contrast ratio between two hex colours, or null if either is not a hex literal */
export function contrastRatio(fg, bg) {
  const a = parseHex(fg); const b = parseHex(bg);
  if (!a || !b) return null;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The AA body-text floor: readable ink on BOTH grounds a form uses. Reported as findings,
 * never fatal — a translucent or non-hex ink is `unverifiable`, not a failure.
 * @returns {Array} findings (severity 'warn')
 */
export function checkContrast(tokens, { min = 4.5 } = {}) {
  const out = [];
  const resolveRole = (role) => {
    let v = at(tokens, `roles.${role}`);
    if (typeof v === 'string' && TOKEN_ROOTS.test(v)) v = at(tokens, v);
    return v;
  };
  const ink = resolveRole('bodyText');
  for (const ground of ['pageBg', 'cardBg']) {
    const bg = resolveRole(ground);
    const ratio = contrastRatio(ink, bg);
    if (ratio === null) {
      out.push(finding(`roles.bodyText / roles.${ground}`, 'contrast-unverifiable', `${ink} on ${bg}`,
        'two hex literals', `body-text contrast against ${ground} cannot be measured — one side is not a hex literal`, 'warn'));
      continue;
    }
    if (ratio < min) {
      out.push(finding(`roles.bodyText / roles.${ground}`, 'contrast-below-aa', `${ratio.toFixed(2)}:1 (${ink} on ${bg})`,
        `>= ${min}:1`, `body text fails WCAG AA on ${ground}: ${ink} on ${bg} measures ${ratio.toFixed(2)}:1, below ${min}:1`, 'warn'));
    }
  }
  return out;
}

// ---- the resolved-theme validator --------------------------------------------------

/**
 * Validate a RESOLVED (inheritance already flattened) theme: JSON Schema first, then the
 * two semantic checks a schema cannot express.
 * @returns {Array} structured findings, `severity` 'error' | 'warn'
 */
export function validateResolvedTheme(tokens) {
  const out = [];
  const validate = schemaValidator();
  if (!validate(tokens)) {
    for (const err of validate.errors ?? []) {
      const where = String(err.instancePath || '').split('/').filter(Boolean).join('.');
      const missing = err.params?.missingProperty;
      out.push(finding(
        missing ? [where, missing].filter(Boolean).join('.') : (where || '(root)'),
        missing ? 'required-key-missing' : `schema-${err.keyword}`,
        missing ? undefined : err.data,
        missing ? 'present' : err.params,
        missing
          ? `${[where, missing].filter(Boolean).join('.') || missing} is missing — the compiler reads it, so the value would be dropped`
          : `${where || '(root)'} ${err.message}`,
      ));
    }
  }

  // roles.* values are token PATHS into the same theme. A path nothing resolves means the
  // role is dropped at compile time and the form ships missing that value [R-042].
  for (const [role, value] of Object.entries(tokens?.roles ?? {})) {
    if (role.startsWith('$') || typeof value !== 'string' || !TOKEN_ROOTS.test(value)) continue;
    let hops = 0;
    let cur = value;
    while (typeof cur === 'string' && TOKEN_ROOTS.test(cur) && hops < 4) {
      const next = at(tokens, cur);
      if (next === undefined) {
        out.push(finding(`roles.${role}`, 'dangling-token-reference', cur, 'a path that resolves in this theme',
          `roles.${role} points at ${cur}, which does not exist in this theme — the value is dropped at compile time [R-042]`));
        break;
      }
      cur = next; hops++;
    }
  }

  out.push(...checkContrast(tokens));
  return out;
}

// ---- the entry point ---------------------------------------------------------------

const fmt = (f) => `  ${f.severity === 'warn' ? 'WARN' : 'FAIL'} [${f.rule}] ${f.path} — ${f.message}`;

/**
 * @param {string} nameOrPath a shipped theme NAME, or a path to a token file
 * @param {{noStyle?: boolean, isFile?: boolean}} opts
 *   noStyle — the ONLY thing that skips the pass [R-042]
 *   isFile  — treat nameOrPath as a path even if it has no separator (`--theme-file`)
 * @returns {{name, tokens, chain, note, findings, tk, space, px, padBox}}
 * @throws if the theme cannot be resolved, or the resolved theme fails validation
 */
export function loadTheme(nameOrPath, { noStyle = false, isFile = false } = {}) {
  let tokens = null;
  let chain = [];
  let findings = [];
  let note = null;
  let name = nameOrPath;

  if (noStyle) {
    note = 'NOTE: --no-style — theme-token resolution skipped, emitting neutral tokens [R-042]';
  } else {
    const file = resolveThemePath(nameOrPath, { isFile });
    if (!fs.existsSync(file)) {
      throw new Error(
        `theme "${nameOrPath}" could not be resolved — nothing written.\n`
        + `  looked for: ${file}\n`
        + `  shipped themes: ${fs.readdirSync(THEME_DIR).filter((f) => f.endsWith('.tokens.json'))
          .map((f) => f.replace(/\.tokens\.json$/, '')).join(', ')}\n`
        + '  a theme the compiler cannot resolve is a COMPILE ERROR, not a neutral fallback [R-042]. '
        + 'Use --no-style to compile deliberately unstyled.',
      );
    }
    const resolved = resolveChain(file);
    tokens = resolved.tokens;
    chain = resolved.chain;
    name = tokens.$brand ?? nameOrPath;
    findings = validateResolvedTheme(tokens);
    const errors = findings.filter((f) => f.severity === 'error');
    if (errors.length) {
      throw new Error(
        `INVALID theme "${name}" (${file}) — ${errors.length} error finding(s), nothing written:\n`
        + `${findings.map(fmt).join('\n')}\n`
        + `  contract: ${path.relative(process.cwd(), THEME_SCHEMA_PATH)}`,
      );
    }
    if (chain.length > 1) note = `theme ${name} resolved through extends: ${chain.join(' → ')}`;
  }

  const raw = (dotted) => at(tokens, dotted);
  /** a token path OR a role name (roles.* values are themselves token paths → resolve twice) */
  const tk = (pathOrRole, fallback) => {
    if (!tokens) return fallback;
    let v = raw(TOKEN_ROOTS.test(pathOrRole) ? pathOrRole : `roles.${pathOrRole}`);
    if (typeof v === 'string' && TOKEN_ROOTS.test(v)) v = raw(v);
    return v ?? fallback;
  };

  const scaleStep = (key) => (Number.isFinite(tokens?.spacing?.[key]) ? tokens.spacing[key] : undefined);
  /** a spacing step with a neutral px fallback — for the compiler's own defaults */
  const px = (key, fallback) => scaleStep(key) ?? SPACE[key] ?? fallback;
  /**
   * Spacing is a TOKEN, not a literal: a numeric-STRING key is a step on the theme scale
   * ('4' → spacing.4 → 16px), a raw NUMBER is a literal px value. Conflating the two is
   * why the card default once emitted 4px while claiming 16.
   */
  const space = (v, dflt) => {
    if (v === undefined || v === null) return dflt;
    if (typeof v === 'number') return v;
    const key = String(v).trim();
    const themed = scaleStep(key) ?? SPACE[key];
    if (themed !== undefined) return themed;
    const n = parseInt(key, 10);
    return Number.isFinite(n) ? n : dflt;
  };
  /** a stylingBox JSON string from a uniform padding spec */
  const padBox = (v) => {
    const p = String(space(v, 0));
    return JSON.stringify({ paddingTop: p, paddingRight: p, paddingBottom: p, paddingLeft: p });
  };

  return { name, tokens, chain, note, findings, tk, space, px, padBox };
}
