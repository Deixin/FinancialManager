/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  captureLocalAllocations,
  allocationEdit,
  decodeAllocationResult,
  verifyAllocationRead,
  localAllocationMessage,
} from '../../apps/desktop/dist/local-allocations.js';
import { decodeClassificationSnapshot } from '../../apps/desktop/dist/local-classification-filters.js';
import { LocalMovementError } from '../../apps/desktop/dist/local-movements.js';
import {
  syntheticAllocationHost,
  editorSnapshot,
  workspace as w,
  id,
} from '../allocations-desktop/fixture.mjs';
import {
  validateDesktopAllocationEvidence,
  browserChecks,
  nativeChecks,
} from '../allocations-desktop/evidence.mjs';
const snapshot = () => decodeClassificationSnapshot(editorSnapshot(), w);
const replace = () =>
  allocationEdit(snapshot(), id(102), {
    kind: 'REPLACE',
    allocations: [
      {
        id: id(500),
        category_id: id(10),
        subcategory_id: id(20),
        amount_minor: '40',
        note: 'SYNTHETIC NOTE',
      },
      {
        id: id(501),
        category_id: id(11),
        subcategory_id: null,
        amount_minor: '60',
        note: null,
      },
    ],
  });
test('Desktop allocations capture stable immutable IDs notes and complete bases', () => {
  const raw = structuredClone(replace()),
    captured = captureLocalAllocations(raw, w);
  raw[0].allocation.allocations[0].note = 'SYNTHETIC MUTATED';
  assert.equal(captured[0].allocation.allocations[0].note, 'SYNTHETIC NOTE');
  assert.ok(Object.isFrozen(captured[0].base.content));
  assert.ok(Object.isFrozen(captured[0].allocation.allocations[0]));
});
test('Desktop allocation gateway rejects mismatched sums malformed UUIDs and unsupported payload fields', () => {
  for (const mutate of [
    (c) => {
      c[0].allocation.allocations[0].amount_minor = '39';
    },
    (c) => {
      c[0].allocation.allocations[0].id =
        '0199d046-0000-4000-8000-000000000500';
    },
    (c) => {
      c[0].tag_ids = [];
    },
    (c) => {
      c[0].allocation.allocations[0].amount_minor = 40;
    },
    (c) => {
      c[0].allocation.extra = true;
    },
  ]) {
    const c = structuredClone(replace());
    mutate(c);
    assert.throws(() => captureLocalAllocations(c, w));
  }
});
test('Desktop allocation operation includes a complete unchanged partner for transfer and card payment', () => {
  const s = snapshot();
  for (const n of [104, 107]) {
    const commands = allocationEdit(s, id(n), {
      kind: 'REPLACE',
      allocations: [
        {
          id: id(n + 500),
          category_id: id(10),
          subcategory_id: null,
          amount_minor: '100',
          note: null,
        },
      ],
    });
    assert.equal(commands.length, 2);
    assert.equal(
      commands.find((c) => c.base.id !== id(n)).allocation.kind,
      'KEEP',
    );
  }
});
test('Desktop allocation ACK validation rejects duplicates missing changed status and forged revisions', async () => {
  const host = syntheticAllocationHost(),
    commands = replace(),
    ack = await host.apply(w, commands);
  assert.equal(decodeAllocationResult(ack, commands).length, 1);
  for (const mutate of [
    (r) => {
      r.entries[0].version = '99';
    },
    (r) => {
      r.entries[0].base_revision = '0';
    },
    (r) => {
      r.entries[0].changed = false;
    },
    (r) => {
      r.entries[0].revision_id = null;
    },
    (r) => {
      r.entries.push(r.entries[0]);
    },
    (r) => {
      r.extra = true;
    },
  ]) {
    const raw = structuredClone(ack);
    mutate(raw);
    assert.throws(() => decodeAllocationResult(raw, commands), {
      code: 'INVALID_RESPONSE',
    });
  }
});
test('Desktop allocation follow-up verifies before and after history and preserves origin tags and financial content', async () => {
  const host = syntheticAllocationHost(),
    commands = replace(),
    ack = await host.apply(w, commands),
    next = decodeClassificationSnapshot(host.read(w), w);
  verifyAllocationRead(next, commands, decodeAllocationResult(ack, commands));
  const before = commands[0].base.content,
    after = next.movements.transactions.find((r) => r.id === id(102)).content;
  for (const key of Object.keys(before).filter((k) => k !== 'allocations'))
    assert.deepEqual(after[key], before[key]);
  const forged = structuredClone(next);
  forged.movements.history.at(-1).snapshot.before.content.display_name =
    'SYNTHETIC FORGED';
  assert.throws(() => verifyAllocationRead(forged, commands, ack.entries), {
    code: 'INVALID_RESPONSE',
  });
});
test('Desktop allocation no-op does not create audit and clear keeps tags', async () => {
  const host = syntheticAllocationHost();
  let s = decodeClassificationSnapshot(host.read(w), w),
    commands = allocationEdit(s, id(100), { kind: 'KEEP' }),
    count = s.movements.history.length,
    ack = await host.apply(w, commands);
  assert.equal(ack.entries[0].changed, false);
  assert.equal(host.read(w).history.length, count);
  verifyAllocationRead(
    decodeClassificationSnapshot(host.read(w), w),
    commands,
    decodeAllocationResult(ack, commands),
  );
  commands = allocationEdit(s, id(100), { kind: 'CLEAR' });
  await host.apply(w, commands);
  const after = host.read(w).transactions.find((r) => r.id === id(100));
  assert.deepEqual(after.content.allocations, []);
  assert.deepEqual(after.content.tag_ids, commands[0].base.content.tag_ids);
});
test('Desktop allocation transport bounds fail without truncating a batch or altering intention', () => {
  const c = replace()[0];
  for (const input of [
    [],
    [c, c],
    Array(257).fill(c),
    [{ ...c, extra: 'x'.repeat(4 * 1024 * 1024) }],
  ])
    assert.throws(() => captureLocalAllocations(input, w));
});
test('Desktop allocation messages use fixed codes without echoing private payloads', () => {
  assert.ok(
    localAllocationMessage(
      new LocalMovementError('ALLOCATION_TOTAL_MISMATCH'),
    ).includes('soma'),
  );
  assert.ok(
    localAllocationMessage(
      new LocalMovementError('ALLOCATION_BASE_CONFLICT'),
    ).includes('A base mudou'),
  );
  assert.ok(
    !localAllocationMessage(Error('SYNTHETIC PRIVATE')).includes('PRIVATE'),
  );
});
test('Desktop allocation golden corpus covers exact i64 and real shared service plans', () => {
  const fixture = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us046-allocations.json'),
  );
  assert.equal(fixture.synthetic_only, true);
  assert.equal(fixture.vectors.length, 47);
  const vector = (n) => fixture.vectors.find((v) => v.name === n);
  assert.equal(
    vector(
      'minimum_replace',
    ).expected.plans[0].after.content.allocations.reduce(
      (sum, a) => sum + BigInt(a.amount_minor),
      0n,
    ),
    9223372036854775808n,
  );
  assert.ok(
    fixture.vectors.some(
      (v) => v.expected.error === 'ALLOCATION_TOTAL_MISMATCH',
    ),
  );
  assert.ok(
    fixture.vectors.some((v) => v.expected.error === 'COMPOSITE_REQUIRED'),
  );
});
test('Desktop allocation evidence binds browser native cleanup permissions and exact current sources', () => {
  for (const kind of ['browser', 'windows']) {
    const file =
        'docs/quality/evidence/us-046-desktop-allocations-' +
        kind +
        '-2026-10-18-us047-associations.json',
      report = JSON.parse(readFileSync(file));
    assert.equal(validateDesktopAllocationEvidence(report).passed, true);
    for (const name of kind === 'browser' ? browserChecks : nativeChecks) {
      const bad = structuredClone(report);
      delete bad.checks[name];
      assert.throws(() => validateDesktopAllocationEvidence(bad));
    }
    const bad = structuredClone(report);
    bad.resources_closed = false;
    assert.throws(() => validateDesktopAllocationEvidence(bad));
  }
});
