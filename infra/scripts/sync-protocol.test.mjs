import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonical,
  counter,
  mergeStatus,
  validateOperation,
} from '../../apps/api/spikes/us-005/protocol.mjs';
import { operation, syntheticRecord } from '../sync/fixtures.mjs';

test('sync: monetary JSON strings preserve i64 extremes and reject noncanonical/float money', () => {
  for (const amount_minor of [
    '0',
    '9007199254740993',
    '9223372036854775807',
    '-9223372036854775808',
  ])
    assert.equal(
      validateOperation(operation(900, { amount_minor })).patch.amount_minor,
      amount_minor,
    );
  for (const amount_minor of [
    100,
    1.5,
    '01',
    '-0',
    '1.0',
    '1e2',
    ' 100',
    '9223372036854775808',
    '-9223372036854775809',
  ])
    assert.throws(() => validateOperation(operation(900, { amount_minor })), {
      code: 'INVALID_OPERATION',
    });
});
test('sync: changed_fields must match the patch including delete markers', () => {
  const op = operation(900, { description: 'SYNTHETIC' });
  for (const changed_fields of [
    [],
    ['amount_minor'],
    ['description', 'description'],
    ['__proto__'],
  ])
    assert.throws(() => validateOperation({ ...op, changed_fields }), {
      code: 'INVALID_OPERATION',
    });
  assert.throws(() => validateOperation(operation(901, {})), {
    code: 'INVALID_OPERATION',
  });
  assert.throws(
    () =>
      validateOperation(
        operation(901, { description: 'SYNTHETIC' }, { deleted: true }),
      ),
    { code: 'INVALID_OPERATION' },
  );
  assert.equal(
    validateOperation(operation(901, {}, { deleted: true })).operation,
    'DELETE',
  );
});
test('sync: envelopes reject unknown fields, bad IDs, invalid dates and numeric revisions', () => {
  const op = operation(900, { date: '2026-10-16' });
  for (const patch of [
    { base_revision: 1 },
    { base_revision: '01' },
    { entity_id: 'invalid' },
    { actor_id: 'untrusted' },
    { patch: { date: '2026-02-30' } },
    { patch: { unknown: 'value' } },
    { client_timestamp: 'invalid' },
    { resolves: 'invalid' },
  ])
    assert.throws(() => validateOperation({ ...op, ...patch }), {
      code: 'INVALID_OPERATION',
    });
  assert.equal(counter('9223372036854775807'), true);
  assert.equal(counter('9223372036854775808'), false);
});
test('sync: disjoint fields merge while overlapping changes including ABA conflict', () => {
  const remote = { version: '3', deleted: false };
  assert.equal(
    mergeStatus(operation(900, { amount_minor: '12000' }), remote, [
      'description',
    ]),
    'MERGED',
  );
  assert.equal(
    mergeStatus(operation(900, { amount_minor: '12000' }), remote, [
      'amount_minor',
      'amount_minor',
    ]),
    'CONFLICT',
  );
  assert.equal(
    mergeStatus(
      operation(900, { amount_minor: '12000' }, { base: '3' }),
      remote,
      [],
    ),
    'APPLIED',
  );
});
test('sync: deletion and concurrent creation never silently resurrect or overwrite', () => {
  assert.equal(
    mergeStatus(
      operation(900, { description: 'SYNTHETIC' }, { base: '3' }),
      { version: '3', deleted: true },
      [],
    ),
    'CONFLICT',
  );
  assert.equal(
    mergeStatus(
      operation(900, {}, { deleted: true }),
      { version: '3', deleted: false },
      ['description'],
    ),
    'CONFLICT',
  );
  assert.equal(
    mergeStatus(
      operation(900, syntheticRecord, { base: '0' }),
      { version: '1', deleted: false },
      [],
    ),
    'CONFLICT',
  );
});
test('sync: creation requires a full snapshot and existing bases cannot point forward', () => {
  assert.equal(
    mergeStatus(operation(900, syntheticRecord, { base: '0' }), undefined, []),
    'APPLIED',
  );
  assert.throws(
    () =>
      mergeStatus(
        operation(900, { amount_minor: '10' }, { base: '0' }),
        undefined,
        [],
      ),
    { code: 'INVALID_OPERATION' },
  );
  assert.throws(
    () =>
      mergeStatus(
        operation(900, {}, { base: '0', deleted: true }),
        undefined,
        [],
      ),
    { code: 'INVALID_BASE' },
  );
  assert.throws(
    () =>
      mergeStatus(
        operation(900, { amount_minor: '10' }, { base: '4' }),
        { version: '3', deleted: false },
        [],
      ),
    { code: 'INVALID_BASE' },
  );
});
test('sync: idempotency fingerprints ignore property order and bind nested proposal values', () => {
  assert.equal(
    canonical({ b: { d: 2, c: 1 }, a: 0 }),
    canonical({ a: 0, b: { c: 1, d: 2 } }),
  );
  assert.notEqual(
    canonical(operation(900, { amount_minor: '1' })),
    canonical(operation(900, { amount_minor: '2' })),
  );
});
