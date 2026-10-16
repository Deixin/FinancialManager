export type DomainErrorCode =
  | 'MONEY_NON_CANONICAL'
  | 'MONEY_OUT_OF_RANGE'
  | 'UNSUPPORTED_CURRENCY'
  | 'INVALID_ID'
  | 'INVALID_DATE'
  | 'INVALID_ACCOUNT'
  | 'SCOPE_MISMATCH'
  | 'DUPLICATE_ID'
  | 'INVALID_REFERENCE'
  | 'REFERENCE_AFTER_AS_OF'
  | 'INVALID_MOVEMENT'
  | 'INVALID_ECONOMIC_SIGN'
  | 'INVALID_PERIOD'
  | 'INVALID_COMPOSITE'
  | 'NON_POSITIVE_AMOUNT'
  | 'INVALID_ALLOCATION'
  | 'ALLOCATION_TOTAL_MISMATCH';

// Financial values and descriptions never become error messages/metadata.
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
  }
}
