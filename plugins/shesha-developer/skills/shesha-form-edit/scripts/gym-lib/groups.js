// Raw KB settings groups → canonical gym buckets.
// Buckets drive variant priority and the labeled sections in each gym form.

const GROUP_MAP = new Map(Object.entries({
  // appearance
  style: 'appearance', styles: 'appearance', font: 'appearance', border: 'appearance',
  background: 'appearance', color: 'appearance', sizes: 'appearance', shadow: 'appearance',
  'icon styling': 'appearance', 'item styles': 'appearance', 'column styles': 'appearance',
  'header styles': 'appearance', 'downloaded file style': 'appearance', layout: 'appearance',
  theme: 'appearance',
  // data
  data: 'data', 'data settings': 'data', 'data source': 'data', 'data context': 'data',
  crud: 'data', filters: 'data', columns: 'data', formats: 'data',
  'data type and format': 'data', 'reflist source': 'data', files: 'data', file: 'data',
  'stored file': 'data',
  // validation
  validation: 'validation',
  // events
  events: 'events', event: 'events', actions: 'events', action: 'events',
  // skipped entirely (variants would hide the component or aren't visually measurable)
  security: 'skip', custom: 'skip', javascript: 'skip', typescript: 'skip',
}));

export const BUCKET_PRIORITY = ['appearance', 'validation', 'data', 'events', 'display'];

export function bucketFor(field, appearanceFieldPaths = []) {
  if (appearanceFieldPaths.includes(field.path)) return 'appearance';
  const raw = String(field.group || '').trim().toLowerCase();
  if (!raw) return 'display';
  if (GROUP_MAP.has(raw)) return GROUP_MAP.get(raw);
  // fuzzy: any group name containing a style word is appearance
  if (/style|font|border|background|shadow|dimension/.test(raw)) return 'appearance';
  if (/data/.test(raw)) return 'data';
  return 'display';
}
