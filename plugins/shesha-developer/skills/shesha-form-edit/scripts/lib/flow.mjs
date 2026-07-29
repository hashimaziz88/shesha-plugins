import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadFlow(archetype, { dir }) {
  return JSON.parse(readFileSync(join(dir, `${archetype}.flow.json`), 'utf8'));
}

/** The flat set of nodes a build must produce for this archetype. */
export function requiredNodes(flow) {
  return flow?.requires ?? [];
}

/**
 * Validate a flow manifest against the component registry and role catalogue.
 * Returns a list of human-readable problems; empty means valid.
 */
export function validateFlow(flow, { registry, roles }) {
  const problems = [];
  const nodes = requiredNodes(flow);
  const nodeNames = new Set(nodes.map((n) => n.node));
  const depIds = new Set((flow?.dependencies ?? []).map((d) => d.id));

  for (const n of nodes) {
    const entry = registry?.components?.[n.type];
    if (!entry) {
      problems.push(`${flow.archetype}/${n.node}: type "${n.type}" is not in the registry`);
    } else if (entry.authorable === false) {
      problems.push(
        `${flow.archetype}/${n.node}: type "${n.type}" is not authorable (${entry.authorableReason})`,
      );
    }
    if (n.role && !roles?.[n.role]) {
      problems.push(`${flow.archetype}/${n.node}: role "${n.role}" is not in the catalogue`);
    }
    if (n.slot && !nodeNames.has(n.slot)) {
      problems.push(`${flow.archetype}/${n.node}: slot "${n.slot}" names no node in this flow`);
    }
    if (n.dependsOn && !depIds.has(n.dependsOn)) {
      problems.push(`${flow.archetype}/${n.node}: dependsOn "${n.dependsOn}" has no dependency entry`);
    }
    for (const child of n.children ?? []) {
      if (!nodeNames.has(child)) {
        problems.push(`${flow.archetype}/${n.node}: child "${child}" names no node in this flow`);
      }
    }
  }
  return problems;
}
