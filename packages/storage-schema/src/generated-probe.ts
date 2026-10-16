// Generated synthetic-only corpus. Never a product seed.
export const syntheticCorpus = {
  format_version: 1,
  synthetic_only: true,
  workspace_a: '0199d021-0000-7000-8000-000000000001',
  workspace_b: '0199d021-0000-7000-8000-000000000002',
  seed: [
    {
      table: 'workspace',
      values: {
        id: '0199d021-0000-7000-8000-000000000001',
        display_name: 'Synthetic US021',
        purpose: 'PERSONAL',
        storage_mode: 'CLOUD',
        default_currency: 'BRL',
        sync_generation: '0199d021-0000-7000-8000-00000000005a',
        created_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_account',
      values: {
        id: '0199d021-0000-7000-8000-00000000000b',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic bank',
        account_kind: 'CHECKING',
        balance_nature: 'ASSET',
        currency_code: 'BRL',
        status: 'ACTIVE',
      },
    },
    {
      table: 'category',
      values: {
        id: '0199d021-0000-7000-8000-000000000015',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic category',
        category_scope: 'BOTH',
        sort_order: '0',
        status: 'ACTIVE',
        is_seeded: '0',
        normalized_name: 'synthetic category',
      },
    },
    {
      table: 'workspace',
      values: {
        id: '0199d021-0000-7000-8000-000000000002',
        display_name: 'Synthetic US021',
        purpose: 'PERSONAL',
        storage_mode: 'CLOUD',
        default_currency: 'BRL',
        sync_generation: '0199d021-0000-7000-8000-00000000005a',
        created_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_account',
      values: {
        id: '0199d021-0000-7000-8000-00000000000c',
        workspace_id: '0199d021-0000-7000-8000-000000000002',
        name: 'Synthetic bank',
        account_kind: 'CHECKING',
        balance_nature: 'ASSET',
        currency_code: 'BRL',
        status: 'ACTIVE',
      },
    },
    {
      table: 'category',
      values: {
        id: '0199d021-0000-7000-8000-000000000016',
        workspace_id: '0199d021-0000-7000-8000-000000000002',
        name: 'Synthetic category',
        category_scope: 'BOTH',
        sort_order: '0',
        status: 'ACTIVE',
        is_seeded: '0',
        normalized_name: 'synthetic category',
      },
    },
    {
      table: 'financial_account',
      values: {
        id: '0199d021-0000-7000-8000-00000000000d',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic SAVINGS',
        account_kind: 'SAVINGS',
        balance_nature: 'ASSET',
        currency_code: 'BRL',
        status: 'ACTIVE',
      },
    },
    {
      table: 'financial_account',
      values: {
        id: '0199d021-0000-7000-8000-00000000000e',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic CREDIT_CARD',
        account_kind: 'CREDIT_CARD',
        balance_nature: 'LIABILITY',
        currency_code: 'BRL',
        status: 'ACTIVE',
      },
    },
    {
      table: 'financial_account',
      values: {
        id: '0199d021-0000-7000-8000-00000000000f',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic OTHER',
        account_kind: 'OTHER',
        balance_nature: 'ASSET',
        currency_code: 'BRL',
        status: 'ACTIVE',
      },
    },
    {
      table: 'transaction_group',
      values: {
        id: '0199d021-0000-7000-8000-000000000033',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        group_type: 'TRANSFER',
        state: 'ACTIVE',
      },
    },
    {
      table: 'transaction_group',
      values: {
        id: '0199d021-0000-7000-8000-000000000034',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        group_type: 'CARD_PAYMENT',
        state: 'ACTIVE',
      },
    },
    {
      table: 'subcategory',
      values: {
        id: '0199d021-0000-7000-8000-00000000001f',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        category_id: '0199d021-0000-7000-8000-000000000015',
        name: 'Synthetic child',
        sort_order: '0',
        status: 'ACTIVE',
      },
    },
    {
      table: 'category',
      values: {
        id: '0199d021-0000-7000-8000-000000000017',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic alternate',
        category_scope: 'BOTH',
        sort_order: '0',
        status: 'ACTIVE',
        is_seeded: '0',
        normalized_name: 'synthetic alternate',
      },
    },
    {
      table: 'tag',
      values: {
        id: '0199d021-0000-7000-8000-000000000029',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        name: 'Synthetic tag',
        status: 'ACTIVE',
        normalized_name: 'synthetic tag',
      },
    },
    {
      table: 'balance_reference',
      values: {
        id: '0199d021-0000-7000-8000-000000000047',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000b',
        amount_minor: '100000',
        reference_date: '2026-09-01',
        day_position: 'START_OF_DAY',
        source: 'MANUAL',
        status: 'ACTIVE',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-000000000065',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000b',
        account_amount_minor: '50000',
        economic_kind: 'INCOME',
        financial_date: '2026-09-02',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-000000000066',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000b',
        account_amount_minor: '-20000',
        economic_kind: 'EXPENSE',
        financial_date: '2026-09-03',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-000000000067',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000e',
        account_amount_minor: '12000',
        economic_kind: 'EXPENSE',
        financial_date: '2026-09-10',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-000000000068',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000b',
        account_amount_minor: '-10000',
        economic_kind: 'TRANSFER',
        financial_date: '2026-09-15',
        group_id: '0199d021-0000-7000-8000-000000000033',
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-000000000069',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000d',
        account_amount_minor: '10000',
        economic_kind: 'TRANSFER',
        financial_date: '2026-09-15',
        group_id: '0199d021-0000-7000-8000-000000000033',
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-00000000006a',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000b',
        account_amount_minor: '-12000',
        economic_kind: 'DEBT_SETTLEMENT',
        financial_date: '2026-10-05',
        group_id: '0199d021-0000-7000-8000-000000000034',
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-00000000006b',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000e',
        account_amount_minor: '-12000',
        economic_kind: 'DEBT_SETTLEMENT',
        financial_date: '2026-10-05',
        group_id: '0199d021-0000-7000-8000-000000000034',
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-00000000006c',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000e',
        account_amount_minor: '-2000',
        economic_kind: 'EXPENSE_REVERSAL',
        financial_date: '2026-10-07',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-0000000000c9',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000f',
        account_amount_minor: '9223372036854775807',
        economic_kind: 'EXPENSE',
        financial_date: '2026-10-16',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-0000000000ca',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000f',
        account_amount_minor: '-9223372036854775808',
        economic_kind: 'EXPENSE',
        financial_date: '2026-10-16',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-0000000000cb',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000f',
        account_amount_minor: '9007199254740993',
        economic_kind: 'EXPENSE',
        financial_date: '2026-10-16',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-0000000000cc',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000f',
        account_amount_minor: '-100',
        economic_kind: 'EXPENSE',
        financial_date: '2026-10-16',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
    {
      table: 'financial_transaction',
      values: {
        id: '0199d021-0000-7000-8000-0000000000cd',
        workspace_id: '0199d021-0000-7000-8000-000000000001',
        account_id: '0199d021-0000-7000-8000-00000000000f',
        account_amount_minor: '-4294967297',
        economic_kind: 'EXPENSE',
        financial_date: '2026-10-16',
        group_id: null,
        display_name: 'SYNTHETIC_US021_MOVEMENT',
        origin_kind: 'MANUAL',
        version: '1',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    },
  ],
  cases: [
    {
      name: 'bank_balance_exact',
      statements: [],
      query: {
        sql: 'SELECT CAST(100000+sum(account_amount_minor) AS TEXT) AS balance FROM financial_transaction WHERE account_id=? AND deleted_at IS NULL',
        parameters: ['0199d021-0000-7000-8000-00000000000b'],
        rows: [{ balance: '108000' }],
      },
    },
    {
      name: 'savings_balance_exact',
      statements: [],
      query: {
        sql: 'SELECT CAST(sum(account_amount_minor) AS TEXT) AS balance FROM financial_transaction WHERE account_id=?',
        parameters: ['0199d021-0000-7000-8000-00000000000d'],
        rows: [{ balance: '10000' }],
      },
    },
    {
      name: 'card_debt_signed',
      statements: [],
      query: {
        sql: 'SELECT CAST(sum(account_amount_minor) AS TEXT) AS balance FROM financial_transaction WHERE account_id=?',
        parameters: ['0199d021-0000-7000-8000-00000000000e'],
        rows: [{ balance: '-2000' }],
      },
    },
    {
      name: 'consumption_excludes_transfers_and_settlement',
      statements: [],
      query: {
        sql: "SELECT CAST(sum(CASE WHEN economic_kind='EXPENSE' THEN abs(account_amount_minor) WHEN economic_kind='EXPENSE_REVERSAL' THEN -abs(account_amount_minor) ELSE 0 END) AS TEXT) AS consumed FROM financial_transaction WHERE account_id IN(?,?,?)",
        parameters: [
          '0199d021-0000-7000-8000-00000000000b',
          '0199d021-0000-7000-8000-00000000000d',
          '0199d021-0000-7000-8000-00000000000e',
        ],
        rows: [{ consumed: '30000' }],
      },
    },
    {
      name: 'i64_limits_and_precision_neighbors',
      statements: [],
      query: {
        sql: 'SELECT CAST(account_amount_minor AS TEXT) AS amount FROM financial_transaction WHERE id IN(?,?,?) ORDER BY id',
        parameters: [
          '0199d021-0000-7000-8000-0000000000c9',
          '0199d021-0000-7000-8000-0000000000ca',
          '0199d021-0000-7000-8000-0000000000cb',
        ],
        rows: [
          { amount: '9223372036854775807' },
          { amount: '-9223372036854775808' },
          { amount: '9007199254740993' },
        ],
      },
    },
    {
      name: 'keyset_same_day_tie_break',
      statements: [],
      query: {
        sql: 'SELECT id FROM financial_transaction WHERE financial_date=? AND id<? ORDER BY financial_date DESC,id DESC LIMIT 1',
        parameters: ['2026-10-05', '0199d021-0000-7000-8000-00000000006c'],
        rows: [{ id: '0199d021-0000-7000-8000-00000000006b' }],
      },
    },
    {
      name: 'fractional_money_rejected',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET account_amount_minor=? WHERE id=?',
          parameters: ['1.5', '0199d021-0000-7000-8000-0000000000cc'],
        },
      ],
      reject: true,
    },
    {
      name: 'i64_overflow_rejected',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET account_amount_minor=? WHERE id=?',
          parameters: [
            '9223372036854775808',
            '0199d021-0000-7000-8000-0000000000cc',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'cross_workspace_account_fk',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET account_id=? WHERE id=?',
          parameters: [
            '0199d021-0000-7000-8000-00000000000c',
            '0199d021-0000-7000-8000-0000000000cc',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'cross_workspace_category_fk',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-00000000012d',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '0199d021-0000-7000-8000-000000000016',
            null,
            '100',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'subcategory_must_match_category',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-00000000012d',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '0199d021-0000-7000-8000-000000000017',
            '0199d021-0000-7000-8000-00000000001f',
            '100',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'impossible_financial_date',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET financial_date=? WHERE id=?',
          parameters: ['2025-02-29', '0199d021-0000-7000-8000-0000000000cc'],
        },
      ],
      reject: true,
    },
    {
      name: 'submillisecond_instant_rejected',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET updated_at=? WHERE id=?',
          parameters: [
            '2026-10-16T00:00:00.123456Z',
            '0199d021-0000-7000-8000-0000000000cc',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'nonfinite_instant_rejected',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET updated_at=? WHERE id=?',
          parameters: ['infinity', '0199d021-0000-7000-8000-0000000000cc'],
        },
      ],
      reject: true,
    },
    {
      name: 'identity_immutable',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET id=? WHERE id=?',
          parameters: [
            '0199d021-0000-7000-8000-0000000003e7',
            '0199d021-0000-7000-8000-0000000000cc',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'card_cannot_be_asset',
      statements: [
        {
          sql: 'UPDATE financial_account SET balance_nature=? WHERE id=?',
          parameters: ['ASSET', '0199d021-0000-7000-8000-00000000000e'],
        },
      ],
      reject: true,
    },
    {
      name: 'positive_allocations_required',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-00000000012d',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '0',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'complete_split_at_commit',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-00000000012e',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '40',
          ],
        },
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-00000000012f',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '60',
          ],
        },
      ],
      query: {
        sql: 'SELECT CAST(sum(amount_minor) AS TEXT) AS total FROM transaction_allocation WHERE transaction_id=?',
        parameters: ['0199d021-0000-7000-8000-0000000000cc'],
        rows: [{ total: '100' }],
      },
    },
    {
      name: 'partial_split_rolls_back_at_commit',
      statements: [
        {
          sql: 'UPDATE transaction_allocation SET amount_minor=? WHERE id=?',
          parameters: ['39', '0199d021-0000-7000-8000-00000000012e'],
        },
      ],
      reject: true,
    },
    {
      name: 'amount_and_split_change_atomically',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET account_amount_minor=? WHERE id=?',
          parameters: ['-101', '0199d021-0000-7000-8000-0000000000cc'],
        },
        {
          sql: 'UPDATE transaction_allocation SET amount_minor=? WHERE id=?',
          parameters: ['61', '0199d021-0000-7000-8000-00000000012f'],
        },
      ],
      query: {
        sql: 'SELECT CAST(sum(amount_minor) AS TEXT) AS total FROM transaction_allocation WHERE transaction_id=?',
        parameters: ['0199d021-0000-7000-8000-0000000000cc'],
        rows: [{ total: '101' }],
      },
    },
    {
      name: 'int64_min_magnitude_without_overflow',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000130',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000ca',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '9223372036854775807',
          ],
        },
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000131',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000ca',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '1',
          ],
        },
      ],
      query: {
        sql: 'SELECT CAST(amount_minor AS TEXT) AS amount FROM transaction_allocation WHERE transaction_id=? ORDER BY id',
        parameters: ['0199d021-0000-7000-8000-0000000000ca'],
        rows: [{ amount: '9223372036854775807' }, { amount: '1' }],
      },
    },
    {
      name: 'low_limb_carry_is_exact',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000132',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cd',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '4294967295',
          ],
        },
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000133',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cd',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '2',
          ],
        },
      ],
      query: {
        sql: 'SELECT CAST(account_amount_minor AS TEXT) AS amount FROM financial_transaction WHERE id=?',
        parameters: ['0199d021-0000-7000-8000-0000000000cd'],
        rows: [{ amount: '-4294967297' }],
      },
    },
    {
      name: 'oversized_split_total_rejected_without_float',
      statements: [
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000134',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000c9',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '9223372036854775807',
          ],
        },
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000135',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000c9',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '9223372036854775807',
          ],
        },
        {
          sql: 'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor) VALUES (?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000136',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000c9',
            '0199d021-0000-7000-8000-000000000015',
            null,
            '1',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'revision_persists_exact_snapshot',
      statements: [
        {
          sql: 'INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source) VALUES (?,?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000191',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '1',
            '{"synthetic_only":true,"account_amount_minor":"-101"}',
            'SYSTEM',
            'SYSTEM',
          ],
        },
      ],
      query: {
        sql: 'SELECT CAST(version AS TEXT) AS version FROM transaction_revision WHERE id=?',
        parameters: ['0199d021-0000-7000-8000-000000000191'],
        rows: [{ version: '1' }],
      },
    },
    {
      name: 'revision_cannot_be_updated',
      statements: [
        {
          sql: 'UPDATE transaction_revision SET snapshot=? WHERE id=?',
          parameters: ['{}', '0199d021-0000-7000-8000-000000000191'],
        },
      ],
      reject: true,
    },
    {
      name: 'revision_cannot_be_deleted',
      statements: [
        {
          sql: 'DELETE FROM transaction_revision WHERE id=?',
          parameters: ['0199d021-0000-7000-8000-000000000191'],
        },
      ],
      reject: true,
    },
    {
      name: 'revision_number_unique',
      statements: [
        {
          sql: 'INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source) VALUES (?,?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-000000000192',
            '0199d021-0000-7000-8000-000000000001',
            '0199d021-0000-7000-8000-0000000000cc',
            '1',
            '{}',
            'SYSTEM',
            'SYSTEM',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'soft_delete_preserves_revision',
      statements: [
        {
          sql: 'UPDATE financial_transaction SET deleted_at=? WHERE id=?',
          parameters: [
            '2026-10-16T01:00:00.000Z',
            '0199d021-0000-7000-8000-0000000000cc',
          ],
        },
      ],
      query: {
        sql: 'SELECT CAST(count(*) AS TEXT) AS count FROM transaction_revision WHERE transaction_id=?',
        parameters: ['0199d021-0000-7000-8000-0000000000cc'],
        rows: [{ count: '1' }],
      },
    },
    {
      name: 'referenced_transaction_cannot_be_deleted',
      statements: [
        {
          sql: 'DELETE FROM financial_transaction WHERE id=?',
          parameters: ['0199d021-0000-7000-8000-0000000000cc'],
        },
      ],
      reject: true,
    },
    {
      name: 'unicode_name_normalization',
      statements: [
        {
          sql: 'INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES (?,?,?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-0000000001f5',
            '0199d021-0000-7000-8000-000000000001',
            '  CAFÉ   Mensal  ',
            'café mensal',
            'BOTH',
            '0',
            'ACTIVE',
            '0',
          ],
        },
      ],
      query: {
        sql: 'SELECT normalized_name FROM category WHERE id=?',
        parameters: ['0199d021-0000-7000-8000-0000000001f5'],
        rows: [{ normalized_name: 'café mensal' }],
      },
    },
    {
      name: 'normalized_active_name_unique',
      statements: [
        {
          sql: 'INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES (?,?,?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-0000000001f6',
            '0199d021-0000-7000-8000-000000000001',
            'café mensal',
            'café mensal',
            'BOTH',
            '0',
            'ACTIVE',
            '0',
          ],
        },
      ],
      reject: true,
    },
    {
      name: 'archived_name_does_not_reserve_active_key',
      statements: [
        {
          sql: 'INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES (?,?,?,?,?,?,?,?)',
          parameters: [
            '0199d021-0000-7000-8000-0000000001f7',
            '0199d021-0000-7000-8000-000000000001',
            'CAFÉ MENSAL',
            'café mensal',
            'BOTH',
            '0',
            'ARCHIVED',
            '0',
          ],
        },
      ],
      query: {
        sql: 'SELECT CAST(count(*) AS TEXT) AS count FROM category WHERE normalized_name=?',
        parameters: ['café mensal'],
        rows: [{ count: '2' }],
      },
    },
    {
      name: 'utc_millisecond_roundtrip',
      statements: [],
      query: {
        sql: 'SELECT CAST(count(*) AS TEXT) AS count FROM financial_transaction WHERE created_at=?',
        parameters: ['2026-10-16T00:00:00.000Z'],
        rows: [{ count: '13' }],
      },
    },
  ],
} as const;
