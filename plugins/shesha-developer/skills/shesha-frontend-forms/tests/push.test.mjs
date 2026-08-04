/**
 * Phase 5 contract tests — the ledger, the canonical diff, and the Stop gate.
 *
 * The live push is exercised against a real backend by hand (documented in the commit); these
 * tests cover the parts that must hold without one, and they are deliberately adversarial:
 * every gate here is asserted to FIRE, because a gate that cannot be shown to block is
 * decoration.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as ledger from '../scripts/lib/ledger.mjs';
import { canonical, diffCanonical } from '../scripts/lib/push.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'shesha-ledger-'));
  return {
    dir,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a leftover temp dir is not worth failing a test over */
      }
    },
  };
}

function artefact(dir, name = 'a.json') {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify({ evidence: true }), 'utf8');
  return p;
}

// =====================================================================================
describe('the canonical diff', () => {
  it('treats re-ordered KEYS as equal, because the server does not preserve order', () => {
    const a = { formSettings: { layout: 'vertical', colon: false }, components: [] };
    const b = { components: [], formSettings: { colon: false, layout: 'vertical' } };
    assert.deepEqual(diffCanonical(a, b), []);
  });

  it('treats null and absent as equal, because the server normalises them', () => {
    const a = { x: 1, y: null, nested: { z: null } };
    const b = { x: 1, nested: {} };
    assert.deepEqual(diffCanonical(a, b), []);
  });

  it('treats ARRAY order as significant, because components render in order', () => {
    const a = { components: [{ id: 'a' }, { id: 'b' }] };
    const b = { components: [{ id: 'b' }, { id: 'a' }] };
    const d = diffCanonical(a, b);
    assert.ok(d.length > 0, 'a reordered component array must be a difference');
  });

  it('catches a value the server rewrote', () => {
    const d = diffCanonical({ version: 8 }, { version: 1 });
    assert.equal(d.length, 1);
    assert.equal(d[0].kind, 'value-changed');
    assert.equal(d[0].sent, 8);
    assert.equal(d[0].got, 1);
  });

  it('catches a field the server dropped and one it added', () => {
    const dropped = diffCanonical({ keep: 1, gone: 'x' }, { keep: 1 });
    assert.equal(dropped[0].kind, 'dropped-by-server');
    const added = diffCanonical({ keep: 1 }, { keep: 1, extra: 'y' });
    assert.equal(added[0].kind, 'added-by-server');
  });

  it('catches a changed component count, which a length check alone would miss per-item', () => {
    const d = diffCanonical({ components: [{ id: 'a' }, { id: 'b' }] }, { components: [{ id: 'a' }] });
    assert.ok(d.some((x) => x.kind === 'length-changed'));
  });

  it('canonicalises a forgotten stringify into a visible type change', () => {
    // The UpdateMarkup DTO double-encodes markup. Forgetting JSON.stringify silently fails
    // or corrupts, and this is the shape that catches it.
    const d = diffCanonical({ markup: { a: 1 } }, { markup: '{"a":1}' });
    assert.ok(d.some((x) => x.kind === 'type-changed'), JSON.stringify(d));
  });

  it('drops undefined rather than reporting it, so canonical output is comparable', () => {
    assert.equal(canonical(undefined), undefined);
    assert.deepEqual(canonical({ a: 1, b: undefined }), { a: 1 });
  });
});

// =====================================================================================
describe('the ledger: no status without an artefact', () => {
  it('refuses a status that claims verification with no artefact', () => {
    const s = scratch();
    try {
      // The previous corpus held exactly one `verified` write in 1,274 tool calls, naming a
      // form from an unrelated run. A status with nothing behind it reads as assurance.
      assert.throws(
        () => ledger.record(s.dir, { form: 'm/n', status: 'verified', runId: 'r1' }),
        /requires an artefact/
      );
      assert.throws(
        () => ledger.record(s.dir, { form: 'm/n', status: 'pushed', runId: 'r1', artefact: join(s.dir, 'nope.json') }),
        /does not exist on disk/
      );
    } finally {
      s.cleanup();
    }
  });

  it('requires a runId, so a status cannot borrow an older run\'s evidence', () => {
    const s = scratch();
    try {
      assert.throws(() => ledger.record(s.dir, { form: 'm/n', status: 'authored', artefact: artefact(s.dir) }), /runId/);
    } finally {
      s.cleanup();
    }
  });

  it('rejects a form that is not module/name, and an unknown status', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      assert.throws(() => ledger.record(s.dir, { form: 'noslash', status: 'authored', artefact: a, runId: 'r' }), /module>\/</);
      assert.throws(() => ledger.record(s.dir, { form: 'm/n', status: 'invented', artefact: a, runId: 'r' }), /unknown status/);
    } finally {
      s.cleanup();
    }
  });

  it('accepts abandoned without an artefact, because giving up needs no evidence', () => {
    const s = scratch();
    try {
      const row = ledger.record(s.dir, { form: 'm/n', status: 'abandoned', runId: 'r', note: 'why' });
      assert.equal(row.status, 'abandoned');
      assert.equal(row.artefact, null);
    } finally {
      s.cleanup();
    }
  });

  it('hashes the artefact, so a later swap is detectable', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      const row = ledger.record(s.dir, { form: 'm/n', status: 'authored', artefact: a, runId: 'r' });
      assert.match(row.artefactSha256, /^[0-9a-f]{64}$/);
    } finally {
      s.cleanup();
    }
  });
});

describe('the ledger: what counts as outstanding', () => {
  it('treats pushed-but-unverified as OPEN', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      ledger.record(s.dir, { form: 'm/n', status: 'authored', artefact: a, runId: 'r' });
      ledger.record(s.dir, { form: 'm/n', status: 'pushed', artefact: a, runId: 'r' });
      const st = ledger.status(s.dir);
      assert.equal(st.open.length, 1);
      assert.equal(st.open[0].status, 'pushed');
    } finally {
      s.cleanup();
    }
  });

  it('closes a form once verified, and re-opens it if it is authored again', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      ledger.record(s.dir, { form: 'm/n', status: 'pushed', artefact: a, runId: 'r' });
      ledger.record(s.dir, { form: 'm/n', status: 'verified', artefact: a, runId: 'r' });
      assert.equal(ledger.status(s.dir).open.length, 0);
      // New markup means the old verification no longer describes what is on disk.
      ledger.record(s.dir, { form: 'm/n', status: 'authored', artefact: a, runId: 'r2' });
      assert.equal(ledger.status(s.dir).open.length, 1);
    } finally {
      s.cleanup();
    }
  });

  it('flags a terminal claim whose artefact has since vanished', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir, 'gone.json');
      ledger.record(s.dir, { form: 'm/n', status: 'verified', artefact: a, runId: 'r' });
      rmSync(a);
      const st = ledger.status(s.dir);
      assert.equal(st.brokenClaims.length, 1);
      assert.equal(st.forms[0].artefactMissing, true);
    } finally {
      s.cleanup();
    }
  });

  it('reports a malformed line instead of skipping it', () => {
    const s = scratch();
    try {
      ledger.record(s.dir, { form: 'm/n', status: 'abandoned', runId: 'r' });
      writeFileSync(ledger.ledgerPath(s.dir), readFileSync(ledger.ledgerPath(s.dir), 'utf8') + '{not json\n', 'utf8');
      const st = ledger.status(s.dir);
      assert.equal(st.malformed.length, 1);
    } finally {
      s.cleanup();
    }
  });
});

describe('the Stop gate: FAIL CLOSED', () => {
  it('blocks on open work', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      ledger.record(s.dir, { form: 'm/n', status: 'pushed', artefact: a, runId: 'r' });
      const g = ledger.stopGate(s.dir);
      assert.equal(g.block, true);
      assert.match(g.reasons.join('\n'), /pushed but not verified/);
      assert.ok(g.command.includes('ledger status'), 'the block must name the command that resolves it');
    } finally {
      s.cleanup();
    }
  });

  it('blocks on a malformed ledger, where the previous version failed OPEN', () => {
    const s = scratch();
    try {
      ledger.record(s.dir, { form: 'm/n', status: 'abandoned', runId: 'r' });
      writeFileSync(ledger.ledgerPath(s.dir), '{broken\n', 'utf8');
      const g = ledger.stopGate(s.dir);
      assert.equal(g.block, true);
      assert.match(g.reasons.join('\n'), /malformed/);
    } finally {
      s.cleanup();
    }
  });

  it('blocks on a vanished artefact behind a terminal claim', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir, 'poof.json');
      ledger.record(s.dir, { form: 'm/n', status: 'verified', artefact: a, runId: 'r' });
      rmSync(a);
      const g = ledger.stopGate(s.dir);
      assert.equal(g.block, true);
      assert.match(g.reasons.join('\n'), /artefact is gone/);
    } finally {
      s.cleanup();
    }
  });

  it('blocks on an ABSENT ledger when the session authored forms', () => {
    const s = scratch();
    try {
      // The old gate allowed a stop when the ledger was simply missing, which is the same as
      // having no gate: the easiest way to pass was to never write one.
      const g = ledger.stopGate(s.dir, { authoredEvidence: true });
      assert.equal(g.block, true);
      assert.match(g.reasons.join('\n'), /no push ledger at all/);
    } finally {
      s.cleanup();
    }
  });

  it('passes on an absent ledger when the session published nothing', () => {
    const s = scratch();
    try {
      const g = ledger.stopGate(s.dir, { authoredEvidence: false });
      assert.equal(g.block, false, 'a session that never touched a form must not be blocked');
    } finally {
      s.cleanup();
    }
  });

  it('passes once everything is verified or abandoned', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      ledger.record(s.dir, { form: 'm/one', status: 'verified', artefact: a, runId: 'r' });
      ledger.record(s.dir, { form: 'm/two', status: 'abandoned', runId: 'r', note: 'not needed' });
      const g = ledger.stopGate(s.dir, { authoredEvidence: true });
      assert.equal(g.block, false);
    } finally {
      s.cleanup();
    }
  });
});

describe('the ledger: repair keeps history', () => {
  it('reset marks open work abandoned rather than deleting it', () => {
    const s = scratch();
    try {
      const a = artefact(s.dir);
      ledger.record(s.dir, { form: 'm/n', status: 'pushed', artefact: a, runId: 'r' });
      const before = ledger.read(s.dir).entries.length;
      const r = ledger.reset(s.dir, { reason: 'giving up deliberately' });
      assert.deepEqual(r.closed, ['m/n']);
      const after = ledger.read(s.dir);
      // Append-only: the pushed entry is still there, with an abandonment after it.
      assert.equal(after.entries.length, before + 1);
      assert.equal(after.entries.at(-1).status, 'abandoned');
      assert.equal(after.entries.at(-1).note, 'giving up deliberately');
      assert.equal(ledger.stopGate(s.dir).block, false);
    } finally {
      s.cleanup();
    }
  });

  it('quarantine preserves a corrupt ledger as evidence', () => {
    const s = scratch();
    try {
      ledger.record(s.dir, { form: 'm/n', status: 'abandoned', runId: 'r' });
      const moved = ledger.quarantine(s.dir);
      assert.ok(moved && existsSync(moved), 'the corrupt ledger must be kept');
      assert.equal(ledger.read(s.dir).entries.length, 0);
    } finally {
      s.cleanup();
    }
  });
});

describe('the session pointer', () => {
  it('records which apps a session wrote to, without duplicating', () => {
    const s = scratch();
    try {
      ledger.noteActiveApp(s.dir, '/app/one');
      ledger.noteActiveApp(s.dir, '/app/one');
      ledger.noteActiveApp(s.dir, '/app/two');
      assert.deepEqual(ledger.readActiveApps(s.dir), ['/app/one', '/app/two']);
    } finally {
      s.cleanup();
    }
  });

  it('reports no apps when there is no pointer, so an unrelated session is never blocked', () => {
    const s = scratch();
    try {
      assert.deepEqual(ledger.readActiveApps(s.dir), []);
    } finally {
      s.cleanup();
    }
  });
});
