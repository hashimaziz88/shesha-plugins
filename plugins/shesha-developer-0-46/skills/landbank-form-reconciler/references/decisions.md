# Owner decisions and boundaries

Decisions from the repo owner during the 0.46 reconciliation. Newer entries win; superseded ones are kept so the
history of a reversal is visible.

| Date | Decision |
|---|---|
| 2026-10-01 | Target look: phase2 (0.43) layout with the 0.46 fonts (Inter). |
| 2026-10-01 | Mine forms from the APIs; push nothing to deployed environments. Later: push to the LOCAL 0.46 backend only, per batch. |
| 2026-10-01 | Drive the browser visibly (Claude in Chrome) for owner-facing checks. |
| 2026-10-01 | Labels: the core team knows the bug and ships `labelCol 8` (labels disappearing in subforms); fix locally for now. |
| 2026-10-02 | Prefer global (configuration-level) changes; mass per-form fixes only after a fix is proven on individual forms (every touched form must be re-exported). |
| 2026-10-02 | No framework or app-level CSS (adminportal `globals.css` reverted). Configuration level only: theme settings, form configuration, per-component settings, negative margins/paddings. |
| 2026-10-02 | Container min-height batch (from the 0.46 defaults) reverted; minimum heights now only where phase2 had none. |
| 2026-10-02 | **No hidden stylesheet components.** Use each component's own settings ("fix the css per component", "use the actual appearance settings"). Supersedes the scoped-stylesheet pilot. |
| 2026-10-02 | The layout does not have to match phase2 exactly; it must look similar, neat, inline, well spaced and aligned. |
| 2026-10-02 | Multi-line labels: put them in their own containers (text label + field without label). The core team will not ship a label-height fix. |
| 2026-10-02 | Subform `labelCol 10` (instead of 8); Client Titles label right-aligned like the others. |
| 2026-10-02 | Empty-label buttons in Client Info: keep them (may be needed for functionality) but not visible. |
| 2026-10-02 | Order of work: visual issues first (sweep all pages, pilot, assess, roll out), then functionality. Then push the plugin and update this skill. |

## Standing boundaries

- Never write to phase2 or the 0-46-upgrade environment.
- Never create Azure DevOps work items; findings that need one are described for the PM to triage.
- Never restart or rebuild the backend; ask the owner.
- Never publish, export or hand-build a `.shaconfig`; never commit local-only config.
- The shesha-plugins repository is public: nothing LandBank-specific goes there; this skill lives in landbankcrm.
