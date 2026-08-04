/**
 * Embedded-script invariants. A broken script string is uniquely nasty: it can break the
 * outer JSON, and when it does the failure surfaces as a browser-side parse error with no
 * pointer back to the offending component.
 */
import { allComponents, ownStrings } from '../lib/walk.mjs';

/** Props whose value is executable code. */
const CODE_KEYS = [
  'onInitialized',
  'onDataLoaded',
  'onUpdate',
  'onBeforeDataLoad',
  'onAfterDataLoad',
  'onValuesUpdate',
  'onPrepareSubmitData',
  'onBeforeSubmit',
  'onSubmitSuccess',
  'onSubmitFailed',
  'onChangeCustom',
  'onFocusCustom',
  'onBlurCustom',
  'onClick',
  'actionScript',
  'expression',
  'onSuccessScript',
  'onFailScript',
];

/** Props that carry code only in code mode. */
const CODE_MODE_KEYS = ['hidden', 'disabled', 'editMode', 'readOnly', 'defaultValue', 'required', 'customEnabled'];

const CODE_SHAPED = /(^|\W)(return|await|=>|function\s*\(|const\s|let\s|var\s|if\s*\()/;

function isCodeMode(v) {
  return v && typeof v === 'object' && v._mode === 'code';
}

/** Compile a string as an async function body. Syntax errors are real defects. */
function compiles(code) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return (async () => { ${code} })`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

export const rules = {
  'R-012': {
    id: 'R-012',
    severity: 'fail',
    statement:
      'A code-carrying prop is the object {_mode:"code", _code:"..."}. Stored as a bare JS ' +
      'string it is silently stripped on save, so the behaviour vanishes with no error.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        for (const key of CODE_MODE_KEYS) {
          const v = node[key];
          if (typeof v !== 'string' || v.trim() === '') continue;
          if (CODE_SHAPED.test(v)) {
            out.push({
              message: `${node.type} "${node.componentName || node.id}" ${key} holds a code-looking raw string — code props must be {_mode:"code",_code:"..."} or they are stripped on save`,
              fixPointer: `${path}/${key}`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-013': {
    id: 'R-013',
    severity: 'fail',
    statement:
      'Every embedded script string compiles as an async function body, carries no smart ' +
      'quotes, and has no unescaped newlines. Template literals parse but are the usual source ' +
      'of JSON breakage, so they warn.',
    check(markup) {
      const out = [];
      const consider = (code, where, label) => {
        if (typeof code !== 'string' || code.trim() === '') return;
        const smart = code.match(/[‘’“”]/);
        if (smart) {
          out.push({
            message: `${label} contains a smart quote (${JSON.stringify(smart[0])}) — it will not parse as JS`,
            fixPointer: where,
          });
        }
        const r = compiles(code);
        if (!r.ok) {
          out.push({ message: `${label} does not compile as an async function body: ${r.error}`, fixPointer: where });
        }
        if (/`/.test(code)) {
          out.push({
            severity: 'warn',
            message: `${label} uses a template literal — these parse but are the usual source of JSON escaping breakage; prefer string concatenation`,
            fixPointer: where,
          });
        }
      };

      // formSettings-level lifecycle scripts.
      const fs = markup?.formSettings || {};
      for (const key of CODE_KEYS) {
        if (typeof fs[key] === 'string') consider(fs[key], `formSettings/${key}`, `formSettings.${key}`);
      }

      for (const { node, path } of allComponents(markup)) {
        const label = `${node.type} "${node.componentName || node.id}"`;
        for (const key of CODE_KEYS) {
          const v = node[key];
          if (typeof v === 'string') consider(v, `${path}/${key}`, `${label} ${key}`);
          else if (isCodeMode(v)) consider(v._code, `${path}/${key}/_code`, `${label} ${key}`);
        }
        for (const key of CODE_MODE_KEYS) {
          const v = node[key];
          if (isCodeMode(v)) consider(v._code, `${path}/${key}/_code`, `${label} ${key}`);
        }
      }
      return out;
    },
  },

  'R-023': {
    id: 'R-023',
    severity: 'warn',
    statement:
      'globalState is not a cross-form state channel — use contexts.appContext for app-wide ' +
      'state or pageContext between pages. Writes to globalState do not propagate the way ' +
      'authors expect.',
    check(markup) {
      const out = [];
      const seen = new Set();
      const scan = (s, where, label) => {
        if (typeof s !== 'string') return;
        if (!/globalState\s*(\.|\[)/.test(s)) return;
        // Only writes are a defect; a read is merely legacy.
        const write = /globalState\s*(\.\w+|\[[^\]]+\])\s*=[^=]/.test(s) || /setGlobalState\s*\(/.test(s);
        const key = `${label}|${write}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          message: `${label} ${write ? 'writes to' : 'reads'} globalState — use contexts.appContext (app-wide) or pageContext (between pages)`,
          fixPointer: where,
        });
      };
      const fs = markup?.formSettings || {};
      for (const key of CODE_KEYS) if (typeof fs[key] === 'string') scan(fs[key], `formSettings/${key}`, `formSettings.${key}`);
      for (const { node, path } of allComponents(markup)) {
        for (const { path: p, value } of ownStrings(node)) {
          scan(value, `${path}/${p}`, `${node.type} "${node.componentName || node.id}" ${p}`);
        }
      }
      return out;
    },
  },

  'R-024': {
    id: 'R-024',
    severity: 'warn',
    statement:
      'API calls in embedded scripts use await inside try/catch, never .then() chains. An ' +
      'unhandled rejection in a form script fails silently and leaves the form in a half state.',
    check(markup) {
      const out = [];
      const scan = (code, where, label) => {
        if (typeof code !== 'string' || !/\bhttp\s*\.\s*(get|post|put|delete|patch)/.test(code)) return;
        if (/\.\s*then\s*\(/.test(code)) {
          out.push({
            message: `${label} chains .then() on an http call — use await inside try/catch`,
            fixPointer: where,
          });
        }
        if (!/\btry\b/.test(code)) {
          out.push({
            message: `${label} calls http.* with no try/catch — a rejection fails silently`,
            fixPointer: where,
          });
        }
        if (/\bhttp\s*\.\s*(get|delete)\s*\([^)]*,\s*\{/.test(code)) {
          out.push({
            severity: 'warn',
            message: `${label} passes an options object to http.get/delete — params are dropped by the framework; put query args in the URL string [R-038]`,
            fixPointer: where,
          });
        }
      };
      const fs = markup?.formSettings || {};
      for (const key of CODE_KEYS) if (typeof fs[key] === 'string') scan(fs[key], `formSettings/${key}`, `formSettings.${key}`);
      for (const { node, path } of allComponents(markup)) {
        const label = `${node.type} "${node.componentName || node.id}"`;
        for (const key of CODE_KEYS) {
          const v = node[key];
          if (typeof v === 'string') scan(v, `${path}/${key}`, `${label} ${key}`);
          else if (isCodeMode(v)) scan(v._code, `${path}/${key}/_code`, `${label} ${key}`);
        }
      }
      return out;
    },
  },

  'R-038': {
    id: 'R-038',
    severity: 'warn',
    statement:
      'Execute Script actions must return a Promise, and http.get(url, {params}) silently drops ' +
      'its params — query arguments belong in the URL string. This is the checkable half; the ' +
      'scope rules (formArguments/selectedRows absent) are documented via explain.',
    check(markup) {
      const out = [];
      const scan = (code, where, label) => {
        if (typeof code !== 'string' || code.trim() === '') return;
        // An IIFE swallows the promise the action layer needs to await.
        if (/^\s*\(\s*(async\s*)?\(\s*\)\s*=>/.test(code) || /^\s*\(\s*function\s*\(/.test(code)) {
          out.push({
            message: `${label} wraps its body in an IIFE — an Execute Script action must return the Promise, not fire and forget`,
            fixPointer: where,
          });
        }
      };
      for (const { node, path } of allComponents(markup)) {
        const a = node.actionConfiguration;
        if (!a || a.actionName !== 'Execute Script') continue;
        const args = a.actionArguments || {};
        for (const key of ['expression', 'actionScript', 'script']) {
          if (typeof args[key] === 'string') {
            scan(args[key], `${path}/actionConfiguration/actionArguments/${key}`, `${node.type} "${node.componentName || node.id}" ${key}`);
          }
        }
      }
      return out;
    },
  },
};
