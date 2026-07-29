#!/usr/bin/env node
/**
 * Resolve which brand token file to use. A LOOKUP, never an authoring step.
 *
 *   node scripts/resolve-brand.mjs            -> the default brand
 *   node scripts/resolve-brand.mjs skyline    -> skyline if it exists, else the default
 *
 * Exits 0 in both cases. An unknown brand is NOT an error and NOT a signal to
 * create one — it falls back to the shipped default and says so.
 *
 * This exists because a telemetry review found a run that spent most of its
 * turns authoring a ~290-key `skyline` brand file, including an `$antdTheme`
 * block, that no user had asked for. Brand authoring is its own explicitly
 * requested task; it is never part of a form, design or styling run.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const THEMES_DIR = resolve(HERE, '..', 'assets', 'themes');
export const DEFAULT_BRAND = 'shesha';

/**
 * @returns {{brand: string, path: string, requested: string|null,
 *            fellBack: boolean, available: string[], note: string}}
 */
export function resolveBrand(requested, { themesDir = THEMES_DIR } = {}) {
  const available = existsSync(themesDir)
    ? readdirSync(themesDir)
        .filter((f) => f.endsWith('.tokens.json'))
        .map((f) => f.replace(/\.tokens\.json$/, ''))
        .sort()
    : [];

  const wanted = typeof requested === 'string' && requested.trim() ? requested.trim() : null;

  if (wanted && available.includes(wanted)) {
    return {
      brand: wanted,
      path: join(themesDir, `${wanted}.tokens.json`),
      requested: wanted,
      fellBack: false,
      available,
      note: `Using brand "${wanted}".`,
    };
  }

  // Unknown or unspecified: the default, always. Never create the missing file.
  const note = wanted
    ? `Brand "${wanted}" has no token file — using the default "${DEFAULT_BRAND}". `
      + 'Do NOT author a brand file for this; brand authoring is a separate, explicitly requested task.'
    : `No brand requested — using the default "${DEFAULT_BRAND}".`;

  return {
    brand: DEFAULT_BRAND,
    path: join(themesDir, `${DEFAULT_BRAND}.tokens.json`),
    requested: wanted,
    fellBack: Boolean(wanted),
    available,
    note,
  };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const r = resolveBrand(process.argv[2]);
  console.log(r.note);
  console.log(`brand: ${r.brand}`);
  console.log(`path:  ${r.path.split('\\').join('/')}`);
  console.log(`available: ${r.available.join(', ') || '(none)'}`);
  process.exit(0);
}
