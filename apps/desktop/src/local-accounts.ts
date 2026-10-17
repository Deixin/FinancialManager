import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureAccountChange,
  decodeAccountState,
  validateMovement,
  calculateAccountBalance,
  selectBalanceReference,
  moneyMinor,
  moneyInteger,
  financialDate,
  utcInstant,
} from '@financial-manager/domain';
import type {
  AccountChange,
  AccountState,
  Movement,
  MoneyMinor,
} from '@financial-manager/domain';
export interface AccountsSnapshot {
  readonly workspace_id: string;
  readonly read_at: string;
  readonly accounts: readonly AccountState[];
  readonly movements: readonly Movement[];
}
export interface AccountResult {
  readonly changed: boolean;
  readonly account_id: string;
  readonly reference_id: string | null;
}
const codes = [
  'INVALID_ACCOUNT_CHANGE',
  'STALE_ACCOUNT',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_ARCHIVED',
  'REFERENCE_CONFLICT',
  'ACCOUNT_LIMIT',
  'LOCAL_LOCKED',
  'KEY_MISSING',
  'INSTALLATION_BUSY',
  'REQUEST_CONFLICT',
  'STORAGE_UNAVAILABLE',
  'INTEGRITY_FAILURE',
  'UNSUPPORTED_SCHEMA',
  'INVALID_RESPONSE',
] as const;
export class LocalAccountsError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('LOCAL_ACCOUNTS_OPERATION_FAILED');
    this.code = codes.includes(code as (typeof codes)[number])
      ? code
      : 'STORAGE_UNAVAILABLE';
  }
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
    throw new LocalAccountsError('INVALID_RESPONSE');
}
export function decodeAccountsSnapshot(
  value: unknown,
  workspace: string,
): AccountsSnapshot {
  try {
    resourceId(workspace);
    exact(value, ['workspace_id', 'read_at', 'accounts', 'movements']);
    if (
      value.workspace_id !== workspace ||
      !Array.isArray(value.accounts) ||
      !Array.isArray(value.movements) ||
      value.accounts.length + value.movements.length > 200000
    )
      throw Error();
    utcInstant(value.read_at);
    const accounts = value.accounts.map((row) =>
        decodeAccountState(row, workspace),
      ),
      ids = new Map<string, AccountState['account']>();
    for (const row of accounts) {
      resourceId(row.account.id);
      if (ids.has(row.account.id)) throw Error();
      ids.set(row.account.id, row.account);
      for (const r of row.references) resourceId(r.id);
    }
    if (
      accounts.reduce(
        (n, a) => n + a.references.length,
        accounts.length + value.movements.length,
      ) > 200000
    )
      throw Error();
    const seen = new Set<string>(),
      movements = value.movements.map((raw) => {
        exact(raw, [
          'id',
          'workspace_id',
          'account_id',
          'group_id',
          'financial_date',
          'account_amount_minor',
          'economic_kind',
          'posting_state',
        ]);
        const movementId = resourceId(raw.id),
          accountId = resourceId(raw.account_id);
        if (raw.group_id !== null) resourceId(raw.group_id);
        const a = ids.get(accountId);
        if (!a || seen.has(movementId) || raw.posting_state !== 'CONFIRMED')
          throw Error();
        seen.add(movementId);
        const m = Object.freeze({ ...raw }) as unknown as Movement;
        validateMovement(m, a, workspace);
        return m;
      });
    return Object.freeze({
      workspace_id: workspace,
      read_at: value.read_at as string,
      accounts: Object.freeze(accounts),
      movements: Object.freeze(movements),
    });
  } catch {
    throw new LocalAccountsError('INVALID_RESPONSE');
  }
}
export function captureLocalAccountChange(
  value: AccountChange,
  workspace: string,
): AccountChange {
  const input = captureAccountChange(value, resourceId(workspace));
  resourceId(
    input.kind === 'CREATE'
      ? input.account.id
      : input.kind === 'UPDATE'
        ? input.base.id
        : input.account_id,
  );
  if (input.kind === 'CREATE') uuidV7(input.account.id);
  if (
    (input.kind === 'CREATE' || input.kind === 'REFERENCE') &&
    input.reference
  )
    uuidV7(input.reference.id);
  if (input.kind === 'REFERENCE' && input.replaces_id !== null)
    resourceId(input.replaces_id);
  return input;
}
export function decodeAccountResult(
  value: unknown,
  input: AccountChange,
): AccountResult {
  exact(value, ['changed', 'account_id', 'reference_id']);
  const id =
      input.kind === 'CREATE'
        ? input.account.id
        : input.kind === 'UPDATE'
          ? input.base.id
          : input.account_id,
    ref = input.kind === 'UPDATE' ? null : (input.reference?.id ?? null);
  if (
    typeof value.changed !== 'boolean' ||
    value.account_id !== id ||
    value.reference_id !== ref
  )
    throw new LocalAccountsError('INVALID_RESPONSE');
  return Object.freeze(value) as unknown as AccountResult;
}
export function createLocalAccountsGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (e) {
      throw new LocalAccountsError(
        typeof e === 'string' ? e : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async read(workspace: string) {
      return decodeAccountsSnapshot(
        await call('read_local_accounts', {
          workspaceId: resourceId(workspace),
        }),
        workspace,
      );
    },
    async apply(workspace: string, change: AccountChange) {
      const input = captureLocalAccountChange(change, workspace);
      return decodeAccountResult(
        await call('apply_local_account_change', {
          workspaceId: workspace,
          input,
        }),
        input,
      );
    },
  });
}
export function accountBalance(
  snapshot: AccountsSnapshot,
  state: AccountState,
  asOf: string,
) {
  return balanceFromMovements(
    snapshot.workspace_id,
    state,
    asOf,
    snapshot.movements.filter((m) => m.account_id === state.account.id),
  );
}
function balanceFromMovements(
  workspace: string,
  state: AccountState,
  asOf: string,
  movements: readonly Movement[],
) {
  const reference = selectBalanceReference(
    state.references,
    financialDate(asOf),
  );
  const balance = calculateAccountBalance({
    workspace_id: workspace,
    account: state.account,
    reference,
    movements,
    as_of: asOf,
    history_coverage: 'UNKNOWN',
  });
  const considered = movements.filter(
    (m) =>
      m.financial_date <= asOf &&
      (!reference ||
        m.financial_date > reference.reference_date ||
        reference.day_position === 'START_OF_DAY'),
  ).length;
  return Object.freeze({ balance, reference, considered: String(considered) });
}
export function accountRows(snapshot: AccountsSnapshot, asOf: string) {
  const byAccount = new Map<string, Movement[]>();
  for (const m of snapshot.movements) {
    const group = byAccount.get(m.account_id) ?? [];
    group.push(m);
    byAccount.set(m.account_id, group);
  }
  return snapshot.accounts.map((state) => {
    try {
      return Object.freeze({
        state,
        value: balanceFromMovements(
          snapshot.workspace_id,
          state,
          asOf,
          byAccount.get(state.account.id) ?? [],
        ),
      });
    } catch {
      return Object.freeze({ state, value: null });
    }
  });
}
export function parseBrlMinor(value: string): MoneyMinor {
  if (value.trim().length > 24)
    throw new LocalAccountsError('INVALID_ACCOUNT_CHANGE');
  const match = /^(-?)(\d+)(?:,(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new LocalAccountsError('INVALID_ACCOUNT_CHANGE');
  const amount =
    BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return moneyMinor(((match[1] ? -1n : 1n) * amount).toString());
}
export function formatBrlMinor(value: MoneyMinor): string {
  const amount = moneyInteger(value),
    negative = amount < 0n,
    digits = (negative ? -amount : amount).toString().padStart(3, '0');
  return (
    'R$ ' +
    (negative ? '-' : '') +
    digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') +
    ',' +
    digits.slice(-2)
  );
}
export function localAccountsMessage(error: unknown): string {
  const code = error instanceof LocalAccountsError ? error.code : '';
  if (code === 'STALE_ACCOUNT' || code === 'REFERENCE_CONFLICT')
    return 'A conta ou a referência mudou. Recarregue e revise antes de tentar outra alteração.';
  if (code === 'ACCOUNT_ARCHIVED')
    return 'Reative a conta antes de alterar a referência de saldo.';
  if (code === 'ACCOUNT_LIMIT')
    return 'Este espaço excede o tamanho suportado por esta visualização. Nenhum dado foi removido ou truncado.';
  if (code === 'KEY_MISSING')
    return 'A chave não está disponível neste perfil Windows. Os dados existentes foram preservados.';
  return 'Não foi possível acessar as contas. Confira os dados e recarregue; uma alteração já registrada será preservada.';
}
export const accountKinds = Object.freeze({
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  DIGITAL: 'Conta digital',
  CASH: 'Carteira / dinheiro',
  CREDIT_CARD: 'Cartão',
  INVESTMENT_SIMPLE: 'Investimento simples',
  LOAN_SIMPLE: 'Dívida simples',
  OTHER: 'Outra',
});
export function todayFinancial() {
  const d = new Date();
  return (
    String(d.getFullYear()).padStart(4, '0') +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
