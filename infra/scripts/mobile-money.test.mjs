import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moneyMinor,
  SYNTHETIC_VECTORS,
  INVALID_VECTORS,
} from '../../apps/mobile/spikes/us-002/money.ts';

test('Mobile money preserves signed INT64 limits and adjacent JavaScript precision values as strings', () => {
  for (const value of SYNTHETIC_VECTORS) {
    assert.equal(moneyMinor(value), BigInt(value).toString());
    assert.equal(
      JSON.parse(JSON.stringify({ amount_minor: value })).amount_minor,
      value,
    );
  }
  assert.equal(moneyMinor('9007199254740993'), '9007199254740993');
});

test('Mobile money rejects noncanonical decimals, numbers and values outside INT64', () => {
  for (const value of [...INVALID_VECTORS, true, {}, [], '١', '\n1', '1\n']) {
    assert.throws(
      () => moneyMinor(value),
      /MONEY_(NON_CANONICAL|OUT_OF_RANGE)/,
    );
  }
});

test('Mobile money validates INT64 boundary neighbors without numeric conversion', () => {
  const max = 9223372036854775807n;
  const min = -9223372036854775808n;
  for (let delta = -20n; delta <= 20n; delta++) {
    for (const value of [max + delta, min + delta]) {
      if (value >= min && value <= max)
        assert.equal(moneyMinor(value.toString()), value.toString());
      else
        assert.throws(() => moneyMinor(value.toString()), /MONEY_OUT_OF_RANGE/);
    }
  }
});
