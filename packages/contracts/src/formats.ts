import {
  moneyMinor,
  financialDate,
  utcInstant,
} from '@financial-manager/domain';
import { resourceId } from './identity.js';

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
  try {
    utcInstant(value);
    return true;
  } catch {
    return false;
  }
}
/** Called by precompiled validators. No evaluation or schema compilation at runtime. */
export const formatValidators = Object.freeze({
  'money-minor': { validate: isMoney },
  'positive-i64': {
    validate: (value: string) => isMoney(value) && BigInt(value) > 0n,
  },
  uuid: {
    validate: (value: string) => {
      try {
        resourceId(value);
        return true;
      } catch {
        return false;
      }
    },
  },
  date: { validate: isDate },
  'date-time': { validate: isInstant },
});
