// Readers for the committed session-state files. One implementation, because two
// gates asking "is this WP complete?" and disagreeing is the drift this rebuild
// removes.

import path from 'node:path';
import { readText } from './fsx.mjs';

/**
 * WP ids recorded COMPLETE in BUILD-LOG.md.
 *
 * A block heading alone is not completion: an in-flight WP has a heading too, and
 * treating it as done makes every `scheduled:<that WP>:` enforcer fail early and
 * every waiver expire early. Completion requires `Status: complete` inside the block.
 * @param {string} root
 * @returns {Set<string>}
 */
export function completedWps(root) {
  const text = readText(path.join(root, 'BUILD-LOG.md')) || '';
  /** @type {Set<string>} */
  const done = new Set();
  // Split on `## ` headings so a Status line is attributed to its own block.
  const blocks = text.split(/^## /m).slice(1);
  for (const block of blocks) {
    const head = /^(WP-[0-9A-Za-z.]+)\s+—/.exec(block);
    if (!head) continue;
    // Group 1 is mandatory in the pattern, so it is defined when head matched.
    if (/^Status:\s*complete\s*$/mi.test(block)) done.add(/** @type {string} */ (head[1]));
  }
  return done;
}

/**
 * BACKLOG.md row ids, so a `scheduled:BL-0NN:` enforcer can be resolved.
 * @param {string} root
 * @returns {Set<string>}
 */
export function backlogIds(root) {
  const text = readText(path.join(root, 'BACKLOG.md')) || '';
  /** @type {Set<string>} */
  const ids = new Set();
  // Group 1 is mandatory in the pattern, so it is defined for every match.
  for (const m of text.matchAll(/^\|\s*((?:BL|GAP|PROM)-[0-9a-z]{3})\s*\|/gm)) ids.add(/** @type {string} */ (m[1]));
  return ids;
}
