// Envelope detection (section 2.5 step 1). ONE unwrapper, replacing the three
// disagreeing ones the pre-rebuild repo carried.
//
// Three legal input shapes: the 23-field envelope (has a `Markup` string), a bare
// `{components, formSettings}`, and a bare `components[]`. When the input has no
// envelope, one is synthesised from the 23-field defaults and the result carries
// `provenance: "ENVELOPE-SYNTHESISED"` — which section 3's `file` family treats as
// uninspectable, never as a pass and never as a fail.

/** The provenance flag a synthesised envelope carries. */
export const ENVELOPE_SYNTHESISED = 'ENVELOPE-SYNTHESISED';

export class DetectError extends Error {
  /** @param {string} code @param {string} m */
  constructor(code, m) { super(m); this.name = 'DetectError'; this.code = code; }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/**
 * The 23 envelope fields with their write-time defaults, in the measured
 * production order (section 2.1.2). `Markup` is filled by the caller.
 * @returns {Record<string, unknown>}
 */
export function envelopeDefaults() {
  return {
    Markup: null,
    ModelType: null,
    TemplateId: null,
    IsTemplate: false,
    Access: 4,
    Permissions: [],
    ConfigurationForm: null,
    GenerationLogicTypeName: null,
    GenerationLogicExtensionJson: null,
    PlaceholderIcon: null,
    Id: null,
    OriginId: null,
    Name: null,
    Label: null,
    ItemType: 'form',
    Description: null,
    ModuleName: null,
    FrontEndApplication: null,
    Suppress: false,
    DateUpdated: null,
    BaseModules: [],
    Comments: null,
    ConfigHash: '',
  };
}

/**
 * @typedef {{components:Record<string, unknown>[], formSettings:Record<string, unknown>,
 *            envelope:Record<string, unknown>, provenance:'ENVELOPE'|'ENVELOPE-SYNTHESISED'}} Detected
 */

/**
 * Unwrap any of the three legal shapes to `{components, formSettings, envelope, provenance}`.
 * @param {unknown} input a parsed object, an array, or a JSON string of either
 * @returns {Detected}
 */
export function detect(input) {
  const value = typeof input === 'string' ? JSON.parse(input.replace(/^﻿/, '')) : input;

  // Shape 3: a bare components[] array.
  if (Array.isArray(value)) {
    return synthesise(/** @type {Record<string, unknown>[]} */ (value), {});
  }

  if (!isObj(value)) {
    throw new DetectError('DEC-7101', 'DEC-7101 input is neither an envelope, {components, formSettings}, nor components[]');
  }

  // Shape 1: the 23-field envelope. Recognised by a string `Markup`.
  if (typeof value.Markup === 'string') {
    /** @type {unknown} */
    let markup;
    try { markup = JSON.parse(value.Markup); } catch (e) {
      throw new DetectError('DEC-7102', `DEC-7102 envelope Markup is not valid JSON: ${/** @type {Error} */ (e).message}`);
    }
    if (!isObj(markup) || !Array.isArray(markup.components)) {
      throw new DetectError('DEC-7103', 'DEC-7103 envelope Markup parsed but has no components[]');
    }
    return {
      components: /** @type {Record<string, unknown>[]} */ (markup.components),
      formSettings: isObj(markup.formSettings) ? markup.formSettings : {},
      envelope: value,
      provenance: 'ENVELOPE',
    };
  }

  // Shape 2: a bare {components, formSettings}.
  if (Array.isArray(value.components)) {
    return synthesise(
      /** @type {Record<string, unknown>[]} */ (value.components),
      isObj(value.formSettings) ? value.formSettings : {});
  }

  throw new DetectError('DEC-7101', 'DEC-7101 input is neither an envelope, {components, formSettings}, nor components[]');
}

/**
 * @param {Record<string, unknown>[]} components
 * @param {Record<string, unknown>} formSettings
 * @returns {Detected}
 */
function synthesise(components, formSettings) {
  const envelope = envelopeDefaults();
  // Compact, key order as read — the same convention synthesise-envelope.mjs uses.
  envelope.Markup = JSON.stringify({ components, formSettings });
  return { components, formSettings, envelope, provenance: ENVELOPE_SYNTHESISED };
}
