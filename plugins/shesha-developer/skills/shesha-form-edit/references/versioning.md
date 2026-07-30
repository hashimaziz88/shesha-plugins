# Versioning — what this 0.45-only plugin keeps

This plugin targets **Shesha 0.45 exclusively**. 0.43 authoring (BoxStack flat
style props, `datatableContext` wrappers, versioned ConfigurationItem
lifecycle) lives in the `shesha-developer-0-43` plugin — never here.

The version facts that still matter on 0.45:

- **Component versions** [R-003, R-049]: every authored component carries its
  type's current integer `version` from `assets/components-kb/_index.json`
  (regenerated from the target release's source — see `_meta.json` for the
  pinned commit). No version → legacy read-only render path or a migration
  throw; a stale version silently drops the whole `desktop` style block.
  Versions drift across point releases — when exactness matters, copy from a
  live form on the target backend.
- **Form mutability**: 0.45 test builds use mutable forms — bare
  `PUT FormConfiguration/UpdateMarkup` works, `UpdateStatus` may 404, and
  `GetJson` returns the markup object directly (no `.result` envelope).
- **Detecting a foreign backend**: a `versionStatus` field on
  `FormConfiguration/GetByName` responses marks a versioned (0.43-class)
  backend — that work belongs to the 0-43 plugin; hand it off rather than
  adapting markup here.
- **Rerunning ground truth for a new 0.45.x release**: `references/gym.md` has
  the procedure (regenerate KB from the release source → extract enums →
  regenerate gym → measure → merge).
