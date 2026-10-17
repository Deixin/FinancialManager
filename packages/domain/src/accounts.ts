import { validateAccount, financialDate, requireId } from './model.js';
import type { Account, BalanceReference } from './model.js';
import { moneyMinor, subtractMoney } from './money.js';
import type { MoneyMinor } from './money.js';
import { utcInstant } from './time.js';

export type AccountChangeCode =
  | 'INVALID_ACCOUNT_CHANGE'
  | 'STALE_ACCOUNT'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'REFERENCE_CONFLICT'
  | 'ACCESS_DENIED'
  | 'DATA_ACCESS_FAILED'
  | 'CONFIGURATION_INVALID'
  | 'CLOSED'
  | 'NESTED_UNIT';
export class AccountChangeError extends Error {
  readonly code: AccountChangeCode;
  constructor(code: AccountChangeCode) {
    const safe: AccountChangeCode = [
      'INVALID_ACCOUNT_CHANGE',
      'STALE_ACCOUNT',
      'ACCOUNT_NOT_FOUND',
      'ACCOUNT_ARCHIVED',
      'REFERENCE_CONFLICT',
      'ACCESS_DENIED',
      'DATA_ACCESS_FAILED',
      'CONFIGURATION_INVALID',
      'CLOSED',
      'NESTED_UNIT',
    ].includes(code)
      ? code
      : 'DATA_ACCESS_FAILED';
    super(safe);
    this.code = safe;
    this.name = 'AccountChangeError';
  }
}
export interface ManagedAccount extends Account {
  readonly name: string;
  readonly institution_name: string | null;
  readonly created_at: string;
}
export interface ManagedReference extends BalanceReference {
  readonly id: string;
  readonly source: 'MANUAL' | 'STATEMENT' | 'IMPORT';
  readonly created_at: string;
}
export interface AccountState {
  readonly account: ManagedAccount;
  readonly references: readonly ManagedReference[];
}
export interface ManualReferenceInput {
  readonly id: string;
  readonly amount_minor: MoneyMinor;
  readonly reference_date: string;
  readonly day_position: 'START_OF_DAY' | 'END_OF_DAY';
}
export type AccountChange =
  | Readonly<{
      kind: 'CREATE';
      account: Omit<ManagedAccount, 'workspace_id' | 'status' | 'created_at'>;
      reference: ManualReferenceInput | null;
    }>
  | Readonly<{
      kind: 'UPDATE';
      base: ManagedAccount;
      name: string;
      institution_name: string | null;
      status: 'ACTIVE' | 'ARCHIVED';
    }>
  | Readonly<{
      kind: 'REFERENCE';
      account_id: string;
      reference: ManualReferenceInput;
      replaces_id: string | null;
    }>;
export interface AccountPlan {
  readonly kind: AccountChange['kind'];
  readonly changed: boolean;
  readonly state: AccountState;
  readonly reference_id: string | null;
  readonly replaces_id: string | null;
}
function invalid(): never {
  throw new AccountChangeError('INVALID_ACCOUNT_CHANGE');
}
function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  )
    invalid();
}
function label(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 120 ||
    /\p{Cc}/u.test(value)
  )
    invalid();
  return value.trim();
}
function institution(value: unknown): string | null {
  return value === null ? null : label(value);
}
function account(value: unknown, workspace: string): ManagedAccount {
  exact(value, [
    'id',
    'workspace_id',
    'name',
    'institution_name',
    'account_kind',
    'balance_nature',
    'currency_code',
    'status',
    'created_at',
  ]);
  const row = value as unknown as ManagedAccount;
  validateAccount(row, workspace);
  utcInstant(row.created_at);
  if (
    typeof row.name !== 'string' ||
    !row.name.length ||
    (row.institution_name !== null && typeof row.institution_name !== 'string')
  )
    invalid();
  return Object.freeze({ ...row });
}
function referenceInput(value: unknown): ManualReferenceInput {
  exact(value, ['id', 'amount_minor', 'reference_date', 'day_position']);
  requireId(value.id);
  if (!['START_OF_DAY', 'END_OF_DAY'].includes(value.day_position as string))
    invalid();
  return Object.freeze({
    id: value.id,
    amount_minor: moneyMinor(value.amount_minor),
    reference_date: financialDate(value.reference_date),
    day_position: value.day_position as ManualReferenceInput['day_position'],
  });
}
export function captureAccountChange(
  value: unknown,
  workspace: string,
): AccountChange {
  requireId(workspace);
  const input = value as AccountChange;
  if (input?.kind === 'CREATE') {
    exact(input, ['kind', 'account', 'reference']);
    exact(input.account, [
      'id',
      'name',
      'institution_name',
      'account_kind',
      'balance_nature',
      'currency_code',
    ]);
    const row = account(
      {
        ...input.account,
        name: label(input.account.name),
        institution_name: institution(input.account.institution_name),
        workspace_id: workspace,
        status: 'ACTIVE',
        created_at: '2000-01-01T00:00:00.000Z',
      },
      workspace,
    );
    if (
      row.account_kind === 'CREDIT_CARD' || row.account_kind === 'LOAN_SIMPLE'
        ? row.balance_nature !== 'LIABILITY'
        : row.account_kind !== 'OTHER' && row.balance_nature !== 'ASSET'
    )
      invalid();
    if (input.reference && input.reference.id === row.id) invalid();
    return Object.freeze({
      kind: 'CREATE',
      account: Object.freeze({
        ...input.account,
        name: row.name,
        institution_name: row.institution_name,
      }),
      reference:
        input.reference === null ? null : referenceInput(input.reference),
    });
  }
  if (input?.kind === 'UPDATE') {
    exact(input, ['kind', 'base', 'name', 'institution_name', 'status']);
    const base = account(input.base, workspace);
    if (!['ACTIVE', 'ARCHIVED'].includes(input.status)) invalid();
    return Object.freeze({
      kind: 'UPDATE',
      base,
      name: input.name === base.name ? base.name : label(input.name),
      institution_name:
        input.institution_name === base.institution_name
          ? base.institution_name
          : institution(input.institution_name),
      status: input.status,
    });
  }
  if (input?.kind === 'REFERENCE') {
    exact(input, ['kind', 'account_id', 'reference', 'replaces_id']);
    requireId(input.account_id);
    if (input.replaces_id !== null) requireId(input.replaces_id);
    if (
      input.replaces_id === input.reference.id ||
      input.account_id === input.reference.id
    )
      invalid();
    return Object.freeze({
      kind: 'REFERENCE',
      account_id: input.account_id,
      reference: referenceInput(input.reference),
      replaces_id: input.replaces_id,
    });
  }
  return invalid();
}
export function decodeAccountState(
  value: unknown,
  workspace: string,
): AccountState {
  exact(value, ['account', 'references']);
  const a = account(value.account, workspace);
  if (!Array.isArray(value.references)) invalid();
  const ids = new Set<string>(),
    points = new Set<string>();
  const refs = value.references.map((raw: unknown) => {
    exact(raw, [
      'id',
      'workspace_id',
      'account_id',
      'amount_minor',
      'reference_date',
      'day_position',
      'status',
      'source',
      'created_at',
    ]);
    const r = raw as unknown as ManagedReference;
    referenceInput({
      id: r.id,
      amount_minor: r.amount_minor,
      reference_date: r.reference_date,
      day_position: r.day_position,
    });
    if (
      r.workspace_id !== workspace ||
      r.account_id !== a.id ||
      !['MANUAL', 'STATEMENT', 'IMPORT'].includes(r.source) ||
      !['ACTIVE', 'SUPERSEDED'].includes(r.status) ||
      ids.has(r.id)
    )
      invalid();
    utcInstant(r.created_at);
    ids.add(r.id);
    const point = r.reference_date + r.day_position;
    if (r.status === 'ACTIVE') {
      if (points.has(point)) invalid();
      points.add(point);
    }
    return Object.freeze({ ...r });
  });
  return Object.freeze({
    account: a,
    references: Object.freeze(refs.sort((a, b) => a.id.localeCompare(b.id))),
  });
}
const sameAccount = (a: ManagedAccount, b: ManagedAccount) =>
  [
    'id',
    'workspace_id',
    'name',
    'institution_name',
    'account_kind',
    'balance_nature',
    'currency_code',
    'status',
    'created_at',
  ].every((k) => a[k as keyof ManagedAccount] === b[k as keyof ManagedAccount]);
const sameReference = (a: ManagedReference, b: ManualReferenceInput) =>
  a.id === b.id &&
  a.amount_minor === b.amount_minor &&
  a.reference_date === b.reference_date &&
  a.day_position === b.day_position &&
  a.source === 'MANUAL';
export function planAccountChange(
  workspace: string,
  current: AccountState | null,
  change: AccountChange,
  now: string,
): AccountPlan {
  const input = captureAccountChange(change, workspace),
    state = current === null ? null : decodeAccountState(current, workspace);
  utcInstant(now);
  const id =
    input.kind === 'CREATE'
      ? input.account.id
      : input.kind === 'UPDATE'
        ? input.base.id
        : input.account_id;
  if (state && state.account.id !== id) invalid();
  const plan = (
    result: AccountState,
    changed: boolean,
    reference_id: string | null = null,
    replaces_id: string | null = null,
  ): AccountPlan =>
    Object.freeze({
      kind: input.kind,
      state: decodeAccountState(result, workspace),
      changed,
      reference_id,
      replaces_id,
    });
  if (input.kind === 'CREATE') {
    if (state) {
      const expected = {
        ...input.account,
        workspace_id: workspace,
        status: 'ACTIVE' as const,
        created_at: state.account.created_at,
      };
      if (
        !sameAccount(state.account, expected) ||
        (input.reference === null
          ? state.references.length !== 0
          : state.references.length !== 1 ||
            !sameReference(state.references[0]!, input.reference))
      )
        throw new AccountChangeError('STALE_ACCOUNT');
      return plan(state, false, input.reference?.id ?? null);
    }
    return plan(
      {
        account: {
          ...input.account,
          workspace_id: workspace,
          status: 'ACTIVE',
          created_at: now,
        },
        references:
          input.reference === null
            ? []
            : [
                {
                  ...input.reference,
                  workspace_id: workspace,
                  account_id: id,
                  status: 'ACTIVE',
                  source: 'MANUAL',
                  created_at: now,
                },
              ],
      },
      true,
      input.reference?.id ?? null,
    );
  }
  if (!state) throw new AccountChangeError('ACCOUNT_NOT_FOUND');
  if (input.kind === 'UPDATE') {
    const desired = {
      ...input.base,
      name: input.name,
      institution_name: input.institution_name,
      status: input.status,
    };
    if (sameAccount(state.account, desired)) return plan(state, false);
    if (!sameAccount(state.account, input.base))
      throw new AccountChangeError('STALE_ACCOUNT');
    return plan({ ...state, account: desired }, true);
  }
  const previous =
    input.replaces_id === null
      ? null
      : state.references.find((r) => r.id === input.replaces_id);
  const existing = state.references.find((r) => r.id === input.reference.id);
  if (existing) {
    if (
      !sameReference(existing, input.reference) ||
      (input.replaces_id !== null &&
        (!previous || previous.status !== 'SUPERSEDED'))
    )
      throw new AccountChangeError('REFERENCE_CONFLICT');
    return plan(state, false, existing.id, input.replaces_id);
  }
  if (state.account.status !== 'ACTIVE')
    throw new AccountChangeError('ACCOUNT_ARCHIVED');
  if (input.replaces_id !== null && (!previous || previous.status !== 'ACTIVE'))
    throw new AccountChangeError('STALE_ACCOUNT');
  if (
    state.references.some(
      (r) =>
        r.status === 'ACTIVE' &&
        r.id !== input.replaces_id &&
        r.reference_date === input.reference.reference_date &&
        r.day_position === input.reference.day_position,
    )
  )
    throw new AccountChangeError('REFERENCE_CONFLICT');
  return plan(
    {
      ...state,
      references: [
        ...state.references.map((r) =>
          r.id === input.replaces_id
            ? { ...r, status: 'SUPERSEDED' as const }
            : r,
        ),
        {
          ...input.reference,
          workspace_id: workspace,
          account_id: id,
          status: 'ACTIVE',
          source: 'MANUAL',
          created_at: now,
        },
      ],
    },
    true,
    input.reference.id,
    input.replaces_id,
  );
}
export function selectBalanceReference(
  references: readonly ManagedReference[],
  as_of: string,
): ManagedReference | null {
  financialDate(as_of);
  return (
    [...references]
      .filter((r) => r.status === 'ACTIVE' && r.reference_date <= as_of)
      .sort(
        (a, b) =>
          b.reference_date.localeCompare(a.reference_date) ||
          (a.day_position === b.day_position
            ? 0
            : a.day_position === 'END_OF_DAY'
              ? -1
              : 1),
      )[0] ?? null
  );
}
export function compareAccountBalance(
  calculated: MoneyMinor,
  observed: MoneyMinor,
) {
  const difference = subtractMoney(
    moneyMinor(observed),
    moneyMinor(calculated),
  );
  return Object.freeze({
    calculated_minor: calculated,
    observed_minor: observed,
    difference_minor: difference,
    matches: difference === '0',
  });
}
