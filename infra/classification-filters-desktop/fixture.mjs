// SYNTHETIC_US045_FILTERS_ONLY. No personal data; transport double for Chromium.
import {
  syntheticHost,
  workspace,
  id,
  now,
} from '../movements-desktop/fixture.mjs';
export { workspace, id, now };
export const other = id(90);
export function syntheticClassificationSnapshot(w = workspace) {
  if (w === other)
    return {
      balance: { workspace_id: w, read_at: now, accounts: [], movements: [] },
      transactions: [],
      history: [],
      classification: { workspace_id: w, categories: [], items: [] },
    };
  const h = syntheticHost(),
    categories = [10, 11, 12].map((n) => ({
      id: id(n),
      workspace_id: w,
      name: 'SYNTHETIC CATEGORY ' + n,
      category_scope: 'BOTH',
      sort_order: n,
      status: n === 12 ? 'ARCHIVED' : 'ACTIVE',
      is_seeded: false,
    })),
    items = [20, 21, 22]
      .map((n) => ({
        kind: 'SUBCATEGORY',
        id: id(n),
        workspace_id: w,
        name: 'SYNTHETIC SUB ' + n,
        status: n === 22 ? 'ARCHIVED' : 'ACTIVE',
        category_id: id(n - 10),
        sort_order: 0,
      }))
      .concat(
        [30, 31, 32].map((n) => ({
          kind: 'TAG',
          id: id(n),
          workspace_id: w,
          name: 'SYNTHETIC TAG ' + n,
          status: n === 32 ? 'ARCHIVED' : 'ACTIVE',
        })),
      ),
    allocation = (n, c, s, amount) => ({
      id: id(n),
      category_id: id(c),
      subcategory_id: s === null ? null : id(s),
      amount_minor: amount,
      note: 'SYNTHETIC NOTE',
    }),
    make = (n, allocations, tags, extra = {}) => ({
      workspace_id: w,
      id: id(n),
      version: '1',
      created_at: now,
      updated_at: now,
      deleted_at: null,
      content: {
        account_id: id(2),
        group_id: null,
        counterparty_id: null,
        financial_date: '2020-01-15',
        account_amount_minor: '-100',
        economic_kind: 'EXPENSE',
        original_description: 'SYNTHETIC ORIGINAL',
        display_name: 'SYNTHETIC RESULT ' + n,
        origin_kind: 'IMPORT',
        deleted: false,
        allocations,
        tag_ids: tags.map(id),
        ...extra,
      },
    }),
    states = [
      make(
        100,
        [allocation(200, 10, 20, '40'), allocation(201, 11, 21, '60')],
        [30, 31],
      ),
      make(101, [allocation(202, 10, 20, '100')], [30]),
      make(102, [], [31]),
      {
        ...make(103, [allocation(203, 10, 20, '100')], [30], { deleted: true }),
        deleted_at: now,
      },
      make(104, [], [30], { group_id: id(80), economic_kind: 'TRANSFER' }),
      make(105, [], [], {
        account_id: id(3),
        group_id: id(80),
        economic_kind: 'TRANSFER',
        account_amount_minor: '100',
      }),
      make(106, [allocation(204, 12, 22, '9007199254740993')], [32], {
        account_amount_minor: '-9007199254740993',
        financial_date: '2026-10-17',
      }),
    ];
  // Table-scoped identities may overlap in legacy/imported catalogs.
  items.push({
    kind: 'TAG',
    id: id(12),
    workspace_id: w,
    name: 'SYNTHETIC COLLISION TAG 12',
    status: 'ACTIVE',
  });
  states.find((s) => s.id === id(106)).content.tag_ids.push(id(12));
  for (const s of states) h.states.set(s.id, s);
  return {
    ...h.snapshot(),
    classification: { workspace_id: w, categories, items },
  };
}
