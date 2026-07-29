import * as fs from 'fs';
import * as path from 'path';
import { getComponentDefinitions } from '@/providers/form/defaults/toolboxComponents';
import { makeFormBuliderFactory } from '@/form-factory/implementation';
import { Migrator } from '@/utils/fluentMigrator/migrator';

/** Recursively collect every `propertyName` in a settings-form markup tree. */
function collectPropertyNames(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectPropertyNames(n, out);
    return;
  }
  if (typeof node.propertyName === 'string' && node.propertyName.length > 0) {
    out.add(node.propertyName);
  }
  // Settings forms nest leaves through a variety of structural keys depending
  // on the component (`components`, `columns`, `tabs`, `content`, `header`,
  // `items`, and critically `inputs` for settingsInputRow/settingsInput — the
  // home of the dimensions/border/background/shadow surface). Rather than
  // enumerate keys (which silently under-extracts the moment a settings form
  // is refactored to nest one level deeper), walk every array- or
  // object-valued child generically. `node.propertyName` above is the only
  // thing we harvest, so descending into value payloads (e.g. dropdown
  // `options`, `validate` blocks) is safe — it never invents props unless a
  // node genuinely carries a non-empty string `propertyName`.
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') collectPropertyNames(value, out);
  }
}

describe('component registry extraction', () => {
  it('extracts every registered component', () => {
    // `getComponentDefinitions()` takes no arguments and returns every registered
    // component, Dev group included (verified: the extraction yields `settingsInput`,
    // `searchableTabs` etc.). Do NOT confuse it with `getToolboxComponents(devMode, …)`,
    // which filters by devMode — that is the designer's UI path, not ours.
    const defs = getComponentDefinitions();
    const fbf = makeFormBuliderFactory();

    const components: Record<string, any> = {};
    let settingsOk = 0;
    let settingsFail = 0;

    for (const [type, def] of defs.entries()) {
      const props = new Set<string>();
      try {
        const markup =
          typeof def.settingsFormMarkup === 'function'
            ? (def.settingsFormMarkup as any)({ fbf })
            : def.settingsFormMarkup;
        if (markup) collectPropertyNames(markup, props);
        settingsOk++;
      } catch (e) {
        // Record the failure rather than aborting the whole extraction — one
        // broken settings form must not cost us the other 115 components.
        settingsFail++;
        // eslint-disable-next-line no-console
        console.warn(`settingsFormMarkup failed for ${type}: ${(e as Error).message}`);
      }

      let version: number | undefined;
      try {
        version = def.migrator ? def.migrator(new Migrator() as any)?.lastVersion : undefined;
      } catch (e) {
        version = undefined;
        // eslint-disable-next-line no-console
        console.warn(`migrator failed for ${type}: ${(e as Error)?.stack ?? e}`);
      }

      components[type] = {
        name: (def as any).name ?? type,
        group: (def as any).group ?? null,
        isInput: (def as any).isInput === true,
        isOutput: (def as any).isOutput === true,
        isHidden: (def as any).isHidden === true,
        version,
        propsCount: props.size,
        props: [...props],
        customContainerNames: (def as any).customContainerNames ?? [],
      };
    }

    const out = {
      summary: { totalTypes: defs.size, settingsOk, settingsFail },
      components,
    };

    const target = process.env.SHESHA_REGISTRY_OUT;
    if (!target) throw new Error('SHESHA_REGISTRY_OUT is not set');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');

    // Sanity guards. 100 is a deliberate floor, not the expected count — the
    // exact count is asserted in the plugin's acceptance test (Task 6), which
    // is the right place for it, because that is where a drop should fail CI.
    expect(defs.size).toBeGreaterThan(100);
    expect(settingsFail).toBe(0);
  });
});
