// US-007 representation probe only. Product ports belong to US-013/US-023.
export class PhysicalTypeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function uuidText(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new PhysicalTypeError('INVALID_UUID');
  return value;
}
export function dateText(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '0001-01-01' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new PhysicalTypeError('INVALID_DATE');
  return value;
}
export function instantText(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    value < '0001-01-01' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new PhysicalTypeError('INVALID_INSTANT');
  return value;
}
export function decimalText(value) {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !/^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/.test(value) ||
    value === '-0'
  )
    throw new PhysicalTypeError('INVALID_DECIMAL_EXACT');
  return value;
}
