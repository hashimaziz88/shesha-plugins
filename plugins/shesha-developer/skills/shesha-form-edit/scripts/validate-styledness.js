#!/usr/bin/env node
/**
 * validate-styledness.js — fails forms that would render structure-only / default AntD.
 *
 * Usage: node scripts/validate-styledness.js <form.json> [--generation 043|045] [--warn-only]
 *
 * Accepts raw markup ({components:[...]}), a GetJson response, or a golden wrapper.
 * Checks (FAIL unless --warn-only):
 *   1. page-chrome  — a root-level card/container establishing page ground (background or
 *                     className like "sha-page", or explicit page padding).
 *   2. style-coverage — share of visual components carrying ANY explicit styling
 *                     (0.45: desktop/tablet/mobile blocks; 0.43: style/stylingBox/flat props).
 *                     FAIL below 40%, WARN below 70%.
 *   3. typography   — at least one explicit font declaration somewhere in the tree.
 *   4. inline-style-conflict — WARN when a component has both an inline `style` string and
 *                     structured style blocks (inline wins and silently masks the rest).
 * Exit: 0 pass, 1 fail. Findings printed as FAIL/WARN/OK lines.
 */
import fs from 'fs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const warnOnly = argv.includes('--warn-only');
const genIdx = argv.indexOf('--generation');
const generation = genIdx >= 0 ? argv[genIdx + 1] : '045';

if (!file) { console.error('usage: validate-styledness.js <form.json> [--generation 043|045] [--warn-only]'); process.exit(1); }

let doc = JSON.parse(fs.readFileSync(file, 'utf8'));
if (doc.markup && typeof doc.markup === 'object') doc = doc.markup;
if (typeof doc.markup === 'string') doc = JSON.parse(doc.markup);
const components = doc.components || (Array.isArray(doc) ? doc : null);
if (!components) { console.error('FAIL no components tree found'); process.exit(1); }

const VISUAL = new Set(['container', 'card', 'text', 'textField', 'textArea', 'numberField', 'dropdown',
  'autocomplete', 'button', 'buttonGroup', 'datatable', 'datalist', 'alert', 'collapsiblePanel', 'tabs',
  'columns', 'sectionSeparator', 'refListStatus', 'statusTag', 'dateField', 'checkbox', 'radio', 'progress']);
const findings = [];
let visual = 0, styled = 0, fontDecls = 0, inlineConflicts = 0;

function hasStructuredStyle(c) {
  if (generation === '045') {
    return ['desktop', 'tablet', 'mobile'].some((k) => c[k] && typeof c[k] === 'object' && Object.keys(c[k]).length);
  }
  return Boolean(c.style || c.stylingBox || c.backgroundColor || c.color || c.fontSize || c.fontWeight);
}
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(walk);
  if (typeof node.type === 'string') {
    if (VISUAL.has(node.type)) {
      visual++;
      if (hasStructuredStyle(node) || node.className || node.stylingBox) styled++;
    }
    const blob = JSON.stringify(node);
    if (/"font"\s*:\s*{/.test(blob) || node.fontSize || node.fontWeight) fontDecls++;
    if (typeof node.style === 'string' && node.style.trim() && hasStructuredStyle(node)) {
      inlineConflicts++;
      findings.push(`WARN inline-style-conflict on ${node.type} "${node.propertyName || node.componentName || node.id}" — inline style string wins over structured blocks`);
    }
  }
  for (const k of Object.keys(node)) walk(node[k]);
}
walk(components);

// 1. page chrome
const rootBlob = JSON.stringify(components.slice ? components.slice(0, 3) : components).slice(0, 20000);
const hasChrome = /sha-page/.test(rootBlob) || /"background"\s*:\s*{/.test(rootBlob) || /"hideHeading"\s*:\s*true/.test(rootBlob);
findings.push(`${hasChrome ? 'OK  ' : 'FAIL'} page-chrome — ${hasChrome ? 'page ground present' : 'no page ground (sha-page class / root background / hideHeading card) — will render default AntD'}`);

// 2. coverage
const cov = visual ? Math.round((styled / visual) * 100) : 0;
const covLevel = cov >= 70 ? 'OK  ' : cov >= 40 ? 'WARN' : 'FAIL';
findings.push(`${covLevel} style-coverage — ${styled}/${visual} visual components styled (${cov}%; generation ${generation})`);

// 3. typography
findings.push(`${fontDecls ? 'OK  ' : 'FAIL'} typography — ${fontDecls} explicit font declaration(s)`);

findings.forEach((f) => console.log(f));
const failed = findings.some((f) => f.startsWith('FAIL'));
console.log(`\n${failed ? 'STYLEDNESS: FAIL' : 'STYLEDNESS: PASS'} (${cov}% coverage, ${inlineConflicts} inline conflicts)`);
process.exit(failed && !warnOnly ? 1 : 0);
