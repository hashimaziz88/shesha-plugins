#!/usr/bin/env node
// Generates schemas/form-config.schema.json from the 0.45 components-kb.
// The schema is the L4 contract's cheapest gate: known component types only,
// generated ids, integer versions, string defaultValues. Deliberately
// permissive on per-type settings (additionalProperties: true) to start.
//
// Usage: node generate-schema.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'components-kb');
const OUT = path.join(SCRIPT_DIR, '..', 'schemas', 'form-config.schema.json');

const index = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_index.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_meta.json'), 'utf8'));
const types = Object.keys(index).filter((k) => !k.startsWith('_')).sort();

const versionByType = {};
for (const t of types) if (Number.isInteger(index[t].version)) versionByType[t] = index[t].version;

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'shesha-form-config.schema.json',
  title: 'Shesha form configuration markup (0.45)',
  description: `Generated from components-kb (${meta.sourceBranch}@${String(meta.commit).slice(0, 9)}, ${types.length} component types). A component type not in the enum is unusable by definition (L0/L1).`,
  type: 'object',
  required: ['components', 'formSettings'],
  properties: {
    components: { type: 'array', items: { $ref: '#/$defs/component' } },
    formSettings: {
      type: 'object',
      properties: {
        layout: { enum: ['horizontal', 'vertical', 'inline'] },
        modelType: {
          description: '0.45: the {name, module} object resolved from live EntityConfig [R-016]',
          type: ['object', 'string'],
        },
        labelCol: { type: 'object' },
        wrapperCol: { type: 'object' },
        access: { type: 'integer' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
  $defs: {
    component: {
      type: 'object',
      required: ['id', 'type'],
      properties: {
        id: {
          type: 'string',
          description: 'uuid or nanoid — short placeholder ids are silently ignored [R-002]',
          pattern: '^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9_-]{10,})$',
        },
        type: { enum: types },
        version: { type: 'integer', description: 'current KB version per type [R-003]' },
        parentId: { type: 'string', description: 'direct parent id; root components use "root" [R-001]' },
        propertyName: { type: 'string', pattern: '^[a-z]', description: 'camelCase [R-004]' },
        defaultValue: { type: 'string', description: 'mustache-template STRING only [R-009]' },
        customVisibility: { not: {}, description: 'IGNORED on 0.45 — use code-mode hidden [R-031]' },
        components: { type: 'array', items: { $ref: '#/$defs/component' } },
      },
      additionalProperties: true,
    },
  },
  'x-versionByType': versionByType,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(schema, null, 2) + '\n');
console.log(`wrote ${OUT} (${types.length} component types)`);
