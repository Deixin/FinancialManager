import { moneyMinor, financialDate } from '@financial-manager/domain';

function isMoney(value: string): boolean {
  try {
    moneyMinor(value);
    return true;
  } catch {
    return false;
  }
}
function isDate(value: string): boolean {
  try {
    financialDate(value);
    return true;
  } catch {
    return false;
  }
}
function isInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    isDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
/** Called by precompiled validators. No evaluation or schema compilation at runtime. */
export const formatValidators = Object.freeze({
  'money-minor': { validate: isMoney },
  'positive-i64': {
    validate: (value: string) => isMoney(value) && BigInt(value) > 0n,
  },
  uuid: {
    validate: (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value,
      ),
  },
  date: { validate: isDate },
  'date-time': { validate: isInstant },
});
