/**
 * Resolve a style role into a complete, literal style block.
 *
 * Roles store TOKEN REFERENCES ("$spacing.6", "$roles.pageBg") so that a brand
 * swap changes one theme file. A `roles.*` token may itself point at a palette
 * path, so resolution follows references until it reaches a literal.
 */
const MAX_TOKEN_HOPS = 5;

function lookup(tokens, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), tokens);
}

function resolveToken(ref, tokens) {
  let cur = ref;
  for (let hop = 0; hop < MAX_TOKEN_HOPS; hop++) {
    if (typeof cur !== 'string' || !cur.startsWith('$')) return cur;
    const found = lookup(tokens, cur.slice(1));
    if (found === undefined) throw new Error(`resolveRole: unresolvable token: ${cur}`);
    // A role token's value is a bare dotted path, not a $-prefixed one.
    cur = typeof found === 'string' && !found.startsWith('$') && found.includes('.')
      ? `$${found}`
      : found;
    if (typeof cur !== 'string' || !cur.startsWith('$')) return cur;
  }
  throw new Error(`resolveRole: token reference cycle at ${ref}`);
}

function resolveDeep(node, tokens) {
  if (Array.isArray(node)) return node.map((n) => resolveDeep(n, tokens));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$inherit') continue; // handled by the caller
      out[k] = resolveDeep(v, tokens);
    }
    return out;
  }
  return typeof node === 'string' && node.startsWith('$') ? resolveToken(node, tokens) : node;
}

/** Shallow-merge per top-level key, so `stylingBox` overrides wholesale rather than merging. */
function applyInherit(block, base) {
  const { $inherit, ...rest } = block;
  if (!$inherit) return rest;
  return { ...base, ...rest };
}

export function resolveRole(roleName, { roles, tokens }) {
  const role = roles?.[roleName];
  if (!role) throw new Error(`resolveRole: unknown role: ${roleName}`);

  const desktop = resolveDeep(role.desktop ?? {}, tokens);
  const out = { desktop };
  for (const bp of ['tablet', 'mobile']) {
    const raw = role[bp];
    // A breakpoint with no entry at all mirrors desktop — never left empty.
    out[bp] = raw ? applyInherit(resolveDeep(raw, tokens), desktop) : { ...desktop };
    if (raw?.$inherit) {
      // Re-apply overrides on top of the inherited base, resolved.
      const { $inherit, ...overrides } = raw;
      out[bp] = { ...desktop, ...resolveDeep(overrides, tokens) };
    }
  }
  return out;
}

/** Collect every leaf prop path a block sets, in registry `props` notation. */
function propPaths(node, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(node ?? {})) {
    if (k === '$inherit') continue;
    const path = prefix ? `${prefix}.${k}` : k;
    // `stylingBox` is a single prop holding a JSON string, not a nested tree.
    if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'stylingBox') {
      out.push(...propPaths(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

export function validateRoles({ roles, registry }) {
  const problems = [];
  for (const [roleName, role] of Object.entries(roles ?? {})) {
    const type = role.componentType;
    const entry = registry?.components?.[type];
    if (!entry) {
      problems.push(`role "${roleName}": componentType "${type}" is not in the registry`);
      continue;
    }
    const valid = new Set(entry.props ?? []);
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      for (const p of propPaths(role[bp])) {
        if (!valid.has(p)) {
          problems.push(`role "${roleName}" (${bp}): "${p}" is not a prop of ${type}`);
        }
      }
    }
  }
  return problems;
}
