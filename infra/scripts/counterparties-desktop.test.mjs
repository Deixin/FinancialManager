/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  captureLocalCounterparty,
  captureLocalAssociations,
  decodeCounterpartySnapshot,
  decodeCounterpartyResult,
  associationEdit,
  decodeAssociationResult,
  verifyAssociationRead,
  localCounterpartyMessage,
  createLocalCounterpartyGateway,
} from '../../apps/desktop/dist/local-counterparties.js';
import { LocalMovementError } from '../../apps/desktop/dist/local-movements.js';
import {
  syntheticCounterpartyHost,
  editorSnapshot,
  workspace as w,
  id,
} from '../counterparties-desktop/fixture.mjs';
import {
  validateDesktopCounterpartyEvidence,
  browserChecks,
  nativeChecks,
} from '../counterparties-desktop/evidence.mjs';
const snapshot = () => decodeCounterpartySnapshot(editorSnapshot(), w, true);
test('Desktop counterparty inputs preserve immutable full bases and explicit nulls', () => {
  const raw = structuredClone({
      kind: 'UPDATE',
      base: snapshot().items[0],
      item: { ...snapshot().items[0], display_name: 'SYNTHETIC NEW' },
    }),
    captured = captureLocalCounterparty(raw, w);
  raw.base.display_name = 'SYNTHETIC MUTATED';
  assert.notEqual(captured.base.display_name, raw.base.display_name);
  assert.ok(Object.isFrozen(captured.item));
  for (const mutate of [
    (c) => delete c.item.identifier_value,
    (c) => (c.item.extra = true),
    (c) => (c.item.identifier_type = 'CPF'),
    (c) => (c.item.id = 'invalid'),
  ]) {
    const c = structuredClone(raw);
    mutate(c);
    assert.throws(() => captureLocalCounterparty(c, w));
  }
});
test('Desktop catalog read rejects foreign incomplete duplicate and partial-shaped payloads', () => {
  for (const mutate of [
    (s) => (s.workspace_id = id(999)),
    (s) => s.items.push(s.items[0]),
    (s) => (s.items[0].extra = true),
    (s) => (s.cursor = null),
    (s) => (s.items[0].id = 'invalid'),
    (s) => (s.movements.transactions[0].content.counterparty_id = id(999)),
  ]) {
    const s = editorSnapshot();
    mutate(s);
    assert.throws(() => decodeCounterpartySnapshot(s, w, true));
  }
  assert.throws(() => decodeCounterpartySnapshot(editorSnapshot(), w));
});
test('Desktop catalog acknowledgement validates complete expected rows and replay identity', () => {
  const h = syntheticCounterpartyHost(),
    s = decodeCounterpartySnapshot(h.snapshot(w), w),
    c = captureLocalCounterparty(
      { kind: 'CREATE', item: { ...s.items[0], id: id(950) } },
      w,
    ),
    r = h.change(w, c);
  assert.equal(decodeCounterpartyResult(r, c, s).changed, true);
  assert.equal(decodeCounterpartyResult(h.change(w, c), c, s).changed, false);
  for (const bad of [
    { ...r, changed: false, items: [] },
    { ...r, extra: true },
    { ...r, items: r.items.slice(1) },
  ])
    assert.throws(() => decodeCounterpartyResult(bad, c, s));
});
test('Desktop associations include complete groups and preserve every partner field', () => {
  for (const [n, partner] of [
    [104, 105],
    [107, 108],
  ]) {
    const commands = associationEdit(snapshot(), id(n), {
      kind: 'SET',
      counterparty_id: id(900),
    });
    assert.equal(commands.length, 2);
    assert.equal(
      commands.find((c) => c.base.id === id(partner)).counterparty.kind,
      'KEEP',
    );
  }
  const s = structuredClone(snapshot());
  s.movements.transactions = s.movements.transactions.filter(
    (r) => r.id !== id(105),
  );
  assert.throws(() => associationEdit(s, id(104), { kind: 'CLEAR' }));
});
test('Desktop new archived references are rejected while retained historical association is valid', () => {
  assert.throws(
    () =>
      associationEdit(snapshot(), id(100), {
        kind: 'SET',
        counterparty_id: id(901),
      }),
    { code: 'COUNTERPARTY_REFERENCE_UNAVAILABLE' },
  );
  const s = structuredClone(snapshot());
  s.movements.transactions.find(
    (r) => r.id === id(100),
  ).content.counterparty_id = id(901);
  assert.equal(
    associationEdit(s, id(100), { kind: 'KEEP' })[0].counterparty.kind,
    'KEEP',
  );
});
test('Desktop association acknowledgements and follow-up history reject forged success', async () => {
  const h = syntheticCounterpartyHost(),
    s = decodeCounterpartySnapshot(h.full(w), w, true),
    commands = associationEdit(s, id(100), {
      kind: 'SET',
      counterparty_id: id(900),
    }),
    raw = await h.apply(w, commands),
    entries = decodeAssociationResult(raw, commands),
    next = decodeCounterpartySnapshot(h.full(w), w, true);
  verifyAssociationRead(next, commands, entries);
  for (const mutate of [
    (r) => (r.entries[0].version = '999'),
    (r) => (r.entries[0].revision_id = null),
    (r) => (r.entries[0].extra = true),
    (r) => r.entries.push(r.entries[0]),
  ]) {
    const r = structuredClone(raw);
    mutate(r);
    assert.throws(() => decodeAssociationResult(r, commands));
  }
  const bad = structuredClone(next);
  bad.movements.history.find(
    (r) => r.id === entries[0].revision_id,
  ).snapshot.before.content.display_name = 'SYNTHETIC FORGED';
  assert.throws(() => verifyAssociationRead(bad, commands, entries));
});
test('Desktop batches reject sparse duplicates excess and financial edits outside intent', () => {
  const c = associationEdit(snapshot(), id(100), { kind: 'CLEAR' })[0];
  for (const rows of [
    [],
    [c, c],
    Array(257).fill(c),
    Array(1),
    [{ ...c, content: {} }],
    [{ ...c, counterparty: { kind: 'KEEP', extra: true } }],
  ])
    assert.throws(() => captureLocalAssociations(rows, w));
  assert.equal(createLocalCounterpartyGateway(), null);
});
test('Desktop counterparty messages never expose transport text or identifiers', () => {
  assert.ok(
    localCounterpartyMessage(
      new LocalMovementError('COUNTERPARTY_BASE_CONFLICT'),
    ).includes('mudaram'),
  );
  assert.ok(
    !localCounterpartyMessage(Error('SYNTHETIC PRIVATE IDENTIFIER')).includes(
      'PRIVATE',
    ),
  );
});
test('Desktop counterparty parity corpus contains real shared service plans and i64 boundaries', () => {
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us047-counterparties.json'),
  );
  assert.equal(f.synthetic_only, true);
  assert.equal(f.catalog_vectors.length, 27);
  assert.equal(f.association_vectors.length, 29);
  assert.equal(
    f.association_vectors.find((v) => v.name === 'wide_-9223372036854775808')
      .expected.plans[0].after.content.account_amount_minor,
    '-9223372036854775808',
  );
  assert.ok(
    f.association_vectors.some(
      (v) => v.expected.error === 'COMPOSITE_REQUIRED',
    ),
  );
  assert.ok(
    f.catalog_vectors.some((v) => v.name === 'homonym' && v.expected.plan),
  );
});
test('Desktop counterparty evidence binds actual browser Windows cleanup and sources', () => {
  for (const kind of ['browser', 'windows']) {
    const report = JSON.parse(
      readFileSync(
        'docs/quality/evidence/us-047-desktop-counterparties-' +
          kind +
          '-2026-10-18.json',
      ),
    );
    assert.equal(validateDesktopCounterpartyEvidence(report).passed, true);
    for (const name of kind === 'browser' ? browserChecks : nativeChecks) {
      const bad = structuredClone(report);
      delete bad.checks[name];
      assert.throws(() => validateDesktopCounterpartyEvidence(bad));
    }
    const bad = structuredClone(report);
    bad.resources_closed = false;
    assert.throws(() => validateDesktopCounterpartyEvidence(bad));
  }
});
