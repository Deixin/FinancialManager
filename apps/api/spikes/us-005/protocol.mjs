// Experimental protocol for synthetic US-005 records, not the product schema.
export class SyncError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
export const counter = (value) =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= 9223372036854775807n;
const fields = ['amount_minor', 'description', 'date'];
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function validatePatch(patch, complete = false) {
  if (
    !object(patch) ||
    Object.keys(patch).some((key) => !fields.includes(key)) ||
    (complete && fields.some((key) => !(key in patch)))
  )
    throw new SyncError('INVALID_OPERATION');
  if (
    'amount_minor' in patch &&
    (typeof patch.amount_minor !== 'string' ||
      !/^(0|-?[1-9][0-9]*)$/.test(patch.amount_minor) ||
      patch.amount_minor.length > 20 ||
      BigInt(patch.amount_minor) < -9223372036854775808n ||
      BigInt(patch.amount_minor) > 9223372036854775807n)
  )
    throw new SyncError('INVALID_OPERATION');
  if (
    'description' in patch &&
    (typeof patch.description !== 'string' || patch.description.length > 160)
  )
    throw new SyncError('INVALID_OPERATION');
  if (
    'date' in patch &&
    (typeof patch.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(patch.date) ||
      !Number.isFinite(Date.parse(patch.date)) ||
      new Date(patch.date).toISOString().slice(0, 10) !== patch.date)
  )
    throw new SyncError('INVALID_OPERATION');
}
export function validateOperation(op) {
  const keys = [
    'operation_id',
    'workspace_id',
    'generation',
    'entity_id',
    'account_id',
    'base_revision',
    'operation',
    'patch',
    'changed_fields',
    'client_timestamp',
    'resolves',
  ];
  if (
    !object(op) ||
    Object.keys(op).some((key) => !keys.includes(key)) ||
    [
      'operation_id',
      'workspace_id',
      'generation',
      'entity_id',
      'account_id',
    ].some((key) => !uuid(op[key])) ||
    !counter(op.base_revision) ||
    !['UPSERT', 'DELETE'].includes(op.operation) ||
    !Array.isArray(op.changed_fields) ||
    typeof op.client_timestamp !== 'string' ||
    !Number.isFinite(Date.parse(op.client_timestamp)) ||
    (op.resolves !== undefined && !uuid(op.resolves))
  )
    throw new SyncError('INVALID_OPERATION');
  validatePatch(op.patch);
  const expected =
    op.operation === 'DELETE' ? ['$deleted'] : Object.keys(op.patch).sort();
  if (
    expected.length === 0 ||
    (op.operation === 'DELETE' && Object.keys(op.patch).length !== 0) ||
    JSON.stringify([...op.changed_fields].sort()) !== JSON.stringify(expected)
  )
    throw new SyncError('INVALID_OPERATION');
  return op;
}
// Stable fingerprint independent of JSON key order; IDs bind to the full proposal.
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function mergeStatus(op, remote, changedSinceBase) {
  if (!remote) {
    if (op.base_revision !== '0' || op.operation === 'DELETE')
      throw new SyncError('INVALID_BASE');
    validatePatch(op.patch, true);
    return 'APPLIED';
  }
  if (BigInt(op.base_revision) > BigInt(remote.version))
    throw new SyncError('INVALID_BASE');
  if (op.base_revision === '0' || remote.deleted) return 'CONFLICT';
  if (op.base_revision === remote.version) return 'APPLIED';
  if (
    op.operation === 'DELETE' ||
    changedSinceBase.includes('$deleted') ||
    op.changed_fields.some((key) => changedSinceBase.includes(key))
  )
    return 'CONFLICT';
  return 'MERGED';
}
