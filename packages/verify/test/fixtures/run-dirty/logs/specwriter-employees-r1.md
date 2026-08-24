# specwriter · employees · round 1 (DIRTY — mutation-harness fixture only)

This log is the negative control for g-specwriter-purity. It carries markup
fingerprints a spec author must never leak into a run log, because a log that quotes
compiled markup means the author was reading the markup instead of the IR (§4.1.1).

Leaked fragment (this is the violation the gate catches):

```json
{ "type": "datatable", "version": 8, "parentId": "root", "componentName": "table1",
  "desktop": { "stylingBox": "{}" }, "_type":"action-config" }
```

Nothing here should ever match a real specwriter log; this file exists only so the
mutation harness can point the gate at it and confirm the gate fails.
