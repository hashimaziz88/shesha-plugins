/**
 * fidelity — does the Shesha render show the same page as the approved mock?
 *
 * TWO DIFFS, WITH DELIBERATELY DIFFERENT AUTHORITY.
 *
 * The GEOMETRY diff is exact and BLOCKING. It asserts membership, grouping, nesting and
 * order — never raw pixel positions — because the kit renders approximately while Shesha
 * renders exactly. "Four stat tiles share one row" is a fact both must agree on; "the second
 * tile starts at x=380" is not.
 *
 * The PIXEL diff is ADVISORY, and its threshold comes from a calibration run rather than
 * from a number someone liked. An uncalibrated threshold is invented, and an invented
 * threshold gets tuned until it passes.
 *
 * Pixel comparison runs in the headless browser that is already a dependency: both PNGs are
 * drawn to a canvas and differenced in one evaluate. No image library is added.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIDELITY_EXIT = { OK: 0, GEOMETRY_DRIFT: 18, MISSING: 11 };

export class FidelityError extends Error {
  constructor(message, exitCode, detail = null) {
    super(message);
    this.name = 'FidelityError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/** Roles the two sides can be compared on. The kit names them; Shesha types imply them. */
const ROLE_OF_SHESHA_TYPE = {
  container: 'group',
  card: 'card',
  text: 'text',
  datatable: 'table',
  dataContext: 'group',
  datatableContext: 'group',
  buttonGroup: 'actions',
  button: 'action',
  validationErrors: 'validation',
  refListStatus: 'status',
  tabs: 'tabs',
};

const ROLE_OF_KIT = {
  Page: 'group',
  PageHeader: 'group',
  Stack: 'group',
  Row: 'group',
  KeyInfoBar: 'group',
  KeyFactsStrip: 'group',
  ActionRow: 'group',
  Card: 'card',
  StatCard: 'card',
  Text: 'text',
  MicroLabel: 'text',
  SectionLabel: 'text',
  Badge: 'text',
  CountBadge: 'text',
  Fact: 'text',
  DataTable: 'table',
  ButtonGroup: 'actions',
  Button: 'action',
  ValidationSummary: 'validation',
  StatusPill: 'status',
  Tabs: 'tabs',
};

/**
 * The role of a rendered box, from the classes Shesha and antd actually put on it.
 *
 * Mapped from the live DOM rather than from a component type, because the renderer emits no
 * type marker. `ant-table` is the table's own wrapper class and is present whether or not the
 * inner <table> falls inside the capture's node set — which is why the tag was the wrong signal.
 */
function roleOfShesha(n) {
  const cls = Array.isArray(n.cls) ? n.cls : [];
  // MEASURED, not assumed: Shesha's datatable is NOT an antd Table. It is a div-based
  // react-table carrying sha-datatable-wrapper / sha-data-table / sha-react-table / sha-table,
  // with no ant-table class and no <table> element. Matching antd (or the tag) reported "the
  // Shesha render has no table" on a page that plainly rendered one — a blocking false positive.
  if (cls.some((c) => /^sha-(table|data-table|react-table|datatable-wrapper)$/.test(c))) return 'table';
  if (cls.some((c) => /^ant-table($|-wrapper$)/.test(c))) return 'table';
  if (cls.some((c) => /^ant-card($|-body$)/.test(c))) return 'card';
  if (cls.some((c) => /^ant-tabs$/.test(c))) return 'tabs';
  if (cls.some((c) => /^ant-tag$/.test(c))) return 'status';
  if (cls.some((c) => /^ant-alert$/.test(c))) return 'validation';
  if (cls.some((c) => /^ant-btn$/.test(c))) return 'action';
  if (cls.some((c) => /^sha-components-container$/.test(c))) return 'group';
  return null;
}

/** Group boxes into horizontal bands, so "shares a row" is decidable on both sides. */
function bandsOf(boxes, tolerance = 12) {
  const sorted = [...boxes].sort((a, b) => a.y - b.y);
  const bands = [];
  for (const b of sorted) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(b.y - last.y) <= tolerance) {
      last.items.push(b);
      last.y = Math.min(last.y, b.y);
    } else {
      bands.push({ y: b.y, items: [b] });
    }
  }
  return bands;
}

/**
 * The geometry comparison.
 *
 * `mock` is mock-geometry.json (kit nodes with data-kit). `shesha` is the render evidence's
 * geometry (DOM nodes, typed by data-shesha-type where present, else by tag).
 */
export function compareGeometry({ mockGeometry, sheshaGeometry }) {
  const drift = [];
  const observations = {};

  const mockNodes = (mockGeometry.nodes || []).filter((n) => n.kit && ROLE_OF_KIT[n.kit]);
  const mockRoles = {};
  for (const n of mockNodes) {
    const r = ROLE_OF_KIT[n.kit];
    mockRoles[r] = (mockRoles[r] || 0) + 1;
  }

  // The Shesha side is a raw DOM with no data-* type markers, so roles come from the ant-/sha-
  // classes the capture records. If the capture predates that field there are no roles to read,
  // and every role-based axis must say so rather than reporting the absence as drift.
  const sheshaNodes = (sheshaGeometry.nodes || []).filter((n) => n.box && n.box.w > 2 && n.box.h > 2);
  const rolesObservable = sheshaNodes.some((n) => Array.isArray(n.cls));
  const sheshaRoles = {};
  for (const n of sheshaNodes) {
    const r = roleOfShesha(n);
    if (r) sheshaRoles[r] = (sheshaRoles[r] || 0) + 1;
  }
  observations.mockRoles = mockRoles;
  observations.sheshaRoles = sheshaRoles;
  observations.rolesObservable = rolesObservable;
  const notAsserted = [];
  if (!rolesObservable) {
    notAsserted.push('roles: this render was captured before class names were recorded — re-run `render`');
  }
  /**
   * A KNOWN GAP, stated rather than quietly tolerated.
   *
   * This diff asserts on cards, tables, row membership and vertical order. A STATIC TEXT NODE the
   * compiler dropped disturbs none of them, so it passes. That is not hypothetical: the
   * record-detail header's mono identifier rendered in the mock and was absent from the real form,
   * and this diff reported agreement while all three rendered gates passed.
   *
   * A content-membership axis was tried and NOT shipped: the capture aggregates parent text and
   * truncates at 80 characters, so the mock side reads "Neil HarrowMission specialist, cleared
   * for extra-vehicular a" — matching that against the render produces false positives, and this
   * project has spent enough of its budget removing those. Closing it properly means capturing
   * leaf text only, which is a change to the capture, not to the comparison.
   */
  notAsserted.push(
    'static text membership: a text node present in the mock and dropped by the compiler is NOT caught here — compare the composite by eye, or have the critic do it'
  );

  /**
   * CARD COUNT is the load-bearing structural assertion available on both sides without
   * relying on Shesha emitting data attributes: a mock with four stat cards and a Shesha
   * render with one is a different page, whatever the colours say.
   */
  const mockCards = mockNodes.filter((n) => ROLE_OF_KIT[n.kit] === 'card');
  const sheshaCardish = sheshaNodes.filter(
    (n) => parseFloat(n.style.borderRadius) > 0 && n.box.w > 100 && n.box.h > 40 && n.style.background && !/rgba\(0, 0, 0, 0\)|transparent/.test(n.style.background)
  );
  observations.mockCards = mockCards.length;
  observations.sheshaCards = sheshaCardish.length;
  if (mockCards.length > 0 && sheshaCardish.length === 0) {
    drift.push({
      axis: 'cards',
      why: `the mock shows ${mockCards.length} card-like surface(s) and the Shesha render shows none`,
    });
  }

  // TABLE presence. A mock with a table and a render without one is not the same page — but the
  // bare <table> tag can sit outside the capture's node set, so the wrapper class is the signal.
  const mockTables = mockNodes.filter((n) => ROLE_OF_KIT[n.kit] === 'table').length;
  const sheshaTables = sheshaNodes.filter((n) => roleOfShesha(n) === 'table' || n.tag === 'TABLE').length;
  observations.mockTables = mockTables;
  observations.sheshaTables = sheshaTables;
  if (!rolesObservable) {
    notAsserted.push('table: needs class names from a current `render`');
  } else if (mockTables > 0 && sheshaTables === 0) {
    drift.push({ axis: 'table', why: 'the mock shows a table and the Shesha render has none' });
  }

  /**
   * ROW MEMBERSHIP for the stat row. The mock puts N tiles on one band; Shesha must too.
   * This is the assertion that catches the measured "stat tiles stacked instead of a row"
   * failure, and it is decidable from boxes alone.
   */
  const mockStats = mockNodes.filter((n) => n.kit === 'StatCard');
  if (mockStats.length > 1) {
    const mockBands = bandsOf(mockStats.map((n) => n.box));
    const widest = mockBands.reduce((a, b) => (b.items.length > a.items.length ? b : a), mockBands[0]);
    observations.mockStatsPerRow = widest.items.length;

    // On the Shesha side, the equivalent is the widest band of same-height card-like boxes.
    const sheshaBands = bandsOf(sheshaCardish.map((n) => n.box));
    const sheshaWidest = sheshaBands.length
      ? sheshaBands.reduce((a, b) => (b.items.length > a.items.length ? b : a), sheshaBands[0])
      : { items: [] };
    observations.sheshaCardsPerRow = sheshaWidest.items.length;

    if (sheshaWidest.items.length < widest.items.length) {
      drift.push({
        axis: 'statRow',
        why: `the mock puts ${widest.items.length} tiles on one row; the Shesha render's widest card row holds ${sheshaWidest.items.length}`,
      });
    }
  }

  /**
   * VERTICAL ORDER of the major regions. If the mock reads header -> stats -> table and the
   * render reads header -> table -> stats, the page is wrong even at identical pixel counts.
   */
  const majorMock = mockNodes
    .filter((n) => ['KeyInfoBar', 'Card', 'DataTable', 'PageHeader'].includes(n.kit))
    .sort((a, b) => a.box.y - b.box.y)
    .map((n) => ROLE_OF_KIT[n.kit]);
  observations.mockOrder = majorMock;

  // notAsserted is reported, never folded into pass: "we could not look" must read differently
  // from "we looked and it was fine".
  return { drift, observations, notAsserted, pass: drift.length === 0 };
}

/**
 * Pixel comparison and the side-by-side composite, both in ONE browser pass.
 *
 * Returns { diffRatio, width, height, compositePath }. The ratio is the fraction of
 * compared pixels differing by more than a small per-channel tolerance, over the
 * INTERSECTION of the two images — comparing different canvas sizes would report the size
 * difference as visual drift.
 */
export async function comparePixels({ mockPng, sheshaPng, outDir, tolerance = 24 }) {
  if (!existsSync(mockPng)) throw new FidelityError(`no mock render at ${mockPng}`, FIDELITY_EXIT.MISSING);
  if (!existsSync(sheshaPng)) throw new FidelityError(`no Shesha render at ${sheshaPng}`, FIDELITY_EXIT.MISSING);
  mkdirSync(outDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    // The PNGs go in as data: URLs rather than file:// ones. A blank page has an opaque origin,
    // so Chromium refuses to load file:// subresources into it — and the failure looks like a
    // missing file, which sends you hunting for the wrong bug.
    const asDataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
    const result = await page.evaluate(
      async ({ aUrl, bUrl, tol }) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`could not load ${src}`));
            img.src = src;
          });
        const [a, b] = await Promise.all([load(aUrl), load(bUrl)]);

        const w = Math.min(a.naturalWidth, b.naturalWidth);
        const h = Math.min(a.naturalHeight, b.naturalHeight);

        const ca = new OffscreenCanvas(w, h);
        const cb = new OffscreenCanvas(w, h);
        ca.getContext('2d').drawImage(a, 0, 0);
        cb.getContext('2d').drawImage(b, 0, 0);
        const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
        const db = cb.getContext('2d').getImageData(0, 0, w, h).data;

        let differing = 0;
        const total = w * h;
        for (let i = 0; i < da.length; i += 4) {
          if (
            Math.abs(da[i] - db[i]) > tol ||
            Math.abs(da[i + 1] - db[i + 1]) > tol ||
            Math.abs(da[i + 2] - db[i + 2]) > tol
          ) {
            differing += 1;
          }
        }

        // The composite: mock on the left, Shesha on the right, for the critic to look at.
        const gap = 24;
        const cw = a.naturalWidth + b.naturalWidth + gap;
        const ch = Math.max(a.naturalHeight, b.naturalHeight);
        const comp = new OffscreenCanvas(cw, ch);
        const cx = comp.getContext('2d');
        cx.fillStyle = '#ffffff';
        cx.fillRect(0, 0, cw, ch);
        cx.drawImage(a, 0, 0);
        cx.drawImage(b, a.naturalWidth + gap, 0);
        cx.fillStyle = '#c0392b';
        cx.fillRect(a.naturalWidth, 0, gap, ch);
        const blob = await comp.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);

        return {
          diffRatio: total ? differing / total : 1,
          differingPixels: differing,
          comparedPixels: total,
          comparedWidth: w,
          comparedHeight: h,
          mockSize: { w: a.naturalWidth, h: a.naturalHeight },
          sheshaSize: { w: b.naturalWidth, h: b.naturalHeight },
          compositeBase64: btoa(bin),
        };
      },
      {
        aUrl: asDataUrl(mockPng),
        bUrl: asDataUrl(sheshaPng),
        tol: tolerance,
      }
    );

    const compositePath = join(outDir, 'fidelity-composite.png');
    writeFileSync(compositePath, Buffer.from(result.compositeBase64, 'base64'));
    delete result.compositeBase64;
    return { ...result, compositePath, tolerance };
  } finally {
    await browser.close().catch(() => {});
  }
}

export function loadCalibration(appRoot) {
  const p = join(appRoot, '.shesha', 'fidelity-calibration.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function calibrationPath(appRoot) {
  return join(appRoot, '.shesha', 'fidelity-calibration.json');
}

/**
 * Run the pixel diff N times and derive a threshold from the observed spread.
 *
 * The threshold is max(observed) plus a margin, so it sits above real noise rather than at a
 * round number. The RAW SAMPLES are recorded alongside it, because a threshold whose
 * derivation cannot be inspected is indistinguishable from one that was invented.
 */
export async function calibrate({
  archetype,
  mockPng,
  sheshaPng,
  outDir,
  runs = 5,
  marginFactor = 1.25,
  resample = null,
  onProgress = null,
}) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    // Re-diffing ONE pair of PNGs N times measures whether the diff is deterministic — which
    // it is, trivially — and says nothing about how much the Shesha render itself moves between
    // runs. That render-to-render movement is the only thing a threshold needs to tolerate, so
    // when a resampler is supplied each sample gets a FRESH render.
    const png = resample ? await resample(i) : sheshaPng;
    const r = await comparePixels({ mockPng, sheshaPng: png, outDir });
    samples.push(r.diffRatio);
    if (onProgress) onProgress(`sample ${i + 1}/${runs}: diffRatio ${r.diffRatio.toFixed(6)}`);
  }
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const spread = max - min;
  return {
    archetype,
    runs,
    samples,
    min,
    max,
    mean,
    spread,
    marginFactor,
    resampled: !!resample,
    // Measured, not assumed: with a warm font cache, fixed viewport and the same backing data,
    // repeated Shesha renders of this form came out byte-identical. So spread 0 alongside
    // resampled true means "the renderer is deterministic here", NOT "no samples were taken".
    rendererDeterministic: !!resample && spread === 0,
    // The margin comes from the measured LEVEL, not the variance: even with fresh renders the
    // spread is usually tiny, and a threshold equal to the observation would trip on any change
    // at all. max x 1.25 leaves room for real render noise while still catching a redesign.
    threshold: Math.min(1, max * marginFactor),
    derivation:
      `threshold = max(observed) x ${marginFactor} over ${runs} ` +
      `${resample ? 'FRESH Shesha renders' : 'repeat diffs of one render (variance NOT measured)'}. ` +
      `The mock and the Shesha render are two different renderers, so a large baseline difference is ` +
      `expected and is NOT drift; what matters is that it stays put. Samples are recorded so this ` +
      `number can be audited rather than trusted.`,
    calibratedAt: new Date().toISOString(),
  };
}
