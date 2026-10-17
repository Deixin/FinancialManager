import { financialDate, requireId, validateAccount } from './model.js';
import type { EconomicKind, Account } from './model.js';
import { utcInstant } from './time.js';
import type { UtcInstant } from './time.js';
import { moneyMinor, validateAllocationAmounts } from './money.js';
import type { MoneyMinor } from './money.js';
const codes = [
  'INVALID_REVISION',
  'VERSION_CONFLICT',
  'VERSION_EXHAUSTED',
  'ORIGIN_IMMUTABLE',
  'COMPOSITE_REQUIRED',
  'REVERSAL_CONFLICT',
  'INVALID_SNAPSHOT',
  'NOT_FOUND',
  'ACCESS_DENIED',
  'INVALID_AUTHORIZATION',
  'DATA_ACCESS_FAILED',
  'UNIT_OF_WORK_FAILED',
  'CLOSED',
  'BUSY',
  'NESTED_UNIT',
  'CONFIGURATION_INVALID',
] as const;
export type RevisionErrorCode = (typeof codes)[number];
export class RevisionError extends Error {
  readonly code: RevisionErrorCode;
  constructor(code: RevisionErrorCode) {
    const safe = codes.includes(code) ? code : 'UNIT_OF_WORK_FAILED';
    super(safe);
    this.name = 'RevisionError';
    this.code = safe;
  }
}
export interface RevisionAllocation {
  readonly id: string;
  readonly category_id: string;
  readonly subcategory_id: string | null;
  readonly amount_minor: MoneyMinor;
  readonly note: string | null;
}
export interface RevisionContent {
  readonly account_id: string;
  readonly group_id: string | null;
  readonly counterparty_id: string | null;
  readonly financial_date: string;
  readonly account_amount_minor: MoneyMinor;
  readonly economic_kind: EconomicKind;
  readonly original_description: string | null;
  readonly display_name: string;
  readonly origin_kind: 'MANUAL' | 'IMPORT' | 'DOCUMENT' | 'SYSTEM';
  readonly deleted: boolean;
  readonly allocations: readonly RevisionAllocation[];
  readonly tag_ids: readonly string[];
}
export interface RevisionState {
  readonly workspace_id: string;
  readonly id: string;
  readonly version: string;
  readonly created_at: UtcInstant;
  readonly updated_at: UtcInstant;
  readonly deleted_at: UtcInstant | null;
  readonly content: RevisionContent;
}
export interface RevisionChange {
  readonly id: string;
  readonly base_revision: string;
  readonly content: RevisionContent;
}
export interface RevisionSnapshot {
  readonly format_version: 1;
  readonly base_revision: string;
  readonly before: RevisionState | null;
  readonly after: RevisionState;
}
export interface RevisionPlan {
  readonly changed: boolean;
  readonly before: RevisionState | null;
  readonly after: RevisionState;
  readonly snapshot: RevisionSnapshot | null;
}
const contentKeys = [
  'account_id',
  'group_id',
  'counterparty_id',
  'financial_date',
  'account_amount_minor',
  'economic_kind',
  'original_description',
  'display_name',
  'origin_kind',
  'deleted',
  'allocations',
  'tag_ids',
];
function keys(value: object, expected: readonly string[]) {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...expected].sort().join(',')
  )
    throw new RevisionError('INVALID_REVISION');
}
function id(value: string): string {
  requireId(value);
  return value;
}
function nullableId(value: string | null) {
  return value === null ? null : id(value);
}
function text(value: string, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()))
    throw new RevisionError('INVALID_REVISION');
  return value;
}
function nullableText(value: string | null) {
  return value === null ? null : text(value, true);
}
export function revisionVersion(value: unknown, allowZero = false): string {
  if (
    typeof value !== 'string' ||
    value.length > 19 ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    (!allowZero && value === '0') ||
    BigInt(value) > 9223372036854775807n
  )
    throw new RevisionError('INVALID_REVISION');
  return value;
}
export function nextRevision(value: string): string {
  revisionVersion(value, true);
  if (value === '9223372036854775807')
    throw new RevisionError('VERSION_EXHAUSTED');
  return (BigInt(value) + 1n).toString();
}
export function captureRevisionContent(
  input: RevisionContent,
): RevisionContent {
  try {
    keys(input, contentKeys);
    if (
      typeof input.deleted !== 'boolean' ||
      !Array.isArray(input.allocations) ||
      !Array.isArray(input.tag_ids)
    )
      throw new RevisionError('INVALID_REVISION');
    const allocations = input.allocations
      .map((row) => {
        keys(row, [
          'id',
          'category_id',
          'subcategory_id',
          'amount_minor',
          'note',
        ]);
        return Object.freeze({
          id: id(row.id),
          category_id: id(row.category_id),
          subcategory_id: nullableId(row.subcategory_id),
          amount_minor: moneyMinor(row.amount_minor),
          note: nullableText(row.note),
        });
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const tags = input.tag_ids.map(id).sort();
    if (
      new Set(allocations.map((row) => row.id)).size !== allocations.length ||
      new Set(tags).size !== tags.length
    )
      throw new RevisionError('INVALID_REVISION');
    const amount = moneyMinor(input.account_amount_minor);
    if (allocations.length)
      validateAllocationAmounts(
        amount,
        allocations.map((row) => row.amount_minor),
      );
    if (
      ![
        'INCOME',
        'EXPENSE',
        'EXPENSE_REVERSAL',
        'TRANSFER',
        'DEBT_SETTLEMENT',
        'ADJUSTMENT',
        'OTHER',
      ].includes(input.economic_kind) ||
      !['MANUAL', 'IMPORT', 'DOCUMENT', 'SYSTEM'].includes(input.origin_kind)
    )
      throw new RevisionError('INVALID_REVISION');
    return Object.freeze({
      account_id: id(input.account_id),
      group_id: nullableId(input.group_id),
      counterparty_id: nullableId(input.counterparty_id),
      financial_date: financialDate(input.financial_date),
      account_amount_minor: amount,
      economic_kind: input.economic_kind,
      original_description: nullableText(input.original_description),
      display_name: text(input.display_name),
      origin_kind: input.origin_kind,
      deleted: input.deleted,
      allocations: Object.freeze(allocations),
      tag_ids: Object.freeze(tags),
    });
  } catch (error) {
    throw error instanceof RevisionError
      ? error
      : new RevisionError('INVALID_REVISION');
  }
}
export function captureRevisionState(input: RevisionState): RevisionState {
  try {
    keys(input, [
      'workspace_id',
      'id',
      'version',
      'created_at',
      'updated_at',
      'deleted_at',
      'content',
    ]);
    const created = utcInstant(input.created_at),
      updated = utcInstant(input.updated_at),
      deleted = input.deleted_at === null ? null : utcInstant(input.deleted_at),
      content = captureRevisionContent(input.content);
    if (
      updated < created ||
      (deleted !== null && deleted < created) ||
      content.deleted !== (deleted !== null)
    )
      throw new RevisionError('INVALID_REVISION');
    return Object.freeze({
      workspace_id: id(input.workspace_id),
      id: id(input.id),
      version: revisionVersion(input.version),
      created_at: created,
      updated_at: updated,
      deleted_at: deleted,
      content,
    });
  } catch (error) {
    throw error instanceof RevisionError
      ? error
      : new RevisionError('INVALID_REVISION');
  }
}
export function captureRevisionChange(input: RevisionChange): RevisionChange {
  keys(input, ['id', 'base_revision', 'content']);
  return Object.freeze({
    id: id(input.id),
    base_revision: revisionVersion(input.base_revision, true),
    content: captureRevisionContent(input.content),
  });
}
export function planTransactionRevision(
  workspace: string,
  current: RevisionState | null,
  input: RevisionChange,
  now: UtcInstant,
): RevisionPlan {
  id(workspace);
  utcInstant(now);
  const change = captureRevisionChange(input),
    before = current === null ? null : captureRevisionState(current);
  if (before && (before.workspace_id !== workspace || before.id !== change.id))
    throw new RevisionError('INVALID_REVISION');
  if (change.base_revision !== (before?.version ?? '0'))
    throw new RevisionError('VERSION_CONFLICT');
  if (
    before &&
    (before.content.original_description !==
      change.content.original_description ||
      before.content.origin_kind !== change.content.origin_kind)
  )
    throw new RevisionError('ORIGIN_IMMUTABLE');
  if (
    before?.content.group_id &&
    before.content.group_id !== change.content.group_id
  )
    throw new RevisionError('COMPOSITE_REQUIRED');
  if (
    before &&
    JSON.stringify(before.content) === JSON.stringify(change.content)
  )
    return Object.freeze({
      changed: false,
      before,
      after: before,
      snapshot: null,
    });
  const at = before && before.updated_at > now ? before.updated_at : now;
  const after = captureRevisionState({
    workspace_id: workspace,
    id: change.id,
    version: nextRevision(change.base_revision),
    created_at: before?.created_at ?? at,
    updated_at: at,
    deleted_at: change.content.deleted ? (before?.deleted_at ?? at) : null,
    content: change.content,
  });
  return Object.freeze({
    changed: true,
    before,
    after,
    snapshot: Object.freeze({
      format_version: 1,
      base_revision: change.base_revision,
      before,
      after,
    }),
  });
}
export function decodeRevisionState(value: unknown): RevisionState {
  try {
    return captureRevisionState(value as RevisionState);
  } catch {
    throw new RevisionError('INVALID_SNAPSHOT');
  }
}
export function decodeRevisionSnapshot(input: unknown): RevisionSnapshot {
  const value = input as RevisionSnapshot;
  try {
    keys(value, ['format_version', 'base_revision', 'before', 'after']);
    if (value.format_version !== 1) throw new RevisionError('INVALID_SNAPSHOT');
    const base = revisionVersion(value.base_revision, true),
      before =
        value.before === null ? null : captureRevisionState(value.before),
      after = captureRevisionState(value.after);
    if (
      after.version !== nextRevision(base) ||
      (before === null) !== (base === '0') ||
      (before &&
        (before.version !== base ||
          before.id !== after.id ||
          before.workspace_id !== after.workspace_id ||
          before.created_at !== after.created_at))
    )
      throw new RevisionError('INVALID_SNAPSHOT');
    return Object.freeze({
      format_version: 1,
      base_revision: base,
      before,
      after,
    });
  } catch {
    throw new RevisionError('INVALID_SNAPSHOT');
  }
}
export function planRevisionReversal(
  current: RevisionState,
  snapshot: RevisionSnapshot,
  base: string,
  now: UtcInstant,
): RevisionPlan {
  const before = captureRevisionState(current),
    past = decodeRevisionSnapshot(snapshot);
  if (
    revisionVersion(base) !== before.version ||
    past.after.version !== before.version ||
    JSON.stringify(past.after) !== JSON.stringify(before)
  )
    throw new RevisionError('REVERSAL_CONFLICT');
  const content =
    past.before?.content ??
    Object.freeze({ ...past.after.content, deleted: true });
  return planTransactionRevision(
    before.workspace_id,
    before,
    { id: before.id, base_revision: base, content },
    now,
  );
}
export function validateRevisionAccount(
  plan: RevisionPlan,
  account: Account,
): void {
  const content = plan.after.content;
  validateAccount(account, plan.after.workspace_id);
  if (
    account.workspace_id !== plan.after.workspace_id ||
    account.id !== content.account_id ||
    account.currency_code !== 'BRL'
  )
    throw new RevisionError('INVALID_REVISION');
  const amount = BigInt(content.account_amount_minor),
    economic = account.balance_nature === 'ASSET' ? amount : -amount;
  if (
    (content.economic_kind === 'INCOME' && economic <= 0n) ||
    (content.economic_kind === 'EXPENSE' && economic >= 0n) ||
    (content.economic_kind === 'EXPENSE_REVERSAL' && economic <= 0n)
  )
    throw new RevisionError('INVALID_REVISION');
  if (
    ['TRANSFER', 'DEBT_SETTLEMENT'].includes(content.economic_kind) &&
    !content.group_id
  )
    throw new RevisionError('COMPOSITE_REQUIRED');
}
