import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  AccountChangeError,
  DomainError,
  captureAccountChange,
  planAccountChange,
  decodeAccountState,
  calculateAccountBalance,
  selectBalanceReference,
  financialDate,
} from '@financial-manager/domain';
import type {
  AccountChange,
  AccountPlan,
  AccountState,
  HistoryCoverage,
} from '@financial-manager/domain';
import type {
  WorkspaceReadUnit,
  ReadRequest,
  ReferenceRecord,
  TransactionCursor,
  ReferenceCursor,
} from './index.js';
export interface AccountWriteRequest {
  readonly workspace_id: string;
  readonly principal_id?: string;
}
export interface AccountWriteGrant {
  readonly workspace_id: string;
  readonly authority: 'LOCAL' | 'CLOUD';
  readonly can_write: boolean;
  readonly can_create: boolean;
  readonly account_ids: readonly string[] | null;
}
export interface AccountWriteScope {
  readonly workspace_id: string;
  readonly account_ids: readonly string[] | null;
}
export interface AccountWriteTransaction {
  workspaceMode(): Promise<'LOCAL' | 'CLOUD' | null>;
  load(id: string): Promise<AccountState | null>;
  save(plan: AccountPlan): Promise<void>;
}
export interface AccountWriteOptions {
  readonly authorize: (
    request: Readonly<AccountWriteRequest>,
  ) => Promise<AccountWriteGrant | null>;
  readonly identity: Readonly<{ nowInstant(): string }>;
  readonly store: {
    transaction<T>(
      scope: AccountWriteScope,
      operation: (tx: AccountWriteTransaction) => Promise<T>,
    ): Promise<T>;
  };
}
export function createAccountWriteService(options: AccountWriteOptions) {
  if (
    !options ||
    typeof options.authorize !== 'function' ||
    typeof options.identity?.nowInstant !== 'function' ||
    typeof options.store?.transaction !== 'function'
  )
    throw new AccountChangeError('CONFIGURATION_INVALID');
  return Object.freeze({
    async apply(request: AccountWriteRequest, change: AccountChange) {
      try {
        if (
          !request ||
          Object.keys(request).some(
            (k) => !['workspace_id', 'principal_id'].includes(k),
          ) ||
          (request.principal_id !== undefined &&
            (typeof request.principal_id !== 'string' ||
              !request.principal_id.trim() ||
              request.principal_id.trim() !== request.principal_id))
        )
          throw new AccountChangeError('INVALID_ACCOUNT_CHANGE');
        const capturedRequest = Object.freeze({
            ...request,
            workspace_id: resourceId(request.workspace_id),
          }),
          input = captureAccountChange(change, capturedRequest.workspace_id);
        const id = resourceId(
          input.kind === 'CREATE'
            ? input.account.id
            : input.kind === 'UPDATE'
              ? input.base.id
              : input.account_id,
        );
        if (input.kind === 'CREATE') uuidV7(id);
        if (input.kind === 'CREATE' || input.kind === 'REFERENCE') {
          if (input.reference) uuidV7(input.reference.id);
        }
        if (input.kind === 'REFERENCE' && input.replaces_id !== null)
          resourceId(input.replaces_id);
        let raw: AccountWriteGrant | null;
        try {
          raw = await options.authorize(capturedRequest);
        } catch {
          throw new AccountChangeError('ACCESS_DENIED');
        }
        if (
          !raw ||
          raw.can_write !== true ||
          raw.workspace_id !== capturedRequest.workspace_id ||
          !['LOCAL', 'CLOUD'].includes(raw.authority) ||
          typeof raw.can_create !== 'boolean' ||
          !(raw.account_ids === null || Array.isArray(raw.account_ids)) ||
          (raw.authority === 'LOCAL'
            ? capturedRequest.principal_id !== undefined
            : !capturedRequest.principal_id)
        )
          throw new AccountChangeError('ACCESS_DENIED');
        const grant = Object.freeze({
          ...raw,
          account_ids:
            raw.account_ids === null
              ? null
              : Object.freeze(raw.account_ids.map(resourceId)),
        });
        if (
          (input.kind === 'CREATE' &&
            (!grant.can_create || grant.account_ids !== null)) ||
          (grant.account_ids !== null && !grant.account_ids.includes(id))
        )
          throw new AccountChangeError('ACCESS_DENIED');
        return await options.store.transaction(
          Object.freeze({
            workspace_id: grant.workspace_id,
            account_ids: grant.account_ids,
          }),
          async (tx) => {
            if ((await tx.workspaceMode()) !== grant.authority)
              throw new AccountChangeError('ACCESS_DENIED');
            const rawState = await tx.load(id),
              state =
                rawState === null
                  ? null
                  : decodeAccountState(rawState, grant.workspace_id);
            if (state) {
              resourceId(state.account.id);
              for (const r of state.references) resourceId(r.id);
            }
            const plan = planAccountChange(
              grant.workspace_id,
              state,
              input,
              options.identity.nowInstant(),
            );
            if (plan.changed) await tx.save(plan);
            return Object.freeze({
              changed: plan.changed,
              account_id: id,
              reference_id: plan.reference_id,
            });
          },
        );
      } catch (error) {
        if (error instanceof AccountChangeError) throw error;
        if (error instanceof DomainError)
          throw new AccountChangeError('INVALID_ACCOUNT_CHANGE');
        throw new AccountChangeError('DATA_ACCESS_FAILED');
      }
    },
  });
}
// Application orchestration: accounts never query the transactions module's table.
export async function readCalculatedAccountBalance(
  unit: WorkspaceReadUnit,
  request: ReadRequest,
  input: Readonly<{
    account_id: string;
    as_of: string;
    history_coverage: HistoryCoverage;
  }>,
) {
  if (unit.snapshot_consistency !== true)
    throw new AccountChangeError('CONFIGURATION_INVALID');
  const captured = Object.freeze({
    ...input,
    account_id: resourceId(input.account_id),
    as_of: financialDate(input.as_of),
  });
  return unit.read(request, async (ports) => {
    const account = await ports.accounts.get(captured.account_id);
    if (!account) throw new AccountChangeError('ACCOUNT_NOT_FOUND');
    const references: ReferenceRecord[] = [],
      movements = [];
    let refCursor: ReferenceCursor | null = null,
      txCursor: TransactionCursor | null = null;
    const seenRefs = new Set<string>(),
      seenTx = new Set<string>();
    do {
      const page = await ports.accounts.references({
        account_id: account.id,
        limit: 100,
        cursor: refCursor,
      });
      references.push(...page.items);
      refCursor = page.next_cursor;
      if (refCursor) {
        const key = JSON.stringify(refCursor);
        if (seenRefs.has(key))
          throw new AccountChangeError('DATA_ACCESS_FAILED');
        seenRefs.add(key);
      }
    } while (refCursor);
    const state = decodeAccountState(
        { account, references },
        account.workspace_id,
      ),
      reference = selectBalanceReference(state.references, captured.as_of);
    do {
      const page = await ports.transactions.page({
        account_id: account.id,
        from: reference?.reference_date ?? '0001-01-01',
        through: captured.as_of,
        limit: 100,
        cursor: txCursor,
      });
      movements.push(
        ...page.items.map((row) => ({
          id: row.id,
          workspace_id: row.workspace_id,
          account_id: row.account_id,
          group_id: row.group_id,
          financial_date: row.financial_date,
          account_amount_minor: row.account_amount_minor,
          economic_kind: row.economic_kind,
          posting_state: 'CONFIRMED' as const,
        })),
      );
      txCursor = page.next_cursor;
      if (txCursor) {
        const key = JSON.stringify(txCursor);
        if (seenTx.has(key)) throw new AccountChangeError('DATA_ACCESS_FAILED');
        seenTx.add(key);
      }
    } while (txCursor);
    const balance = calculateAccountBalance({
      workspace_id: account.workspace_id,
      account,
      reference,
      movements,
      as_of: captured.as_of,
      history_coverage: captured.history_coverage,
    });
    return Object.freeze({
      account,
      reference,
      balance,
      considered_count: String(
        movements.filter(
          (m) =>
            !reference ||
            m.financial_date > reference.reference_date ||
            reference.day_position === 'START_OF_DAY',
        ).length,
      ),
    });
  });
}
