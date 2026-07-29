/**
 * One definition of "is this colour on-token", shared by every check that
 * needs it.
 *
 * Why this module exists: `resolveRole` (shesha-design-system) resolves a
 * role's token references down to literal hex values — that is what
 * resolution means. So a compiled, correctly-themed form is FULL of literal
 * hexes, every one of which came from the active theme. A colour check that
 * cannot tell a resolved-token hex from an invented one therefore fires on
 * correct output.
 *
 * That bug was fixed in T2-STYLE-OFF-TOKEN first and immediately reappeared
 * in T3-RAW-HEX, because the logic lived privately inside one check. Two
 * copies of "what counts as on-token" drift; one does not.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TOKENS_PATH = join(
  HERE, '../../../shesha-design-system/assets/themes/shesha.tokens.json',
);

let cachedDefaultTokens;

/**
 * The project's default brand, loaded lazily. Callers that know their active
 * brand should pass it instead; this keeps the checks usable from
 * validate-form.mjs's CLI, which has no --tokens flag.
 */
export function loadDefaultTokens() {
  if (cachedDefaultTokens !== undefined) return cachedDefaultTokens;
  try {
    cachedDefaultTokens = existsSync(DEFAULT_TOKENS_PATH)
      ? JSON.parse(readFileSync(DEFAULT_TOKENS_PATH, 'utf8'))
      : null;
  } catch {
    // A malformed or unreadable theme must not crash validation — it degrades
    // to "no tokens known", which makes the colour checks stricter, not looser.
    cachedDefaultTokens = null;
  }
  return cachedDefaultTokens;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Normalise a colour string for comparison, or return null if it isn't one.
 * Expands 3/4-digit hex to 6/8 so `#fff` and `#FFFFFF` match, and collapses
 * whitespace in rgb()/rgba() so formatting differences don't cause a miss.
 */
export function normalizeColorForMatch(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (HEX.test(v)) {
    let h = v.slice(1).toLowerCase();
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    return `#${h}`;
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim()).filter((p) => p.length);
    if (parts.length >= 3) return `rgb(${parts.join(',')})`.toLowerCase();
  }
  return null;
}

/**
 * Flatten the ENTIRE theme document — palette, roles, statusLifecycle badges,
 * $antdTheme, anything else it carries — into the set of literal colours it
 * defines. A value equal to any of these is on-token by definition.
 */
export function collectThemeTokenColors(tokens) {
  const set = new Set();
  (function visit(value) {
    if (typeof value === 'string') {
      const norm = normalizeColorForMatch(value);
      if (norm) set.add(norm);
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (isPlainObject(value)) for (const v of Object.values(value)) visit(v);
  })(tokens);
  return set;
}

export function isOnToken(value, themeTokenColors) {
  const norm = normalizeColorForMatch(value);
  return norm !== null && themeTokenColors.has(norm);
}

/** Convenience: the on-token set for a supplied theme, or the default brand. */
export function themeColorSet(tokens) {
  return collectThemeTokenColors(tokens ?? loadDefaultTokens());
}
