import { canonicalFixture as generated } from './generated/canonical.js';
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const canonicalFixture = freeze(generated);
