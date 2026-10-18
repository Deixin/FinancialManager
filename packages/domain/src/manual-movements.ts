import { validateAccount, financialDate, requireId } from './model.js';
import type { Account } from './model.js';
import { moneyMinor, fromMoneyInteger } from './money.js';
import { captureRevisionState, captureRevisionChange } from './revisions.js';
import type {
  RevisionChange,
  RevisionState,
  RevisionPlan,
} from './revisions.js';
export type ManualMovementCode =
  | 'INVALID_MANUAL_MOVEMENT'
  | 'MANUAL_MOVEMENT_READ_ONLY'
  | 'MANUAL_BASE_CONFLICT'
  | 'MANUAL_ACCOUNT_CHANGED'
  | 'MANUAL_ACCOUNT_ARCHIVED'
  | 'MOVEMENT_DELETED'
  | 'ALLOCATION_REVIEW_REQUIRED';
export class ManualMovementError extends Error {
  readonly code: ManualMovementCode;
  constructor(code: ManualMovementCode) {
    super(code);
    this.name = 'ManualMovementError';
    this.code = code;
  }
}
interface Fields {
  readonly account: Account;
  readonly financial_date: string;
  readonly display_name: string;
  readonly amount_minor: string;
  readonly movement_kind: 'INCOME' | 'EXPENSE';
}
export type ManualMovementCommand =
  | Readonly<
      {
        kind: 'CREATE';
        id: string;
        original_description: string | null;
      } & Fields
    >
  | Readonly<{ kind: 'EDIT'; base: RevisionState } & Fields>
  | Readonly<{ kind: 'DELETE'; base: RevisionState }>
  | Readonly<{ kind: 'RESTORE'; base: RevisionState }>
  | Readonly<{
      kind: 'ADJUST';
      id: string;
      account: Account;
      financial_date: string;
      delta_minor: string;
      reason: string;
    }>;
function fail(code: ManualMovementCode = 'INVALID_MANUAL_MOVEMENT'): never {
  throw new ManualMovementError(code);
}
function keys(
  value: unknown,
  names: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...names].sort())
  )
    fail();
}
function name(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 2000 ||
    /\p{Cc}/u.test(value)
  )
    fail();
  return value.trim();
}
function accountSnapshot(value: Account): Account {
  return Object.freeze({
    id: value.id,
    workspace_id: value.workspace_id,
    currency_code: value.currency_code,
    account_kind: value.account_kind,
    balance_nature: value.balance_nature,
    status: value.status,
  });
}
function account(value: Account, workspace: string): Account {
  keys(value, [
    'id',
    'workspace_id',
    'currency_code',
    'account_kind',
    'balance_nature',
    'status',
  ]);
  validateAccount(value, workspace);
  return accountSnapshot(value);
}
function base(value: RevisionState, workspace: string) {
  const state = captureRevisionState(value);
  if (state.workspace_id !== workspace) fail();
  if (
    state.content.origin_kind !== 'MANUAL' ||
    state.content.group_id !== null ||
    !['INCOME', 'EXPENSE', 'ADJUSTMENT'].includes(state.content.economic_kind)
  )
    fail('MANUAL_MOVEMENT_READ_ONLY');
  return state;
}
export function captureManualMovement(
  input: ManualMovementCommand,
  workspace: string,
): ManualMovementCommand {
  try {
    requireId(workspace);
    if (!input || typeof input !== 'object') fail();
    if (input.kind === 'DELETE' || input.kind === 'RESTORE') {
      keys(input, ['kind', 'base']);
      return Object.freeze({
        kind: input.kind,
        base: base(input.base, workspace),
      });
    }
    if (input.kind === 'ADJUST') {
      keys(input, [
        'kind',
        'id',
        'account',
        'financial_date',
        'delta_minor',
        'reason',
      ]);
      requireId(input.id);
      const delta = moneyMinor(input.delta_minor);
      if (delta === '0') fail();
      return Object.freeze({
        kind: 'ADJUST',
        id: input.id,
        account: account(input.account, workspace),
        financial_date: financialDate(input.financial_date),
        delta_minor: delta,
        reason: name(input.reason),
      });
    }
    if (input.kind !== 'CREATE' && input.kind !== 'EDIT') fail();
    keys(
      input,
      input.kind === 'CREATE'
        ? [
            'kind',
            'id',
            'account',
            'financial_date',
            'display_name',
            'amount_minor',
            'movement_kind',
            'original_description',
          ]
        : [
            'kind',
            'base',
            'account',
            'financial_date',
            'display_name',
            'amount_minor',
            'movement_kind',
          ],
    );
    const previous = input.kind === 'EDIT' ? base(input.base, workspace) : null;
    const fields = {
      account: account(input.account, workspace),
      financial_date: financialDate(input.financial_date),
      display_name:
        previous && input.display_name === previous.content.display_name
          ? previous.content.display_name
          : name(input.display_name),
      amount_minor: moneyMinor(input.amount_minor),
      movement_kind: input.movement_kind,
    };
    if (
      BigInt(fields.amount_minor) <= 0n ||
      !['INCOME', 'EXPENSE'].includes(fields.movement_kind)
    )
      fail();
    if (input.kind === 'CREATE') {
      requireId(input.id);
      if (
        input.original_description !== null &&
        (typeof input.original_description !== 'string' ||
          input.original_description.length > 2000 ||
          /\p{Cc}/u.test(input.original_description))
      )
        fail();
      return Object.freeze({
        kind: 'CREATE',
        id: input.id,
        original_description: input.original_description,
        ...fields,
      });
    }
    if (!previous) fail();
    if (previous.content.deleted) fail('MOVEMENT_DELETED');
    if (previous.content.economic_kind === 'ADJUSTMENT')
      fail('MANUAL_MOVEMENT_READ_ONLY');
    return Object.freeze({ kind: 'EDIT', base: previous, ...fields });
  } catch (error) {
    if (error instanceof ManualMovementError) throw error;
    return fail();
  }
}
export function manualMovementChange(
  command: ManualMovementCommand,
): RevisionChange {
  if (command.kind === 'DELETE' || command.kind === 'RESTORE')
    return captureRevisionChange({
      id: command.base.id,
      base_revision: command.base.version,
      content: { ...command.base.content, deleted: command.kind === 'DELETE' },
    });
  const existing = command.kind === 'EDIT' ? command.base : null;
  const amount =
    command.kind === 'ADJUST'
      ? command.delta_minor
      : fromMoneyInteger(
          BigInt(command.amount_minor) *
            (command.movement_kind === 'INCOME' ? 1n : -1n) *
            (command.account.balance_nature === 'ASSET' ? 1n : -1n),
        );
  let allocations = existing?.content.allocations ?? [];
  if (
    allocations.length &&
    command.kind === 'EDIT' &&
    existing!.content.economic_kind !== command.movement_kind
  )
    fail('ALLOCATION_REVIEW_REQUIRED');
  const absolute = BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount);
  if (
    allocations.length &&
    absolute !==
      (BigInt(existing!.content.account_amount_minor) < 0n
        ? -BigInt(existing!.content.account_amount_minor)
        : BigInt(existing!.content.account_amount_minor))
  ) {
    if (allocations.length !== 1) fail('ALLOCATION_REVIEW_REQUIRED');
    allocations = Object.freeze([
      { ...allocations[0]!, amount_minor: fromMoneyInteger(absolute) },
    ]);
  }
  return captureRevisionChange({
    id: existing?.id ?? (command as { id: string }).id,
    base_revision: existing?.version ?? '0',
    content: {
      account_id: command.account.id,
      group_id: null,
      counterparty_id: existing?.content.counterparty_id ?? null,
      financial_date: command.financial_date,
      account_amount_minor: moneyMinor(amount),
      economic_kind:
        command.kind === 'ADJUST' ? 'ADJUSTMENT' : command.movement_kind,
      original_description: existing
        ? existing.content.original_description
        : command.kind === 'ADJUST'
          ? command.reason
          : (command as Extract<ManualMovementCommand, { kind: 'CREATE' }>)
              .original_description,
      display_name:
        command.kind === 'ADJUST'
          ? 'Ajuste de saldo: ' + command.reason
          : command.display_name,
      origin_kind: 'MANUAL',
      deleted: false,
      allocations,
      tag_ids: existing?.content.tag_ids ?? [],
    },
  });
}
export function validateManualMovementPlan(
  command: ManualMovementCommand,
  context: Readonly<{
    plan: RevisionPlan;
    account: Account;
    previous_account: Account | null;
  }>,
  workspace: string,
): void {
  const { plan, account: target, previous_account: previous } = context;
  const expected = 'base' in command ? command.base : null;
  if (JSON.stringify(plan.before) !== JSON.stringify(expected))
    fail('MANUAL_BASE_CONFLICT');
  for (const entry of [target, previous])
    if (entry) {
      validateAccount(entry, workspace);
      if (entry.status !== 'ACTIVE') fail('MANUAL_ACCOUNT_ARCHIVED');
    }
  if (
    'account' in command &&
    JSON.stringify(account(command.account, workspace)) !==
      JSON.stringify(accountSnapshot(target))
  )
    fail('MANUAL_ACCOUNT_CHANGED');
}
