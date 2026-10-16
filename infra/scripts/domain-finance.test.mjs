import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DomainError,
  moneyMinor,
  MAX_MONEY_MINOR,
  MIN_MONEY_MINOR,
  calculateAccountBalance,
  consolidateBalances,
  financialDate,
  planTransfer,
  planCardPayment,
  validateCompositePlan,
  summarizeMovements,
} from '../../packages/domain/dist/index.js';
import {
  SYNTHETIC_WORKSPACE as workspace,
  SYNTHETIC_ACCOUNTS as accounts,
  SYNTHETIC_REFERENCES as references,
  SYNTHETIC_MOVEMENTS as movements,
  SYNTHETIC_SEPTEMBER_SUMMARY,
  SYNTHETIC_OCTOBER_SUMMARY,
} from '../../packages/test-fixtures/dist/index.js';

const [bank, savings, card] = accounts;
const september = { from: '2026-09-01', to: '2026-09-30' };
const october = { from: '2026-10-01', to: '2026-10-31' };
function rejects(action, code) {
  assert.throws(
    action,
    (error) => error instanceof DomainError && error.code === code,
  );
}
function movement(overrides = {}) {
  return { ...movements[0], ...overrides };
}
function balance(account = bank, overrides = {}) {
  return calculateAccountBalance({
    workspace_id: workspace,
    account,
    reference: references.find(
      (reference) => reference.account_id === account.id,
    ),
    movements: movements.filter((item) => item.account_id === account.id),
    as_of: september.to,
    history_coverage: 'COMPLETE',
    ...overrides,
  });
}
function summary(overrides = {}) {
  return summarizeMovements({
    workspace_id: workspace,
    accounts,
    movements,
    period: september,
    ...overrides,
  });
}
function compositeInput(overrides = {}) {
  return {
    id: 'synthetic-new-group',
    workspace_id: workspace,
    source_account: bank,
    target_account: savings,
    source_entry_id: 'synthetic-new-debit',
    target_entry_id: 'synthetic-new-credit',
    financial_date: '2026-09-20',
    amount_minor: moneyMinor('10000'),
    ...overrides,
  };
}
function confirm(plan) {
  return plan.entries.map((entry) => ({
    ...entry,
    posting_state: 'CONFIRMED',
  }));
}

test('financial dates reject impossible days and instants, accepting valid leap days', () => {
  for (const date of ['0001-01-01', '2024-02-29', '2026-09-30', '9999-12-31'])
    assert.equal(financialDate(date), date);
  for (const date of [
    '0000-01-01',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-9-01',
    '2026-09-01T00:00:00Z',
    '2026-09-01\n',
    null,
  ])
    rejects(() => financialDate(date), 'INVALID_DATE');
});

test('reference 100000 plus income 50000 minus expense 20000 equals 130000', () => {
  assert.equal(
    balance(bank, { movements: movements.slice(0, 2) }).amount_minor,
    '130000',
  );
  assert.equal(
    balance(bank, { movements: movements.slice(0, 2) }).completeness,
    'COMPLETE',
  );
});

test('reference day position includes opening-day movements and excludes closing-day movements', () => {
  const sameDay = movement({
    financial_date: '2026-09-01',
    account_amount_minor: moneyMinor('250'),
  });
  const old = movement({
    id: 'synthetic-older-import',
    financial_date: '2026-08-31',
  });
  const future = movement({
    id: 'synthetic-future',
    financial_date: '2026-10-01',
  });
  const input = { movements: [sameDay, old, future], as_of: '2026-09-01' };
  assert.equal(balance(bank, input).amount_minor, '100250');
  assert.equal(
    balance(bank, {
      ...input,
      reference: { ...references[0], day_position: 'END_OF_DAY' },
    }).amount_minor,
    '100000',
  );
  rejects(
    () => balance(bank, { as_of: '2026-08-31' }),
    'REFERENCE_AFTER_AS_OF',
  );
});

test('staging and deleted movements never affect balances', () => {
  assert.equal(balance().amount_minor, '120000');
  assert.equal(
    balance(bank, {
      movements: movements.filter(
        (item) =>
          item.account_id === bank.id && item.posting_state === 'CONFIRMED',
      ),
    }).amount_minor,
    '120000',
  );
});

test('missing reference and incomplete or unknown history remain explicit', () => {
  const missing = balance(bank, {
    reference: null,
    movements: movements.slice(0, 2),
  });
  assert.equal(missing.amount_minor, '30000');
  assert.equal(missing.completeness, 'INCOMPLETE');
  assert.deepEqual(missing.warnings, ['MISSING_REFERENCE']);
  for (const [history_coverage, warning] of [
    ['INCOMPLETE', 'INCOMPLETE_HISTORY'],
    ['UNKNOWN', 'UNKNOWN_HISTORY'],
  ]) {
    const result = balance(bank, { history_coverage });
    assert.equal(result.amount_minor, '120000');
    assert.equal(result.completeness, 'INCOMPLETE');
    assert.deepEqual(result.warnings, [warning]);
  }
});

test('balances reject ambiguous references, duplicate IDs and invalid movement state', () => {
  for (const reference of [
    { ...references[0], status: 'SUPERSEDED' },
    { ...references[0], day_position: undefined },
  ])
    rejects(() => balance(bank, { reference }), 'INVALID_REFERENCE');
  rejects(
    () => balance(bank, { movements: [movements[0], movements[0]] }),
    'DUPLICATE_ID',
  );
  rejects(
    () =>
      balance(bank, { movements: [movement({ posting_state: 'PENDING' })] }),
    'INVALID_MOVEMENT',
  );
});

test('balances enforce workspace, account and BRL boundaries even for ignored rows', () => {
  rejects(
    () => balance({ ...bank, workspace_id: 'synthetic-other-workspace' }),
    'SCOPE_MISMATCH',
  );
  rejects(
    () =>
      balance(bank, {
        reference: { ...references[0], account_id: savings.id },
      }),
    'SCOPE_MISMATCH',
  );
  rejects(
    () =>
      balance(bank, {
        movements: [
          movement({ account_id: savings.id, posting_state: 'STAGING' }),
        ],
      }),
    'SCOPE_MISMATCH',
  );
  rejects(
    () =>
      balance(bank, {
        movements: [movement({ workspace_id: 'synthetic-other-workspace' })],
      }),
    'SCOPE_MISMATCH',
  );
  rejects(
    () => balance({ ...bank, currency_code: 'USD' }),
    'UNSUPPORTED_CURRENCY',
  );
});

test('consolidation separates assets and debt and preserves negative card credit', () => {
  const septemberBalances = accounts.map((account) => balance(account));
  const result = consolidateBalances(workspace, septemberBalances);
  assert.deepEqual(result, {
    currency_code: 'BRL',
    as_of: september.to,
    asset_balance_minor: '130000',
    liability_balance_minor: '12000',
    net_worth_minor: '118000',
    completeness: 'COMPLETE',
  });
  assert.equal(balance(card, { as_of: october.to }).amount_minor, '-2000');
  assert.equal(
    consolidateBalances(
      workspace,
      accounts.map((account) => balance(account, { as_of: october.to })),
    ).net_worth_minor,
    '120000',
  );
});

test('consolidation uses only supplied authorized accounts and propagates incomplete history', () => {
  const result = consolidateBalances(workspace, [balance()]);
  assert.equal(result.asset_balance_minor, '120000');
  assert.equal(result.liability_balance_minor, '0');
  assert.equal(
    consolidateBalances(workspace, [balance(bank, { reference: null })])
      .completeness,
    'INCOMPLETE',
  );
  assert.equal(consolidateBalances(workspace, []).completeness, 'INCOMPLETE');
});

test('consolidation rejects mixed scopes, dates, currencies, duplicate accounts and forged completeness', () => {
  const original = balance();
  rejects(
    () => consolidateBalances(workspace, [original, original]),
    'DUPLICATE_ID',
  );
  rejects(
    () =>
      consolidateBalances(workspace, [
        { ...original, workspace_id: 'synthetic-other-workspace' },
      ]),
    'SCOPE_MISMATCH',
  );
  rejects(
    () =>
      consolidateBalances(workspace, [{ ...original, currency_code: 'USD' }]),
    'UNSUPPORTED_CURRENCY',
  );
  rejects(
    () =>
      consolidateBalances(workspace, [
        original,
        balance(savings, { as_of: october.to }),
      ]),
    'INVALID_PERIOD',
  );
  rejects(
    () =>
      consolidateBalances(workspace, [
        { ...original, warnings: ['MISSING_REFERENCE'] },
      ]),
    'INVALID_REFERENCE',
  );
});

test('balance aggregation uses wide intermediates but rejects final i64 overflow', () => {
  const reference = {
    ...references[0],
    amount_minor: moneyMinor(MAX_MONEY_MINOR),
  };
  const entries = [
    movement({ account_amount_minor: moneyMinor('1') }),
    movement({
      id: 'synthetic-offset',
      account_amount_minor: moneyMinor('-1'),
      economic_kind: 'ADJUSTMENT',
    }),
  ];
  assert.equal(
    balance(bank, { reference, movements: entries }).amount_minor,
    MAX_MONEY_MINOR,
  );
  rejects(
    () => balance(bank, { reference, movements: entries.slice(0, 1) }),
    'MONEY_OUT_OF_RANGE',
  );
  const maxBalance = balance(bank, { reference, movements: [] });
  const minLiability = balance(card, {
    reference: { ...references[2], amount_minor: moneyMinor(MIN_MONEY_MINOR) },
    movements: [],
  });
  rejects(
    () => consolidateBalances(workspace, [maxBalance, minLiability]),
    'MONEY_OUT_OF_RANGE',
  );
});

test('transfer creates two immutable opposite legs and preserves consolidated wealth', () => {
  const plan = planTransfer(compositeInput());
  assert.equal(plan.group_type, 'TRANSFER');
  assert.deepEqual(
    plan.entries.map((entry) => [
      entry.account_id,
      entry.account_amount_minor,
      entry.economic_kind,
    ]),
    [
      [bank.id, '-10000', 'TRANSFER'],
      [savings.id, '10000', 'TRANSFER'],
    ],
  );
  assert.ok(plan.entries.every((entry) => entry.group_id === plan.id));
  validateCompositePlan(JSON.parse(JSON.stringify(plan)), accounts);
  const confirmed = confirm(plan);
  const before = consolidateBalances(workspace, [
    balance(bank, { movements: [] }),
    balance(savings, { movements: [] }),
  ]);
  const after = consolidateBalances(
    workspace,
    [bank, savings].map((account) =>
      balance(account, {
        movements: confirmed.filter((entry) => entry.account_id === account.id),
      }),
    ),
  );
  assert.equal(after.asset_balance_minor, before.asset_balance_minor);
  assert.equal(summary({ movements: confirmed }).expense_minor, '0');
  assert.equal(summary({ movements: confirmed }).income_minor, '0');
  assert.equal(summary({ movements: confirmed }).cash_net_minor, '0');
  assert.throws(() => {
    plan.entries[0].account_amount_minor = moneyMinor('1');
  }, TypeError);
  assert.throws(() => {
    plan.entries.pop();
  }, TypeError);
});

test('transfer conservation holds for cents, values above 2^53 and the largest positive i64', () => {
  for (const amount of ['1', '101', '9007199254740993', MAX_MONEY_MINOR]) {
    const plan = planTransfer(
      compositeInput({ amount_minor: moneyMinor(amount) }),
    );
    assert.equal(
      BigInt(plan.entries[0].account_amount_minor) +
        BigInt(plan.entries[1].account_amount_minor),
      0n,
    );
    assert.equal(plan.entries[1].account_amount_minor, amount);
  }
});

test('card payment reduces bank and card debt without another economic expense', () => {
  const plan = planCardPayment(
    compositeInput({ target_account: card, amount_minor: moneyMinor('12000') }),
  );
  assert.equal(plan.group_type, 'CARD_PAYMENT');
  assert.deepEqual(
    plan.entries.map((entry) => entry.account_amount_minor),
    ['-12000', '-12000'],
  );
  const paid = confirm(plan);
  assert.equal(
    balance(card, { movements: [movements[2], paid[1]] }).amount_minor,
    '0',
  );
  assert.equal(balance(bank, { movements: [paid[0]] }).amount_minor, '88000');
  const report = summary({ movements: paid });
  assert.equal(report.expense_minor, '0');
  assert.equal(report.cash_out_minor, '12000');
  assert.equal(report.economic_result_minor, '0');
});

test('partial payments and overpayments remain exact without inventing future interest', () => {
  for (const [amount, debt] of [
    ['5000', '7000'],
    ['13000', '-1000'],
  ]) {
    const plan = planCardPayment(
      compositeInput({
        target_account: card,
        amount_minor: moneyMinor(amount),
      }),
    );
    assert.equal(
      balance(card, { movements: [movements[2], confirm(plan)[1]] })
        .amount_minor,
      debt,
    );
  }
});

test('new composites reject cross-workspace, archived, same-account and incompatible account natures', () => {
  rejects(
    () =>
      planTransfer(
        compositeInput({
          target_account: { ...savings, workspace_id: 'synthetic-other' },
        }),
      ),
    'SCOPE_MISMATCH',
  );
  rejects(
    () =>
      planTransfer(
        compositeInput({ target_account: { ...savings, status: 'ARCHIVED' } }),
      ),
    'INVALID_COMPOSITE',
  );
  rejects(
    () => planTransfer(compositeInput({ target_account: bank })),
    'INVALID_COMPOSITE',
  );
  rejects(
    () => planTransfer(compositeInput({ target_account: card })),
    'INVALID_COMPOSITE',
  );
  rejects(() => planCardPayment(compositeInput()), 'INVALID_COMPOSITE');
  rejects(
    () =>
      planCardPayment(
        compositeInput({ source_account: card, target_account: bank }),
      ),
    'INVALID_COMPOSITE',
  );
  for (const amount of ['0', '-1'])
    rejects(
      () => planTransfer(compositeInput({ amount_minor: moneyMinor(amount) })),
      'NON_POSITIVE_AMOUNT',
    );
  rejects(
    () =>
      planTransfer(compositeInput({ target_entry_id: 'synthetic-new-debit' })),
    'DUPLICATE_ID',
  );
});

test('composite validation rejects partial or tampered legs after JSON transport', () => {
  const plan = planTransfer(compositeInput());
  const mutations = [
    (clone) => clone.entries.pop(),
    (clone) => {
      clone.entries[1].account_amount_minor = '9999';
    },
    (clone) => {
      clone.entries[1].group_id = 'synthetic-wrong-group';
    },
    (clone) => {
      clone.entries[1].financial_date = '2026-09-21';
    },
    (clone) => {
      clone.entries[1].economic_kind = 'INCOME';
    },
  ];
  for (const mutate of mutations) {
    const copy = JSON.parse(JSON.stringify(plan));
    mutate(copy);
    rejects(() => validateCompositePlan(copy, accounts), 'INVALID_COMPOSITE');
  }
  const payment = planCardPayment(compositeInput({ target_account: card }));
  rejects(
    () =>
      validateCompositePlan(
        {
          ...payment,
          entries: [
            payment.entries[0],
            {
              ...payment.entries[1],
              account_amount_minor: moneyMinor('10000'),
            },
          ],
        },
        accounts,
      ),
    'INVALID_COMPOSITE',
  );
});

test('consumption and cash flow match independent synthetic monthly golden totals', () => {
  assert.deepEqual(summary(), SYNTHETIC_SEPTEMBER_SUMMARY);
  assert.deepEqual(summary({ period: october }), SYNTHETIC_OCTOBER_SUMMARY);
  assert.deepEqual(
    summary({ movements: [...movements].reverse() }),
    SYNTHETIC_SEPTEMBER_SUMMARY,
  );
});

test('a September card purchase and October payment are never counted twice', () => {
  const entries = movements.filter((entry) =>
    [
      'synthetic-purchase',
      'synthetic-payment-bank',
      'synthetic-payment-card',
    ].includes(entry.id),
  );
  const bought = summary({ movements: entries });
  assert.equal(bought.expense_minor, '12000');
  assert.equal(bought.cash_out_minor, '0');
  const paid = summary({ movements: entries, period: october });
  assert.equal(paid.expense_minor, '0');
  assert.equal(paid.cash_out_minor, '12000');
  assert.equal(
    summary({
      movements: entries,
      period: { from: september.from, to: october.to },
    }).expense_minor,
    '12000',
  );
});

test('later refunds affect their financial date without rewriting prior consumption', () => {
  assert.equal(summary().expense_reversal_minor, '0');
  const refunded = summary({ movements: [movements[7]], period: october });
  assert.equal(refunded.expense_reversal_minor, '2000');
  assert.equal(refunded.net_expense_minor, '-2000');
  assert.equal(refunded.cash_in_minor, '0');
});

test('economic classification is explicit and never inferred from adjustment signs', () => {
  const entries = [
    'ADJUSTMENT',
    'OTHER',
    'TRANSFER',
    'DEBT_SETTLEMENT',
  ].flatMap((kind, index) => [
    movement({
      id: `synthetic-positive-${index}`,
      economic_kind: kind,
      account_amount_minor: moneyMinor('100'),
    }),
    movement({
      id: `synthetic-negative-${index}`,
      economic_kind: kind,
      account_amount_minor: moneyMinor('-100'),
    }),
  ]);
  const report = summary({ movements: entries });
  assert.equal(report.income_minor, '0');
  assert.equal(report.expense_minor, '0');
  assert.equal(report.expense_reversal_minor, '0');
  assert.equal(report.economic_result_minor, '0');
  assert.equal(report.cash_in_minor, '400');
  assert.equal(report.cash_out_minor, '400');
});

test('report boundaries are inclusive and staging/deleted projections are ignored', () => {
  const report = summary({ period: { from: '2026-09-02', to: '2026-09-03' } });
  assert.equal(report.income_minor, '50000');
  assert.equal(report.expense_minor, '20000');
  assert.deepEqual(
    summary({
      movements: movements.filter(
        (entry) => entry.posting_state === 'CONFIRMED',
      ),
    }),
    summary(),
  );
  assert.equal(summary({ movements: [] }).cash_net_minor, '0');
});

test('reports reject unknown accounts, duplicate movements, wrong scopes and reversed periods', () => {
  rejects(() => summary({ accounts: [bank] }), 'SCOPE_MISMATCH');
  rejects(() => summary({ accounts: [bank, bank] }), 'DUPLICATE_ID');
  rejects(
    () => summary({ movements: [movements[0], movements[0]] }),
    'DUPLICATE_ID',
  );
  rejects(
    () =>
      summary({ movements: [movement({ workspace_id: 'synthetic-other' })] }),
    'SCOPE_MISMATCH',
  );
  rejects(
    () => summary({ period: { from: september.to, to: september.from } }),
    'INVALID_PERIOD',
  );
  rejects(
    () =>
      summary({ accounts: [{ ...bank, currency_code: 'EUR' }], movements: [] }),
    'UNSUPPORTED_CURRENCY',
  );
});

test('reports validate economic signs according to asset or liability nature', () => {
  for (const entry of [
    movement({ account_amount_minor: moneyMinor('-1') }),
    movement({
      economic_kind: 'EXPENSE',
      account_amount_minor: moneyMinor('1'),
    }),
    movement({
      economic_kind: 'EXPENSE_REVERSAL',
      account_amount_minor: moneyMinor('-1'),
    }),
    movement({
      account_id: card.id,
      economic_kind: 'EXPENSE',
      account_amount_minor: moneyMinor('-1'),
    }),
  ])
    rejects(() => summary({ movements: [entry] }), 'INVALID_ECONOMIC_SIGN');
});

test('report totals overflow explicitly rather than rounding or silently changing units', () => {
  const entries = [
    movement({ account_amount_minor: moneyMinor(MAX_MONEY_MINOR) }),
    movement({
      id: 'synthetic-extra-cent',
      account_amount_minor: moneyMinor('1'),
    }),
  ];
  rejects(() => summary({ movements: entries }), 'MONEY_OUT_OF_RANGE');
  rejects(
    () =>
      summary({
        movements: [
          movement({
            economic_kind: 'EXPENSE',
            account_amount_minor: moneyMinor(MIN_MONEY_MINOR),
          }),
        ],
      }),
    'MONEY_OUT_OF_RANGE',
  );
});

test('pure calculations leave caller inputs intact and return immutable projections', () => {
  const before = JSON.stringify({ accounts, references, movements });
  const computed = balance();
  const consolidated = consolidateBalances(workspace, [computed]);
  const report = summary();
  planTransfer(compositeInput());
  assert.equal(JSON.stringify({ accounts, references, movements }), before);
  assert.ok(Object.isFrozen(computed));
  assert.ok(Object.isFrozen(computed.warnings));
  assert.ok(Object.isFrozen(consolidated));
  assert.ok(Object.isFrozen(report));
});
