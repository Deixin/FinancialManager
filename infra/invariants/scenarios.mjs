import assert from 'node:assert/strict';
import { aggregate, referenceTotals } from './oracle.mjs';
export const fixtureId = (n) =>
  '0199d025-0000-7000-8000-' + n.toString(16).padStart(12, '0');
export const syntheticId = (n) =>
  '0199d027-0000-7000-8000-' + n.toString(16).padStart(12, '0');
export const families = Object.freeze([
  'transfers',
  'allocations',
  'cards',
  'balances',
  'reversal',
  'deletion',
]);
export const workflowCases = Object.freeze([
  'baseline_goldens',
  'transfer_pair',
  'transfer_partial_rejected',
  'transfer_reversal',
  'split_reclassification',
  'split_sum_rejected',
  'split_subcategory_rejected',
  'card_payment_pair',
  'purchase_deletion',
  'stale_deleted_edit_rejected',
  'purchase_restore',
  'payment_reversal',
  'stale_reversal_rejected',
  'purchase_amount_and_split',
  'purchase_latest_reversal',
  'cross_workspace_rejected',
  'i64_minimum_split',
  'deferred_split_rollback',
  'noop_preserves_history',
]);
// Bounded reproducible property vectors, not a production source of randomness.
export const transferAmounts = Object.freeze(
  (() => {
    const amounts = ['1', '101', '4294967297', '9007199254740993'];
    let seed = 27001n;
    for (let i = 0; i < 12; i++) {
      seed = (seed * 48271n) % 2147483647n;
      amounts.push((seed * 100003n + 1n).toString());
    }
    return amounts;
  })(),
);
export const splitAmounts = Object.freeze([
  '1',
  '2',
  '99',
  '101',
  '3001',
  '5999',
  '10000',
  '11999',
]);
export const invariantCases = Object.freeze([
  ...workflowCases,
  ...transferAmounts.map((_, i) => 'transfer_roundtrip_' + i),
  ...splitAmounts.map((_, i) => 'split_roundtrip_' + i),
]);
const edit = (snapshot, id, patch) => {
  const state = aggregate(snapshot, id);
  return {
    id,
    base_revision: state.version,
    content: { ...state.content, ...patch },
  };
};
const pair = (snapshot, a, b, amount, opposite = false) => [
  edit(snapshot, fixtureId(a), { account_amount_minor: '-' + amount }),
  edit(snapshot, fixtureId(b), {
    account_amount_minor: opposite ? amount : '-' + amount,
  }),
];
export function operation(name, snapshot) {
  const purchase = aggregate(snapshot, fixtureId(103)),
    allocs = purchase?.content.allocations ?? [];
  const split = (a, b) =>
    allocs.map((row, i) => ({ ...row, amount_minor: i === 0 ? a : b }));
  switch (name) {
    case 'baseline_goldens':
      return null;
    case 'transfer_pair':
      return { changes: pair(snapshot, 104, 105, '15000', true) };
    case 'transfer_partial_rejected':
      return {
        changes: pair(snapshot, 104, 105, '16000', true).slice(0, 1),
        error: 'COMPOSITE_REQUIRED',
      };
    case 'transfer_reversal':
      return {
        revert: [104, 105].map((id) => ({
          id: fixtureId(id),
          base_revision: '2',
          revision_version: '2',
        })),
      };
    case 'split_reclassification':
      return {
        changes: [
          edit(snapshot, fixtureId(103), {
            allocations: split('3000', '9000'),
          }),
        ],
      };
    case 'split_sum_rejected':
      return {
        changes: [
          edit(snapshot, fixtureId(103), {
            allocations: split('3000', '9001'),
          }),
        ],
        error: 'INVALID_REVISION',
      };
    case 'split_subcategory_rejected':
      return {
        changes: [
          edit(snapshot, fixtureId(103), {
            allocations: split('3000', '9000').map((row, i) =>
              i === 0 ? { ...row, category_id: fixtureId(32) } : row,
            ),
          }),
        ],
        error: 'DATA_ACCESS_FAILED',
      };
    case 'card_payment_pair':
      return { changes: pair(snapshot, 106, 107, '9000') };
    case 'purchase_deletion':
      return { changes: [edit(snapshot, fixtureId(103), { deleted: true })] };
    case 'stale_deleted_edit_rejected':
      return {
        changes: [
          {
            ...edit(snapshot, fixtureId(103), { deleted: false }),
            base_revision: '2',
          },
        ],
        error: 'VERSION_CONFLICT',
      };
    case 'purchase_restore':
      return { changes: [edit(snapshot, fixtureId(103), { deleted: false })] };
    case 'payment_reversal':
      return {
        revert: [106, 107].map((id) => ({
          id: fixtureId(id),
          base_revision: '2',
          revision_version: '2',
        })),
      };
    case 'stale_reversal_rejected':
      return {
        revert: [
          {
            id: fixtureId(103),
            base_revision: purchase.version,
            revision_version: '2',
          },
        ],
        error: 'REVERSAL_CONFLICT',
      };
    case 'purchase_amount_and_split':
      return {
        changes: [
          edit(snapshot, fixtureId(103), {
            account_amount_minor: '12345',
            allocations: split('4000', '8345'),
          }),
        ],
      };
    case 'purchase_latest_reversal':
      return {
        revert: [
          { id: fixtureId(103), base_revision: '5', revision_version: '5' },
        ],
      };
    case 'cross_workspace_rejected':
      return {
        changes: [
          edit(snapshot, fixtureId(102), { account_id: fixtureId(14) }),
        ],
        error: 'NOT_FOUND',
      };
    case 'i64_minimum_split':
      return {
        workspace: fixtureId(2),
        changes: [
          edit(snapshot, fixtureId(202), {
            allocations: [
              ['9223372036854775807', 301],
              ['1', 302],
            ].map(([amount, id]) => ({
              id: syntheticId(id),
              category_id: syntheticId(300),
              subcategory_id: null,
              amount_minor: amount,
              note: null,
            })),
          }),
        ],
      };
    case 'deferred_split_rollback':
      return { workspace: fixtureId(2), raw: true };
    case 'noop_preserves_history':
      return { changes: [edit(snapshot, fixtureId(103), {})], unchanged: true };
    default:
      throw Error('UNKNOWN_INVARIANT_CASE');
  }
}
export function golden(name, snapshot) {
  const totals = referenceTotals(snapshot),
    values = totals.balances;
  const checkpoints = {
    baseline_goldens: [
      '108500',
      '30000',
      '-2000',
      '140500',
      '32000',
      '60500',
      '35000',
      '12000',
    ],
    transfer_pair: [
      '103500',
      '35000',
      '-2000',
      '140500',
      '32000',
      '65500',
      '40000',
      '12000',
    ],
    transfer_reversal: [
      '108500',
      '30000',
      '-2000',
      '140500',
      '32000',
      '60500',
      '35000',
      '12000',
    ],
    card_payment_pair: [
      '106500',
      '30000',
      '-4000',
      '140500',
      '32000',
      '60500',
      '35000',
      '14000',
    ],
    purchase_deletion: [
      '106500',
      '30000',
      '-16000',
      '152500',
      '20000',
      '60500',
      '35000',
      '14000',
    ],
    purchase_restore: [
      '106500',
      '30000',
      '-4000',
      '140500',
      '32000',
      '60500',
      '35000',
      '14000',
    ],
    payment_reversal: [
      '108500',
      '30000',
      '-2000',
      '140500',
      '32000',
      '60500',
      '35000',
      '12000',
    ],
    purchase_amount_and_split: [
      '108500',
      '30000',
      '-1655',
      '140155',
      '32345',
      '60500',
      '35000',
      '12000',
    ],
    purchase_latest_reversal: [
      '108500',
      '30000',
      '-2000',
      '140500',
      '32000',
      '60500',
      '35000',
      '12000',
    ],
  };
  if (checkpoints[name])
    assert.deepEqual(
      [
        values[fixtureId(11)],
        values[fixtureId(12)],
        values[fixtureId(13)],
        totals.net_worth_minor,
        totals.periods[0].expense_minor,
        totals.periods[0].cash_in_minor,
        totals.periods[0].cash_out_minor,
        totals.periods[1].cash_out_minor,
      ],
      checkpoints[name],
    );
  if (['split_reclassification', 'purchase_latest_reversal'].includes(name))
    assert.deepEqual(
      aggregate(snapshot, fixtureId(103)).content.allocations.map(
        (row) => row.amount_minor,
      ),
      ['3000', '9000'],
    );
}
export const propertyTransfer = (snapshot, amount) => ({
  changes: pair(snapshot, 104, 105, amount, true),
});
export function propertySplit(snapshot, amount) {
  const state = aggregate(snapshot, fixtureId(103));
  return {
    changes: [
      edit(snapshot, state.id, {
        allocations: state.content.allocations.map((row, i) => ({
          ...row,
          amount_minor: i === 0 ? amount : (12000n - BigInt(amount)).toString(),
        })),
      }),
    ],
  };
}
