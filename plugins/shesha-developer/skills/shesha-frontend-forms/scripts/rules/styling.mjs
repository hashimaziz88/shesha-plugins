/**
 * Styling invariants — the ones that are checkable OFFLINE from markup alone.
 *
 * Deliberately absent: any claim about whether a form LOOKS styled. That judgment is a
 * rendered gate (Phase 6, lib/anatomy.mjs). The old stack's offline styledness validator
 * counted emitted style blocks and passed a form at 96% that the critic called nearly
 * unstyled — because seven of its nine style blocks were inert. Counting markup is not
 * measuring appearance, and this module does not pretend otherwise.
 */
import { allComponents, styleBlocks } from '../lib/walk.mjs';

const TEXT_TYPES = new Set(['text', 'paragraph', 'title']);
const BUTTONISH = new Set(['button', 'buttonGroup']);

/**
 * `<type>.<prop>` pairs where an out-of-set value is genuinely DISCARDED, so R-058 blocks.
 *
 * MEASURED, and the measurement went against the first version of this rule. R-058 originally
 * failed on any value outside the harvested set, which produced nine failures across five real
 * forms: containers carrying `justifyContent: space-between` / `flex-end` / `flex-start`,
 * `alignItems: stretch`, and a dataContext with `defaultPageSize: 8`. Rendering one of those forms
 * and reading COMPUTED styles found space-between x6, flex-end x1 and flex-start x363 actually
 * applied — so the framework passes those straight through to CSS and the settings editor's
 * three-item radio (left/center/right) is a UI shortlist, not a validation contract. The same goes
 * for the pageSize dropdown, which lists 5..200 while 8 works fine.
 *
 * Closedness therefore CANNOT be inferred from the settings markup. It is only known where the
 * renderer switches on the value, which has to be established by measurement per prop. This set
 * holds the ones established so far; everything else warns.
 */
const CLOSED_ENUMS = new Set([
  // Measured in Phase 6 (the font channel): the renderer selects a typography component from
  // textType and reads contentDisplay/contentType to decide what to render at all. Wrong or
  // missing values leave desktop.font inert with no error. See also R-059.
  'text.textType',
  'text.contentDisplay',
  'text.contentType',
]);

function hasFlexIntent(block) {
  return (
    block &&
    (block.flexDirection !== undefined ||
      block.justifyContent !== undefined ||
      block.alignItems !== undefined ||
      block.gap !== undefined ||
      block.flexWrap !== undefined)
  );
}

export const rules = {
  'R-028': {
    id: 'R-028',
    severity: 'fail',
    statement:
      'Layout splits are flex children sized by desktop.dimensions.width. The Shesha `columns` ' +
      'component is never used, customStyle:{flex} is ignored, and a style-channel flexShrink ' +
      'never reaches the outer div.',
    check(markup) {
      const out = [];
      for (const { node, path, depth } of allComponents(markup)) {
        if (node.type === 'columns') {
          out.push({
            severity: depth === 0 ? 'fail' : 'warn',
            message: `${depth === 0 ? 'root-level ' : 'nested '}\`columns\` component "${node.componentName || node.id}" — use flex containers with desktop.dimensions.width instead; \`columns\` is excluded from this toolchain by design`,
            fixPointer: path,
          });
        }
        const cs = node.customStyle;
        if (cs && typeof cs === 'object' && cs.flex !== undefined) {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" sets customStyle.flex, which the renderer ignores — size it with desktop.dimensions.width`,
            fixPointer: `${path}/customStyle/flex`,
          });
        }
        for (const { breakpoint, block } of styleBlocks(node)) {
          if (block.flexShrink !== undefined) {
            out.push({
              message: `${node.type} "${node.componentName || node.id}" sets ${breakpoint}.flexShrink, which never reaches the outer div`,
              fixPointer: `${path}/${breakpoint}/flexShrink`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-029': {
    id: 'R-029',
    severity: 'fail',
    statement:
      'A flex container declares display:"flex" explicitly in its desktop block. The 0.45 ' +
      'renderer reads layout from desktop.*, not root-level props — without it ' +
      'justifyContent/alignItems silently do nothing and children stack full-width.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        // Root-level layout props are inert in 0.45; flag them wherever they appear.
        for (const key of ['display', 'flexDirection', 'justifyContent', 'alignItems', 'gap']) {
          if (node[key] !== undefined && node[key] !== null && node[key] !== '') {
            out.push({
              severity: 'warn',
              message: `${node.type} "${node.componentName || node.id}" sets root-level "${key}" — 0.45 reads layout from the desktop block, so this is inert`,
              fixPointer: `${path}/${key}`,
            });
          }
        }
        for (const { breakpoint, block } of styleBlocks(node)) {
          if (hasFlexIntent(block) && block.display !== 'flex') {
            out.push({
              message: `${node.type} "${node.componentName || node.id}" ${breakpoint} block declares flex layout (${Object.keys(block).filter((k) => ['flexDirection', 'justifyContent', 'alignItems', 'gap', 'flexWrap'].includes(k)).join(', ')}) but display is ${JSON.stringify(block.display)} — without display:"flex" these are silently ignored and children stack full-width`,
              fixPointer: `${path}/${breakpoint}/display`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-030': {
    id: 'R-030',
    severity: 'warn',
    statement:
      'The legacy `style` JS-string renders inline and WINS over every breakpoint block. When a ' +
      'stamped property does not render, a truthy `style` on the component or an ancestor is the ' +
      'first thing to look for.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        const s = node.style;
        const truthy = typeof s === 'string' ? s.trim() !== '' : !!s && typeof s === 'object' && s._mode === 'code';
        if (!truthy) continue;
        const hasBlocks = styleBlocks(node).length > 0;
        out.push({
          severity: hasBlocks ? 'fail' : 'warn',
          message:
            `${node.type} "${node.componentName || node.id}" carries a legacy \`style\` string` +
            (hasBlocks
              ? ' AND breakpoint style blocks — the inline style wins, so the blocks are dead'
              : ' — it renders inline and overrides breakpoint blocks on this node and shadows intent for readers'),
          fixPointer: `${path}/style`,
        });
      }
      return out;
    },
  },

  'R-033': {
    id: 'R-033',
    severity: 'warn',
    statement:
      'Field-level labelCol/wrapperCol are ignored — only formSettings.labelCol/wrapperCol apply. ' +
      '(field-level labelAlign IS honoured.) Authoring a dead channel misleads the next reader.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        for (const key of ['labelCol', 'wrapperCol']) {
          if (node[key] !== undefined && node[key] !== null) {
            out.push({
              message: `${node.type} "${node.componentName || node.id}" sets field-level ${key}, which the renderer ignores — only formSettings.${key} applies`,
              fixPointer: `${path}/${key}`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-036': {
    id: 'R-036',
    severity: 'warn',
    statement:
      'refListStatus fill comes ONLY from the reference-list item\'s own colour — no item colour ' +
      'means grey, regardless of solidBackground. Radius comes from desktop.border.radius.all, ' +
      'never customStyle.',
    applies(_ctx, markup) {
      const has = allComponents(markup).some(({ node }) => node.type === 'refListStatus');
      return has ? true : { skip: true, reason: 'no refListStatus in this form' };
    },
    check(markup, ctx) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (node.type !== 'refListStatus') continue;

        if (node.customStyle && typeof node.customStyle === 'object' && node.customStyle.borderRadius !== undefined) {
          out.push({
            message: `refListStatus "${node.componentName || node.id}" sets customStyle.borderRadius — radius comes from desktop.border.radius.all only`,
            fixPointer: `${path}/customStyle/borderRadius`,
          });
        }

        // With live reflist data we can say whether this will actually render grey.
        const refId = node.referenceListId;
        if (ctx.referenceLists && refId && refId.name) {
          const key = `${refId.module || ''}/${refId.name}`;
          const list = ctx.referenceLists[key];
          if (list && Array.isArray(list.items) && list.items.length) {
            const coloured = list.items.filter((i) => i.color && String(i.color).trim() !== '').length;
            if (coloured === 0) {
              out.push({
                message: `refListStatus binds "${key}" whose ${list.items.length} items all have no colour — this renders grey regardless of solidBackground; seed the reference-list item colours to get real pills`,
                fixPointer: `${path}/referenceListId`,
              });
            }
          }
        }
      }
      return out;
    },
  },

  'R-042': {
    id: 'R-042',
    severity: 'fail',
    statement:
      'No form ships unstyled. This is a RENDERED gate owned by lib/anatomy.mjs in Phase 6 — an ' +
      'offline validator cannot judge appearance, which is exactly how the previous stack passed ' +
      'a visually vanilla form at 96%.',
    applies() {
      return { skip: true, reason: 'deferred to Phase 6 (rendered anti-vanilla + anatomy gates); offline markup cannot judge appearance' };
    },
    check() {
      return [];
    },
  },

  'R-052': {
    id: 'R-052',
    severity: 'fail',
    statement:
      'A text component\'s font colour renders ONLY with contentType:"custom". Otherwise antd\'s ' +
      'own presets win and desktop.font.color is a pure no-op — invisible in the markup, and it ' +
      'ships illegible text (light ink on a dark band renders near-black).',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (!TEXT_TYPES.has(node.type)) continue;
        let authored = null;
        for (const { breakpoint, block } of styleBlocks(node)) {
          const c = block.font && block.font.color;
          if (c && String(c).trim() !== '') {
            authored = `${breakpoint}.font.color = ${c}`;
            break;
          }
        }
        if (!authored) continue;
        if (node.contentType !== 'custom') {
          out.push({
            message: `${node.type} "${node.componentName || node.id}" authors ${authored} but contentType is ${JSON.stringify(node.contentType ?? null)} — font colour renders only with contentType:"custom", so this colour is a no-op`,
            fixPointer: `${path}/contentType`,
          });
        }
      }
      return out;
    },
  },

  'R-054': {
    id: 'R-054',
    severity: 'fail',
    statement:
      'A background of type "image" resolves from stored-file paths only. Given a plain url it ' +
      'renders url(null). Show a picture with an `image` component sized via desktop.dimensions.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        for (const { breakpoint, block } of styleBlocks(node)) {
          const bg = block.background;
          if (!bg || typeof bg !== 'object') continue;
          if (bg.type === 'image') {
            const hasFile = bg.storedFile || bg.uploadFile || bg.file;
            if (!hasFile) {
              out.push({
                message: `${node.type} "${node.componentName || node.id}" ${breakpoint}.background is type "image" with no storedFile/uploadFile — this renders url(null); use an \`image\` component instead`,
                fixPointer: `${path}/${breakpoint}/background`,
              });
            }
          }
          // A background without a type is a partial write and is dead.
          if (bg.type === undefined && Object.keys(bg).length > 0) {
            out.push({
              message: `${node.type} "${node.componentName || node.id}" ${breakpoint}.background has no \`type\` — partial background writes do not render`,
              fixPointer: `${path}/${breakpoint}/background/type`,
            });
          }
        }
      }
      return out;
    },
  },

  'R-055': {
    id: 'R-055',
    severity: 'fail',
    statement:
      'An image renders inside an UNSIZED antd ant-image wrapper, so taking the inner img out of ' +
      'flow collapses it to 0x0. Never position:absolute on an image; size it with ' +
      'desktop.dimensions and keep it in flow.',
    applies(_ctx, markup) {
      const has = allComponents(markup).some(({ node }) => node.type === 'image');
      return has ? true : { skip: true, reason: 'no image component in this form' };
    },
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (node.type !== 'image') continue;
        const flag = (where) =>
          out.push({
            message: `image "${node.componentName || node.id}" is positioned absolutely (${where}) — the ant-image wrapper is unsized, so this collapses it to 0x0`,
            fixPointer: `${path}/${where}`,
          });
        if (typeof node.style === 'string' && /position\s*:\s*absolute/i.test(node.style)) flag('style');
        if (node.customStyle && typeof node.customStyle === 'object' && /absolute/i.test(String(node.customStyle.position || ''))) {
          flag('customStyle/position');
        }
        for (const { breakpoint, block } of styleBlocks(node)) {
          if (/absolute/i.test(String(block.position || ''))) flag(`${breakpoint}/position`);
        }
      }
      return out;
    },
  },

  'R-057': {
    id: 'R-057',
    severity: 'fail',
    statement:
      'A buttonGroup with 2+ button items carries isInline:true, or the whole group collapses to ' +
      'an overflow "..." menu. Separate buttons sharing a container need a real flex row on the ' +
      'CONTAINER, because a buttonGroup has no alignment lever of its own.',
    check(markup) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        if (node.type === 'buttonGroup') {
          const items = Array.isArray(node.items) ? node.items.filter((i) => i && i.itemType !== 'group') : [];
          if (items.length >= 2 && node.isInline !== true) {
            out.push({
              message: `buttonGroup "${node.componentName || node.id}" has ${items.length} items but isInline is not true — the whole group collapses to an overflow "..." menu`,
              fixPointer: `${path}/isInline`,
            });
          }
        }

        // A container holding 2+ action components needs an explicit flex row.
        const kids = Array.isArray(node.components) ? node.components : [];
        const actionKids = kids.filter((k) => k && BUTTONISH.has(k.type));
        if (actionKids.length >= 2) {
          const desktop = node.desktop || {};
          const isRow = desktop.display === 'flex' && (desktop.flexDirection === 'row' || desktop.flexDirection === undefined);
          if (desktop.display !== 'flex') {
            out.push({
              message: `container "${node.componentName || node.id}" holds ${actionKids.length} action components but desktop.display is not "flex" — they will stack one per line`,
              fixPointer: `${path}/desktop/display`,
            });
          } else if (!isRow) {
            out.push({
              message: `container "${node.componentName || node.id}" holds ${actionKids.length} action components with desktop.flexDirection "${desktop.flexDirection}" — an action row is a row`,
              fixPointer: `${path}/desktop/flexDirection`,
            });
          }
        }
      }
      return out;
    },
  },

  /**
   * R-058 — enum-valued props carry a legal value.
   *
   * The legal sets are HARVESTED, not listed: probe walks each type's own settings-form markup
   * and records the choices its dropdown/radio editors offer. 700 enum props across 116 types,
   * 697 with static values. A hand-typed table would be stale by the next release, and a
   * compiler validating against a stale table is worse than one validating nothing.
   *
   * Why this is worth a rule: an illegal enum value does not throw. The renderer falls back to
   * a default, so the form loads, looks plausible, and quietly ignores what was authored — the
   * same dead-channel failure as the font bug, which cost a full render cycle to find. This
   * catches it offline in milliseconds.
   */
  'R-058': {
    id: 'R-058',
    severity: 'warn',
    statement:
      'A prop whose settings editor offers a fixed choice list carries one of that list\'s values. ' +
      'FAIL only where the renderer is known to SWITCH on the value, so an out-of-set value is ' +
      'discarded; a warning everywhere else, because an editor\'s option list is a UI shortlist ' +
      'and many props are passed straight through to CSS.',
    applies(ctx) {
      return ctx.registry
        ? true
        : { skip: true, reason: 'needs the ground-truth registry (run probe first)' };
    },
    check(markup, ctx) {
      const out = [];
      for (const { node, path } of allComponents(markup)) {
        const def = ctx.registry[node.type];
        // An unknown type is R-003's finding, not this one's.
        if (!def) continue;
        const propTypes = (def.settings && def.settings.propTypes) || null;
        if (!propTypes) continue;

        for (const [prop, spec] of Object.entries(propTypes)) {
          if (spec.type !== 'enum' || !Array.isArray(spec.values) || spec.values.length === 0) {
            // `dynamic` enums are bound to a reference list, so the markup cannot show us the
            // legal set. Asserting against an unknown set is how false positives get shipped.
            continue;
          }
          // Only top-level props: a dotted path like validate.required is a nested object here
          // and resolving it would need the same path walk the compiler uses. Recorded as a gap.
          if (prop.includes('.')) continue;
          if (!Object.prototype.hasOwnProperty.call(node, prop)) continue;

          const raw = node[prop];
          if (raw === null || raw === undefined || raw === '') continue;
          // A JS-setting expression is evaluated at runtime; its value is not knowable here.
          if (typeof raw === 'object') continue;

          const value = String(raw);
          if (spec.values.includes(value)) continue;

          const closed = CLOSED_ENUMS.has(`${node.type}.${prop}`);
          out.push({
            severity: closed ? 'fail' : 'warn',
            message: closed
              ? `${node.type} "${node.componentName || node.id}" sets ${prop}="${value}", which is not one of ` +
                `${spec.values.map((v) => (v === '' ? '""' : v)).join(', ')}. The renderer switches on this ` +
                `prop, so an unrecognised value is discarded and the authored intent vanishes without an error.`
              : `${node.type} "${node.componentName || node.id}" sets ${prop}="${value}", which its settings ` +
                `editor does not offer (${spec.values.map((v) => (v === '' ? '""' : v)).join(', ')}). That list ` +
                `is a UI shortlist, not a contract — many props pass straight through to CSS — so verify it ` +
                `renders rather than assuming either way.`,
            fixPointer: `${path}/${prop}`,
          });
        }
      }
      return out;
    },
  },

  /**
   * R-059 — the text content contract.
   *
   * MINED, not reasoned: `desktop.font.*` on a text component was inert until textType,
   * contentDisplay and contentType were all present alongside content. Setting the font block
   * alone produced a form that passed every offline gate and rendered unstyled text — the
   * defect that took Phase 6 from FAIL to PASS once the three keys were emitted together.
   *
   * The compiler now always emits them, so this rule exists to catch a REGRESSION in the
   * compiler or a hand-edited form, which is exactly what a rule is for.
   */
  'R-059': {
    id: 'R-059',
    severity: 'fail',
    statement:
      'A text component that carries content also carries textType, contentDisplay and ' +
      'contentType. Without all three the font channel is inert: the text renders at framework ' +
      'defaults and every authored typography value is discarded silently.',
    check(markup) {
      const out = [];
      const REQUIRED = ['textType', 'contentDisplay', 'contentType'];
      for (const { node, path } of allComponents(markup)) {
        if (node.type !== 'text') continue;
        const hasContent = typeof node.content === 'string' && node.content !== '';
        if (!hasContent) continue;

        const missing = REQUIRED.filter(
          (k) => node[k] === undefined || node[k] === null || node[k] === ''
        );
        if (missing.length) {
          out.push({
            message:
              `text "${node.componentName || node.id}" sets content but omits ${missing.join(', ')} — ` +
              `the font channel stays inert and the authored typography is dropped without an error`,
            fixPointer: `${path}/${missing[0]}`,
          });
        }
      }
      return out;
    },
  },
};
