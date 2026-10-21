import { requireId, financialDate } from './model.js';
import { utcInstant } from './time.js';

export const importStatuses = Object.freeze([
  'PREPARING',
  'REVIEW',
  'CONFIRMING',
  'COMMITTED',
  'FAILED',
  'REVERSED',
  'PARTIALLY_REVERSED',
] as const);
export type ImportStatus = (typeof importStatuses)[number];
export const itemDispositions = Object.freeze([
  'NEW',
  'DUPLICATE',
  'POSSIBLE_DUPLICATE',
  'UPDATE',
  'INVALID',
  'SKIPPED',
  'COMMITTED',
] as const);
export const effectActions = Object.freeze([
  'CREATE',
  'UPDATE',
  'LINK',
  'UNLINK',
  'RESTORE',
  'DELETE',
] as const);
const errors = [
  'INVALID_IMPORT_REQUEST',
  'INVALID_IMPORT_STATE',
  'IMPORT_LIMIT',
  'IMPORT_NOT_FOUND',
  'IMPORT_BASE_CONFLICT',
  'IMPORT_ACCOUNT_UNAVAILABLE',
  'ACCESS_DENIED',
  'CONFIGURATION_INVALID',
  'DATA_ACCESS_FAILED',
  'CLOSED',
  'NESTED_UNIT',
] as const;
export class ImportCentralError extends Error {
  readonly code: (typeof errors)[number];
  constructor(code: (typeof errors)[number]) {
    const safe = errors.includes(code) ? code : 'DATA_ACCESS_FAILED';
    super(safe);
    this.name = 'ImportCentralError';
    this.code = safe;
  }
}
function fail(): never {
  throw new ImportCentralError('INVALID_IMPORT_STATE');
}
export function importExact(
  v: unknown,
  keys: readonly string[],
): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== [...keys].sort().join(',')
  )
    fail();
}
function optionalId(v: unknown) {
  if (v !== null) requireId(v);
  return v as string | null;
}
function label(v: unknown, max: number) {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v !== v.trim() ||
    v.length > max ||
    /\p{Cc}/u.test(v)
  )
    fail();
  return v;
}
export function importCount(v: unknown): string {
  if (
    typeof v !== 'string' ||
    v.length > 19 ||
    !/^(0|[1-9]\d*)$/.test(v) ||
    BigInt(v) > 9223372036854775807n
  )
    fail();
  return v;
}
export interface ImportBatch {
  readonly id: string;
  readonly workspace_id: string;
  readonly target_account_id: string | null;
  readonly batch_kind: 'IMPORT' | 'REVERSAL';
  readonly status: ImportStatus;
  readonly reverses_batch_id: string | null;
  readonly created_by_member_id: string | null;
  readonly created_at: string;
  readonly committed_at: string | null;
  readonly version: string;
  readonly failure_code: string | null;
}
export function captureImportBatch(raw: unknown, w: string): ImportBatch {
  try {
    importExact(raw, [
      'id',
      'workspace_id',
      'target_account_id',
      'batch_kind',
      'status',
      'reverses_batch_id',
      'created_by_member_id',
      'created_at',
      'committed_at',
      'version',
      'failure_code',
    ]);
    requireId(w);
    requireId(raw.id);
    if (raw.workspace_id !== w) fail();
    const account = optionalId(raw.target_account_id),
      reverses = optionalId(raw.reverses_batch_id),
      actor = optionalId(raw.created_by_member_id);
    if (
      !['IMPORT', 'REVERSAL'].includes(raw.batch_kind as string) ||
      !importStatuses.includes(raw.status as ImportStatus)
    )
      fail();
    if (
      (raw.batch_kind === 'IMPORT' && reverses !== null) ||
      (raw.batch_kind === 'REVERSAL' &&
        (reverses === null || reverses === raw.id))
    )
      fail();
    const at = utcInstant(raw.created_at),
      committed =
        raw.committed_at === null ? null : utcInstant(raw.committed_at),
      version = importCount(raw.version);
    if (
      version === '0' ||
      (committed !== null && committed < at) ||
      ['COMMITTED', 'REVERSED', 'PARTIALLY_REVERSED'].includes(
        raw.status as string,
      ) !==
        (committed !== null)
    )
      fail();
    const failure =
      raw.failure_code === null ? null : label(raw.failure_code, 64);
    if (
      (raw.status === 'FAILED') !== (failure !== null) ||
      (failure !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(failure))
    )
      fail();
    return Object.freeze({
      id: raw.id as string,
      workspace_id: w,
      target_account_id: account,
      batch_kind: raw.batch_kind as ImportBatch['batch_kind'],
      status: raw.status as ImportStatus,
      reverses_batch_id: reverses,
      created_by_member_id: actor,
      created_at: at,
      committed_at: committed,
      version,
      failure_code: failure,
    });
  } catch {
    return fail();
  }
}
export interface ImportSource {
  readonly id: string;
  readonly workspace_id: string;
  readonly batch_id: string;
  readonly file_name: string;
  readonly file_hash: string;
  readonly format: string;
  readonly parser_name: string | null;
  readonly parser_version: string | null;
  readonly detected_currency: string | null;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly imported_at: string;
}
export function captureImportSource(
  raw: unknown,
  w: string,
  batch: string,
): ImportSource {
  try {
    importExact(raw, [
      'id',
      'workspace_id',
      'batch_id',
      'file_name',
      'file_hash',
      'format',
      'parser_name',
      'parser_version',
      'detected_currency',
      'period_start',
      'period_end',
      'imported_at',
    ]);
    requireId(w);
    requireId(batch);
    requireId(raw.id);
    if (raw.workspace_id !== w || raw.batch_id !== batch) fail();
    const name = label(raw.file_name, 255),
      format = label(raw.format, 32);
    if (
      /[\\/:]/.test(name) ||
      name === '.' ||
      name === '..' ||
      !/^\w[\w.-]{0,31}$/u.test(format) ||
      typeof raw.file_hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.file_hash)
    )
      fail();
    if ((raw.parser_name === null) !== (raw.parser_version === null)) fail();
    const parser =
        raw.parser_name === null ? null : label(raw.parser_name, 120),
      version =
        raw.parser_version === null ? null : label(raw.parser_version, 40);
    const currency =
      raw.detected_currency === null ? null : label(raw.detected_currency, 3);
    if (currency !== null && !/^[A-Z]{3}$/.test(currency)) fail();
    const start =
        raw.period_start === null ? null : financialDate(raw.period_start),
      end = raw.period_end === null ? null : financialDate(raw.period_end);
    if (start !== null && end !== null && start > end) fail();
    return Object.freeze({
      id: raw.id as string,
      workspace_id: w,
      batch_id: batch,
      file_name: name,
      file_hash: raw.file_hash,
      format,
      parser_name: parser,
      parser_version: version,
      detected_currency: currency,
      period_start: start,
      period_end: end,
      imported_at: utcInstant(raw.imported_at),
    });
  } catch {
    return fail();
  }
}
export interface ImportCounts {
  readonly items: Readonly<Record<(typeof itemDispositions)[number], string>>;
  readonly effects: Readonly<Record<(typeof effectActions)[number], string>>;
  readonly total_items: string;
  readonly total_effects: string;
}
export function captureImportCounts(raw: unknown): ImportCounts {
  importExact(raw, ['items', 'effects', 'total_items', 'total_effects']);
  importExact(raw.items, itemDispositions);
  importExact(raw.effects, effectActions);
  const items = Object.fromEntries(
    itemDispositions.map((k) => [
      k,
      importCount((raw.items as Record<string, unknown>)[k]),
    ]),
  ) as unknown as ImportCounts['items'];
  const effects = Object.fromEntries(
    effectActions.map((k) => [
      k,
      importCount((raw.effects as Record<string, unknown>)[k]),
    ]),
  ) as unknown as ImportCounts['effects'];
  const total_items = importCount(raw.total_items),
    total_effects = importCount(raw.total_effects);
  if (
    Object.values(items).reduce((a, n) => a + BigInt(n), 0n) !==
      BigInt(total_items) ||
    Object.values(effects).reduce((a, n) => a + BigInt(n), 0n) !==
      BigInt(total_effects)
  )
    fail();
  return Object.freeze({
    items: Object.freeze(items),
    effects: Object.freeze(effects),
    total_items,
    total_effects,
  });
}
export interface ImportEffect {
  readonly id: string;
  readonly workspace_id: string;
  readonly batch_id: string;
  readonly import_item_id: string;
  readonly transaction_id: string;
  readonly action: (typeof effectActions)[number];
  readonly before_revision_id: string | null;
  readonly after_revision_id: string | null;
  readonly created_at: string;
}
export function captureImportEffect(
  raw: unknown,
  w: string,
  batch: string,
): ImportEffect {
  requireId(w);
  requireId(batch);
  importExact(raw, [
    'id',
    'workspace_id',
    'batch_id',
    'import_item_id',
    'transaction_id',
    'action',
    'before_revision_id',
    'after_revision_id',
    'created_at',
  ]);
  for (const k of ['id', 'import_item_id', 'transaction_id']) requireId(raw[k]);
  if (
    raw.workspace_id !== w ||
    raw.batch_id !== batch ||
    !effectActions.includes(raw.action as ImportEffect['action'])
  )
    fail();
  const before = optionalId(raw.before_revision_id),
    after = optionalId(raw.after_revision_id);
  if (
    (raw.action === 'CREATE' && (before !== null || after === null)) ||
    (['UPDATE', 'RESTORE', 'DELETE'].includes(raw.action as string) &&
      (before === null || after === null || before === after))
  )
    fail();
  return Object.freeze({
    ...raw,
    before_revision_id: before,
    after_revision_id: after,
    created_at: utcInstant(raw.created_at),
  }) as unknown as ImportEffect;
}
export interface ImportCursor {
  readonly created_at: string;
  readonly id: string;
}
export interface ImportQuery {
  readonly statuses: readonly ImportStatus[];
  readonly account_id: string | null;
  readonly cursor: ImportCursor | null;
  readonly limit: number;
}
export function captureImportQuery(raw: ImportQuery): ImportQuery {
  try {
    importExact(raw, ['statuses', 'account_id', 'cursor', 'limit']);
    if (
      !Array.isArray(raw.statuses) ||
      raw.statuses.length > importStatuses.length ||
      new Set(raw.statuses).size !== raw.statuses.length ||
      Array.from(raw.statuses).some((s) => !importStatuses.includes(s)) ||
      !Number.isSafeInteger(raw.limit) ||
      raw.limit < 1 ||
      raw.limit > 100
    )
      fail();
    const cursor = raw.cursor;
    if (cursor !== null) {
      importExact(cursor, ['created_at', 'id']);
      requireId(cursor.id);
      utcInstant(cursor.created_at);
    }
    return Object.freeze({
      statuses: Object.freeze([...raw.statuses]),
      account_id: optionalId(raw.account_id),
      cursor:
        cursor === null
          ? null
          : Object.freeze({
              id: cursor.id,
              created_at: utcInstant(cursor.created_at),
            }),
      limit: raw.limit,
    });
  } catch {
    throw new ImportCentralError('INVALID_IMPORT_REQUEST');
  }
}
export const defaultImportQuery: ImportQuery = Object.freeze({
  statuses: Object.freeze([]),
  account_id: null,
  cursor: null,
  limit: 50,
});
