import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DomainError,
  MAX_MONEY_MINOR,
  MIN_MONEY_MINOR,
  moneyMinor,
  moneyInteger,
  fromMoneyInteger,
  addMoney,
  subtractMoney,
  negateMoney,
  sumMoney,
  compareMoney,
  validateAllocationAmounts,
} from '../../packages/domain/dist/index.js';

function rejects(action, code) {
  assert.throws(
    action,
    (error) =>
      error instanceof DomainError &&
      error.code === code &&
      error.message === code,
  );
}

test('MoneyMinor preserves canonical signed i64 strings through JSON', () => {
  for (const value of [
    '0',
    '1',
    '-1',
    '9007199254740993',
    MAX_MONEY_MINOR,
    MIN_MONEY_MINOR,
  ]) {
    const money = moneyMinor(value);
    assert.equal(money, value);
    assert.equal(
      JSON.stringify({ amount_minor: money }),
      `{"amount_minor":"${value}"}`,
    );
    assert.equal(moneyMinor(JSON.parse(JSON.stringify(money))), value);
    assert.equal(fromMoneyInteger(moneyInteger(money)), value);
  }
});

test('MoneyMinor rejects numbers and noncanonical text instead of coercing', () => {
  for (const value of [
    0,
    1,
    0.1,
    9007199254740992,
    NaN,
    Infinity,
    1n,
    null,
    undefined,
    {},
    [],
    '',
    '-0',
    '+1',
    '01',
    '-01',
    '1.00',
    '1e3',
    ' 1',
    '1 ',
    '1\n',
    '١',
    '１',
  ]) {
    rejects(() => moneyMinor(value), 'MONEY_NON_CANONICAL');
  }
  rejects(() => fromMoneyInteger(1), 'MONEY_NON_CANONICAL');
  rejects(() => addMoney(1, moneyMinor('1')), 'MONEY_NON_CANONICAL');
});

test('MoneyMinor checks both i64 boundaries before arithmetic', () => {
  for (const value of [
    '9223372036854775808',
    '-9223372036854775809',
    '9'.repeat(100),
  ])
    rejects(() => moneyMinor(value), 'MONEY_OUT_OF_RANGE');
});

test('monetary operations remain exact above the Number safe integer limit', () => {
  assert.equal(
    addMoney(moneyMinor('9007199254740993'), moneyMinor('2')),
    '9007199254740995',
  );
  assert.equal(
    subtractMoney(
      moneyMinor('9007199254740995'),
      moneyMinor('9007199254740993'),
    ),
    '2',
  );
  assert.equal(
    negateMoney(moneyMinor('-9007199254740993')),
    '9007199254740993',
  );
  assert.equal(
    compareMoney(
      moneyMinor('9007199254740992'),
      moneyMinor('9007199254740993'),
    ),
    -1,
  );
  assert.equal(compareMoney(moneyMinor('-1'), moneyMinor('-2')), 1);
  assert.equal(compareMoney(moneyMinor('0'), moneyMinor('0')), 0);
});

test('overflow is explicit and subtraction handles the asymmetric i64 minimum', () => {
  const min = moneyMinor(MIN_MONEY_MINOR),
    max = moneyMinor(MAX_MONEY_MINOR),
    one = moneyMinor('1');
  rejects(() => addMoney(max, one), 'MONEY_OUT_OF_RANGE');
  rejects(() => subtractMoney(min, one), 'MONEY_OUT_OF_RANGE');
  rejects(() => negateMoney(min), 'MONEY_OUT_OF_RANGE');
  assert.equal(subtractMoney(min, min), '0');
  assert.equal(addMoney(min, max), '-1');
});

test('aggregation uses wider intermediates and is independent of row order', () => {
  const values = [
    moneyMinor(MAX_MONEY_MINOR),
    moneyMinor('1'),
    moneyMinor('-1'),
  ];
  for (const order of [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ])
    assert.equal(
      sumMoney(order.map((index) => values[index])),
      MAX_MONEY_MINOR,
    );
  assert.equal(sumMoney([]), '0');
  rejects(
    () => sumMoney([moneyMinor(MAX_MONEY_MINOR), moneyMinor('1')]),
    'MONEY_OUT_OF_RANGE',
  );
});

test('signed cancellation preserves synthetic values around binary and i64 boundaries', () => {
  const values = [
    '-9223372036854775807',
    '-9007199254740993',
    '-101',
    '0',
    '101',
    '9007199254740993',
    MAX_MONEY_MINOR,
  ].map(moneyMinor);
  for (const value of values) {
    assert.equal(addMoney(value, negateMoney(value)), '0');
    assert.equal(subtractMoney(value, value), '0');
    assert.equal(negateMoney(negateMoney(value)), value);
  }
});

test('allocations are positive exact parts, including the absolute i64 minimum', () => {
  validateAllocationAmounts(moneyMinor('-100'), ['40', '60'].map(moneyMinor));
  validateAllocationAmounts(moneyMinor('100'), ['40', '60'].map(moneyMinor));
  validateAllocationAmounts(
    moneyMinor(MIN_MONEY_MINOR),
    [MAX_MONEY_MINOR, '1'].map(moneyMinor),
  );
  validateAllocationAmounts(moneyMinor('0'), []);
  rejects(
    () =>
      validateAllocationAmounts(
        moneyMinor('100'),
        ['40', '59'].map(moneyMinor),
      ),
    'ALLOCATION_TOTAL_MISMATCH',
  );
  rejects(
    () => validateAllocationAmounts(moneyMinor('100'), []),
    'ALLOCATION_TOTAL_MISMATCH',
  );
  for (const invalid of ['0', '-1'])
    rejects(
      () => validateAllocationAmounts(moneyMinor('100'), [moneyMinor(invalid)]),
      'INVALID_ALLOCATION',
    );
});

test('domain errors expose only stable codes, without supplied monetary content', () => {
  const sentinel = 'synthetic-private-financial-sentinel';
  try {
    moneyMinor(sentinel);
    assert.fail('expected validation failure');
  } catch (error) {
    assert.ok(error instanceof DomainError);
    assert.equal(error.name, 'DomainError');
    assert.ok(!JSON.stringify(error).includes(sentinel));
    assert.ok(!error.stack.includes(sentinel));
  }
});
