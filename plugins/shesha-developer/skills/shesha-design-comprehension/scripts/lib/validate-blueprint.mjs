/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/lib/validate-blueprint.mjs
 *
 * A minimal, dependency-free draft-07 subset validator for
 * assets/blueprint.schema.json. It is NOT a general-purpose JSON Schema
 * validator — it walks exactly the constructs this one schema uses
 * (type, enum, required, properties, additionalProperties, items, anyOf,
 * $ref against the schema's own `definitions`) which is enough to catch the
 * two failure modes that matter for a fixture: a missing required field and
 * a wrong-typed value. Anything the schema doesn't declare (patterns,
 * formats, numeric ranges, ...) is intentionally not enforced here.
 * ───────────────────────────────────────────────────────────────────────── */

'use strict';

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`validate-blueprint: only local $ref is supported, got "${ref}"`);
  const path = ref.slice(2).split('/');
  let cur = root;
  for (const seg of path) cur = cur[seg];
  if (!cur) throw new Error(`validate-blueprint: could not resolve $ref "${ref}"`);
  return cur;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeOf(value) === type;
}

/**
 * Validate `value` against `schema` (resolving $ref against `root`), pushing
 * a human-readable message per problem onto `errors`. Returns `errors`.
 */
function validate(value, schema, root, path, errors) {
  if (schema.$ref) schema = resolveRef(schema.$ref, root);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${typeOf(value)}`);
      return errors; // structural checks below assume the type already matches
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} is not one of [${schema.enum.join(', ')}]`);
  }

  const isObj = typeOf(value) === 'object';
  if (isObj && Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, req)) {
        errors.push(`${path}: missing required property "${req}"`);
      }
    }
  }
  if (isObj && schema.additionalProperties === false && schema.properties) {
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        errors.push(`${path}: unexpected property "${key}" (additionalProperties: false)`);
      }
    }
  }
  if (isObj && schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validate(value[key], schema.properties[key], root, `${path}.${key}`, errors);
      }
    }
  }

  if (typeOf(value) === 'array' && schema.items) {
    value.forEach((item, i) => {
      if (schema.items.anyOf) {
        const ok = schema.items.anyOf.some((sub) => validate(item, sub, root, `${path}[${i}]`, []).length === 0);
        if (!ok) errors.push(`${path}[${i}]: does not match any anyOf variant`);
      } else {
        validate(item, schema.items, root, `${path}[${i}]`, errors);
      }
    });
  }

  return errors;
}

/**
 * @param {object} blueprint - the document to validate
 * @param {object} schema - the parsed blueprint.schema.json
 * @returns {string[]} - empty when valid; one message per problem otherwise
 */
export function validateBlueprint(blueprint, schema) {
  return validate(blueprint, schema, schema, '$', []);
}
