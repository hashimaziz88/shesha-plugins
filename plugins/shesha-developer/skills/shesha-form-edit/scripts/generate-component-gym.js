#!/usr/bin/env node
// Generates gym forms: one form per components-kb component, containing a
// baseline instance plus one variant instance per measurable setting
// (baseline + exactly one setting changed), grouped under labeled bucket headings.
// Deterministic ids/ordering → reruns diff cleanly.
//
// Usage: node generate-component-gym.js [--only textField,container] [--out <gym dir>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymUuid, shortHash, sha1 } from './gym-lib/ids.js';
import { bucketFor, BUCKET_PRIORITY } from './gym-lib/groups.js';
import { representativeValues } from './gym-lib/value-reps.js';
import {
  scaffoldFor, makeChild, NEVER_VARY, GYM_ENTITY, GYM_MODULE, HELPER_FORM, buildHelperForm,
} from './gym-lib/scaffolds.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'components-kb');
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT_DIR = argVal('--out', path.join(SCRIPT_DIR, '..', 'gym'));
const ONLY = argVal('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_VARIANTS = Number(argVal('--max-variants', '28'));

const index = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_index.json'), 'utf8'));
const enumsAll = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_enums.json'), 'utf8'));
const sharedStyle = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_shared-style-fields.json'), 'utf8'));

fs.mkdirSync(path.join(OUT_DIR, 'forms'), { recursive: true });

// ---------------------------------------------------------------------------

function setDeep(obj, dottedPath, value) {
  const parts = dottedPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function buildInstance(type, kb, variantKey, override) {
  const scaffold = scaffoldFor(type);
  const instance = {
    id: gymUuid(type, variantKey),
    type,
    version: kb.version ?? 1,
    label: `gym ${type}`,
    hidden: false,
    ...(kb.initModel?.defaults || {}),
    ...(scaffold.props || {}),
  };
  if (kb.isInput) instance.propertyName = scaffold.bind || 'gymValue';
  else instance.componentName = `gym-${type}-inst-${variantKey}`;
  if (scaffold.children) {
    const slot = scaffold.childSlot || 'components';
    instance[slot] = scaffold.children(type, makeChild(type, variantKey));
    for (const child of instance[slot]) child.parentId = instance.id;
  }
  if (scaffold.build) scaffold.build(instance, makeChild(type, `${variantKey}-build`));
  if (override) setDeep(instance, override.path, override.value);
  return { instance, scaffold };
}

function wrapInstance(type, variantId, built) {
  const { instance, scaffold } = built;
  const inner = scaffold.wrap ? scaffold.wrap(instance, makeChild(type, `${variantId}-wrap`)) : [instance];
  const wrapper = {
    id: gymUuid(type, variantId, 'wrapper'),
    type: 'container',
    version: index.container?.version ?? 6,
    componentName: variantId,
    label: '',
    hideLabel: true,
    direction: 'vertical',
    components: inner,
  };
  for (const c of inner) c.parentId = wrapper.id;
  return wrapper;
}

function heading(type, bucket) {
  return {
    id: gymUuid(type, 'heading', bucket),
    type: 'text',
    version: index.text?.version ?? 2,
    componentName: `gym-${type}-h-${bucket}`,
    content: `— ${bucket} —`,
    textType: 'span',
    contentDisplay: 'content',
    hideLabel: true,
  };
}

function fieldsFor(kb) {
  const own = (kb.settingsFields || []).map((f) => ({ ...f }));
  const ownPaths = new Set(own.map((f) => f.path));
  const shared = (kb.appearanceFieldPaths || [])
    .filter((p) => !ownPaths.has(p))
    .map((p) => sharedStyle.fields.find((f) => f.path === p))
    .filter(Boolean)
    .map((f) => ({ ...f }));
  return [...own, ...shared];
}

function generateForType(type, entry) {
  const kb = JSON.parse(fs.readFileSync(path.join(KB_DIR, entry.file || `${type}.json`), 'utf8'));
  const enums = enumsAll[type] || {};
  const defaults = kb.initModel?.defaults || {};

  const planned = []; // {field, bucket, value, valueKey}
  const notMeasured = [];

  const fields = fieldsFor(kb);
  const byBucket = new Map(BUCKET_PRIORITY.map((b) => [b, []]));
  for (const field of fields) {
    if (NEVER_VARY.has(field.path)) continue;
    const bucket = bucketFor(field, kb.appearanceFieldPaths || []);
    if (bucket === 'skip') {
      notMeasured.push({ path: field.path, reason: `group ${field.group} skipped` });
      continue;
    }
    const reps = representativeValues(field, enums, defaults);
    if (!Array.isArray(reps)) {
      notMeasured.push({ path: field.path, reason: reps.skip });
      continue;
    }
    for (const rep of reps) byBucket.get(bucket).push({ field, bucket, ...rep });
  }

  let budget = MAX_VARIANTS;
  for (const bucket of BUCKET_PRIORITY) {
    for (const v of byBucket.get(bucket)) {
      if (budget > 0) {
        planned.push(v);
        budget--;
      } else {
        notMeasured.push({ path: `${v.field.path}=${v.valueKey}`, reason: 'capped' });
      }
    }
  }

  // ---- build the form ----
  const rootId = gymUuid(type, 'gym-root');
  const components = [];
  const instances = [];

  components.push({
    id: gymUuid(type, 'validationErrors'),
    type: 'validationErrors',
    version: index.validationErrors?.version ?? 1,
    componentName: `gym-${type}-validation-errors`,
  });

  const baselineId = `gym-${type}-baseline`;
  components.push(wrapInstance(type, baselineId, buildInstance(type, kb, 'baseline')));
  instances.push({ variantId: baselineId, kind: 'baseline' });

  let currentBucket = null;
  for (const v of planned) {
    if (v.bucket !== currentBucket) {
      components.push(heading(type, v.bucket));
      currentBucket = v.bucket;
    }
    const variantId = `gym-${type}-v-${shortHash(v.field.path, v.valueKey)}`;
    components.push(
      wrapInstance(type, variantId, buildInstance(type, kb, `${v.field.path}=${v.valueKey}`, {
        path: v.field.path,
        value: v.value,
      })),
    );
    instances.push({
      variantId,
      kind: 'variant',
      bucket: v.bucket,
      path: v.field.path,
      value: v.value,
      valueKey: v.valueKey,
    });
  }

  const root = {
    id: rootId,
    type: 'container',
    version: index.container?.version ?? 6,
    componentName: `gym-${type}-root`,
    direction: 'vertical',
    label: '',
    hideLabel: true,
    components,
  };
  for (const c of components) c.parentId = rootId;

  const form = {
    components: [root],
    formSettings: {
      layout: 'horizontal',
      colon: true,
      labelCol: { span: 6 },
      wrapperCol: { span: 18 },
      modelType: GYM_ENTITY,
    },
  };

  return { form, instances, notMeasured, componentVersion: kb.version ?? 1 };
}

// ---------------------------------------------------------------------------

const manifestPath = path.join(OUT_DIR, 'manifest.json');
const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

const types = Object.keys(index).filter((t) => !t.startsWith('_')).sort()
  .filter((t) => !ONLY.length || ONLY.includes(t));

const manifest = {
  $schema: 'shesha-gym-manifest/v1',
  module: { name: GYM_MODULE, id: prior.module?.id ?? null },
  probeConfig: prior.probeConfig ?? null,
  helperForms: prior.helperForms ?? {},
  forms: {},
};

// helper form referenced by datalist/subForm scaffolds
{
  const helperJson = JSON.stringify(buildHelperForm(index.textField?.version ?? 5), null, 2) + '\n';
  fs.writeFileSync(path.join(OUT_DIR, 'forms', `${HELPER_FORM}.json`), helperJson);
  manifest.helperForms[HELPER_FORM] = {
    backendId: prior.helperForms?.[HELPER_FORM]?.backendId ?? null,
  };
}

let totalVariants = 0;
for (const type of types) {
  const { form, instances, notMeasured, componentVersion } = generateForType(type, index[type]);
  const formName = `gym-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const json = JSON.stringify(form, null, 2) + '\n';
  fs.writeFileSync(path.join(OUT_DIR, 'forms', `${formName}.json`), json);
  const priorForm = prior.forms?.[formName];
  const markupSha1 = sha1(json);
  manifest.forms[formName] = {
    type,
    componentVersion,
    markupSha1,
    backendId: priorForm?.markupSha1 || priorForm?.backendId ? priorForm.backendId ?? null : null,
    lastPushedAt: priorForm?.markupSha1 === markupSha1 ? priorForm.lastPushedAt ?? null : null,
    instances,
    notMeasured,
  };
  totalVariants += instances.length - 1;
}
// keep prior forms not regenerated this run (e.g. --only)
if (prior.forms) {
  for (const [name, f] of Object.entries(prior.forms)) {
    if (!manifest.forms[name]) manifest.forms[name] = f;
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`generated ${types.length} gym forms (${totalVariants} variant instances) → ${OUT_DIR}`);
const capped = types.filter((t) => manifest.forms[`gym-${t.toLowerCase()}`].notMeasured.some((n) => n.reason === 'capped'));
if (capped.length) console.log(`capped components (${capped.length}): ${capped.join(', ')}`);
