import { planTransfer } from './composites.js';
import { moneyMinor } from './money.js';
import { validateAccount, requireId } from './model.js';
import type { Account } from './model.js';
import { captureRevisionState, captureRevisionChange } from './revisions.js';
import type {
  RevisionState,
  RevisionChange,
  RevisionPlan,
} from './revisions.js';
export type TransferCode =
  | 'INVALID_TRANSFER'
  | 'TRANSFER_READ_ONLY'
  | 'TRANSFER_BASE_CONFLICT'
  | 'TRANSFER_ACCOUNT_CHANGED'
  | 'TRANSFER_ACCOUNT_ARCHIVED'
  | 'TRANSFER_DELETED'
  | 'ALLOCATION_REVIEW_REQUIRED';
export class TransferError extends Error {
  readonly code: TransferCode;
  constructor(code: TransferCode) {
    super(code);
    this.name = 'TransferError';
    this.code = code;
  }
}
export interface TransferBase {
  readonly group_id: string;
  readonly source: RevisionState;
  readonly target: RevisionState;
}
interface Fields {
  readonly source_account: Account;
  readonly target_account: Account;
  readonly financial_date: string;
  readonly amount_minor: string;
  readonly display_name: string;
}
export type TransferCommand =
  | Readonly<
      Fields & {
        kind: 'CREATE';
        id: string;
        source_entry_id: string;
        target_entry_id: string;
        original_description: string | null;
      }
    >
  | Readonly<Fields & { kind: 'EDIT'; base: TransferBase }>
  | Readonly<{ kind: 'DELETE' | 'RESTORE'; base: TransferBase }>;
function fail(code: TransferCode = 'INVALID_TRANSFER'): never {
  throw new TransferError(code);
}
function exact(
  v: unknown,
  fields: readonly string[],
): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    JSON.stringify(Object.keys(v).sort()) !== JSON.stringify([...fields].sort())
  )
    fail();
}
function label(v: unknown) {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > 2000 ||
    /\p{Cc}/u.test(v)
  )
    fail();
  return v.trim();
}
export function transferAccount(a: Account): Account {
  return Object.freeze({
    id: a.id,
    workspace_id: a.workspace_id,
    currency_code: a.currency_code,
    account_kind: a.account_kind,
    balance_nature: a.balance_nature,
    status: a.status,
  });
}
function account(a: Account, w: string) {
  exact(a, [
    'id',
    'workspace_id',
    'currency_code',
    'account_kind',
    'balance_nature',
    'status',
  ]);
  validateAccount(a, w);
  if (a.balance_nature !== 'ASSET') fail();
  return transferAccount(a);
}
function base(v: TransferBase, w: string): TransferBase {
  exact(v, ['group_id', 'source', 'target']);
  requireId(v.group_id);
  const source = captureRevisionState(v.source),
    target = captureRevisionState(v.target);
  if (
    source.workspace_id !== w ||
    target.workspace_id !== w ||
    source.id === target.id ||
    source.content.group_id !== v.group_id ||
    target.content.group_id !== v.group_id ||
    source.content.financial_date !== target.content.financial_date ||
    source.content.account_id === target.content.account_id ||
    source.content.deleted !== target.content.deleted ||
    BigInt(source.content.account_amount_minor) >= 0n ||
    BigInt(source.content.account_amount_minor) +
      BigInt(target.content.account_amount_minor) !==
      0n
  )
    fail();
  if (
    [source, target].some(
      (s) =>
        s.content.origin_kind !== 'MANUAL' ||
        s.content.economic_kind !== 'TRANSFER',
    )
  )
    fail('TRANSFER_READ_ONLY');
  return Object.freeze({ group_id: v.group_id, source, target });
}
export function captureTransfer(
  input: TransferCommand,
  w: string,
): TransferCommand {
  try {
    requireId(w);
    if (!input || typeof input !== 'object') fail();
    if (input.kind === 'DELETE' || input.kind === 'RESTORE') {
      exact(input, ['kind', 'base']);
      return Object.freeze({ kind: input.kind, base: base(input.base, w) });
    }
    if (input.kind !== 'CREATE' && input.kind !== 'EDIT') fail();
    const fields = [
      'kind',
      'source_account',
      'target_account',
      'financial_date',
      'amount_minor',
      'display_name',
    ];
    exact(
      input,
      input.kind === 'CREATE'
        ? [
            ...fields,
            'id',
            'source_entry_id',
            'target_entry_id',
            'original_description',
          ]
        : [...fields, 'base'],
    );
    const source = account(input.source_account, w),
      target = account(input.target_account, w),
      previous = input.kind === 'EDIT' ? base(input.base, w) : null;
    if (previous?.source.content.deleted) fail('TRANSFER_DELETED');
    const name =
      previous &&
      input.display_name === previous.source.content.display_name &&
      input.display_name === previous.target.content.display_name
        ? input.display_name
        : label(input.display_name);
    const ids =
      input.kind === 'CREATE'
        ? [input.id, input.source_entry_id, input.target_entry_id]
        : [previous!.group_id, previous!.source.id, previous!.target.id];
    ids.forEach(requireId);
    if (new Set(ids).size !== 3) fail();
    planTransfer({
      id: ids[0]!,
      workspace_id: w,
      source_account: source,
      target_account: target,
      source_entry_id: ids[1]!,
      target_entry_id: ids[2]!,
      financial_date: input.financial_date,
      amount_minor: moneyMinor(input.amount_minor),
    });
    if (input.kind === 'CREATE') {
      if (
        input.original_description !== null &&
        (typeof input.original_description !== 'string' ||
          input.original_description.length > 2000 ||
          /\p{Cc}/u.test(input.original_description))
      )
        fail();
      return Object.freeze({
        ...input,
        source_account: source,
        target_account: target,
        display_name: name,
      });
    }
    return Object.freeze({
      ...input,
      base: previous!,
      source_account: source,
      target_account: target,
      display_name: name,
    });
  } catch (e) {
    throw e instanceof TransferError
      ? e
      : new TransferError('INVALID_TRANSFER');
  }
}
export function transferChanges(c: TransferCommand): readonly RevisionChange[] {
  const bases =
      c.kind === 'CREATE' ? [null, null] : [c.base.source, c.base.target],
    source = c.kind === 'CREATE' ? c.source_entry_id : c.base.source.id,
    target = c.kind === 'CREATE' ? c.target_entry_id : c.base.target.id,
    group = c.kind === 'CREATE' ? c.id : c.base.group_id;
  return Object.freeze(
    bases.map((before, i) => {
      const toggle = c.kind === 'DELETE' || c.kind === 'RESTORE';
      const amount = toggle
        ? before!.content.account_amount_minor
        : (i === 0 ? '-' : '') + (c as Fields).amount_minor;
      let allocations = before?.content.allocations ?? [];
      if (!toggle && before && amount !== before.content.account_amount_minor) {
        if (allocations.length > 1) fail('ALLOCATION_REVIEW_REQUIRED');
        if (allocations.length === 1)
          allocations = [
            {
              ...allocations[0]!,
              amount_minor: moneyMinor((c as Fields).amount_minor),
            },
          ];
      }
      return captureRevisionChange({
        id: i === 0 ? source : target,
        base_revision: before?.version ?? '0',
        content: toggle
          ? { ...before!.content, deleted: c.kind === 'DELETE' }
          : {
              account_id:
                i === 0
                  ? (c as Fields).source_account.id
                  : (c as Fields).target_account.id,
              group_id: group,
              counterparty_id: before?.content.counterparty_id ?? null,
              financial_date: (c as Fields).financial_date,
              account_amount_minor: moneyMinor(amount),
              economic_kind: 'TRANSFER',
              original_description: before
                ? before.content.original_description
                : c.kind === 'CREATE'
                  ? c.original_description
                  : null,
              display_name: (c as Fields).display_name,
              origin_kind: 'MANUAL',
              deleted: false,
              allocations,
              tag_ids: before?.content.tag_ids ?? [],
            },
      });
    }),
  );
}
export function validateTransferPlan(
  c: TransferCommand,
  {
    plan,
    account: current,
    previous_account: previous,
  }: { plan: RevisionPlan; account: Account; previous_account: Account | null },
  w: string,
): void {
  const before =
    c.kind === 'CREATE'
      ? null
      : ([c.base.source, c.base.target].find((s) => s.id === plan.after.id) ??
        null);
  if (JSON.stringify(before) !== JSON.stringify(plan.before))
    fail('TRANSFER_BASE_CONFLICT');
  const expected = transferChanges(c).find((s) => s.id === plan.after.id);
  if (
    !expected ||
    JSON.stringify(expected.content) !== JSON.stringify(plan.after.content)
  )
    fail();
  for (const a of [current, previous].filter((a): a is Account => a !== null)) {
    validateAccount(a, w);
    if (a.status !== 'ACTIVE') fail('TRANSFER_ACCOUNT_ARCHIVED');
    if (a.balance_nature !== 'ASSET') fail('TRANSFER_ACCOUNT_CHANGED');
  }
  if (c.kind === 'CREATE' || c.kind === 'EDIT') {
    const descriptor =
      plan.after.id ===
      (c.kind === 'CREATE' ? c.source_entry_id : c.base.source.id)
        ? c.source_account
        : c.target_account;
    if (JSON.stringify(transferAccount(current)) !== JSON.stringify(descriptor))
      fail('TRANSFER_ACCOUNT_CHANGED');
  }
}
