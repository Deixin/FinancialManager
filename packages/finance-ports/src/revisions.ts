import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  DomainError,
  utcInstant,
  validateCompositePlan,
} from '@financial-manager/domain';
import type { Account } from '@financial-manager/domain';
import {
  RevisionError,
  captureRevisionChange,
  decodeRevisionSnapshot,
  planTransactionRevision,
  planRevisionReversal,
  revisionVersion,
  validateRevisionAccount,
} from '@financial-manager/domain/revisions';
import type {
  RevisionChange,
  RevisionState,
  RevisionPlan,
  RevisionSnapshot,
} from '@financial-manager/domain/revisions';
import type { TaxonomyCatalog } from '@financial-manager/domain/taxonomy';
export type {
  RevisionChange,
  RevisionState,
  RevisionPlan,
  RevisionSnapshot,
} from '@financial-manager/domain/revisions';
export { RevisionError } from '@financial-manager/domain/revisions';
export type ChangeSource =
  'MANUAL' | 'IMPORT' | 'SYNC_RESOLUTION' | 'REVERSAL' | 'MIGRATION' | 'SYSTEM';
export interface RevisionRequest {
  readonly workspace_id: string;
  readonly principal_id?: string;
}
export interface RevisionActor {
  readonly actor_type: 'LOCAL_USER' | 'MEMBER' | 'SYSTEM' | 'SUPPORT';
  readonly actor_id: string | null;
  readonly device_id: string | null;
}
export interface RevisionGrant {
  readonly workspace_id: string;
  readonly authority: 'LOCAL' | 'CLOUD';
  readonly can_write: boolean;
  readonly account_ids: readonly string[] | null;
  readonly actor: RevisionActor;
}
export interface RevisionRecord extends RevisionActor {
  readonly id: string;
  readonly workspace_id: string;
  readonly transaction_id: string;
  readonly version: string;
  readonly snapshot: RevisionSnapshot;
  readonly change_source: ChangeSource;
  readonly created_at: string;
}
export interface RevisionGroup {
  readonly id: string;
  readonly group_type: 'TRANSFER' | 'CARD_PAYMENT' | 'OTHER_COMPOSITE';
  readonly state: 'ACTIVE' | 'BROKEN' | 'VOIDED';
  readonly members: readonly Readonly<{ id: string; account_id: string }>[];
}
export interface RevisionScope {
  readonly workspace_id: string;
  readonly account_ids: readonly string[] | null;
}
// Trusted adapter port. It is never exposed as an HTTP/IPC or user callback.
export interface RevisionTransaction {
  taxonomyCatalog?(): Promise<TaxonomyCatalog>;
  workspaceMode(): Promise<'LOCAL' | 'CLOUD' | null>;
  account(id: string): Promise<Account | null>;
  load(id: string): Promise<RevisionState | null>;
  group(id: string): Promise<RevisionGroup | null>;
  history(id: string, version: string): Promise<unknown | null>;
  save(plan: RevisionPlan, record: RevisionRecord): Promise<void>;
  createGroup?(
    input: Readonly<{
      id: string;
      group_type: 'TRANSFER' | 'CARD_PAYMENT';
      created_at: string;
    }>,
  ): Promise<void>;
}
export interface RevisionStore {
  transaction<T>(
    scope: RevisionScope,
    operation: (tx: RevisionTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface RevisionOptions {
  readonly store: RevisionStore;
  readonly authorize: (
    request: Readonly<RevisionRequest>,
  ) => Promise<RevisionGrant | null>;
  readonly identity: Readonly<{ newId(): string; nowInstant(): string }>;
  readonly change_source: ChangeSource;
}
export interface ReversalChange {
  readonly id: string;
  readonly base_revision: string;
  readonly revision_version: string;
}
export interface RevisionResult {
  readonly changed: boolean;
  readonly id: string;
  readonly base_revision: string;
  readonly version: string;
  readonly revision_id: string | null;
}
/** Trusted host policy, executed under the same authorization and transaction. */
export type RevisionGuard = (
  context: Readonly<{
    plan: RevisionPlan;
    account: Account;
    previous_account: Account | null;
    readTaxonomy?: () => Promise<TaxonomyCatalog>;
  }>,
) => void | Promise<void>;
function safeRequest(input: RevisionRequest): Readonly<RevisionRequest> {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !['workspace_id', 'principal_id'].includes(key),
    ) ||
    (input.principal_id !== undefined &&
      (typeof input.principal_id !== 'string' ||
        !input.principal_id.trim() ||
        input.principal_id !== input.principal_id.trim()))
  )
    throw new RevisionError('INVALID_REVISION');
  return Object.freeze({
    workspace_id: resourceId(input.workspace_id),
    ...(input.principal_id === undefined
      ? {}
      : { principal_id: input.principal_id }),
  });
}
function resourceState(state: RevisionState) {
  resourceId(state.workspace_id);
  resourceId(state.id);
  resourceContent(state.content);
}
function resourceContent(content: RevisionChange['content']) {
  resourceId(content.account_id);
  if (content.group_id !== null) resourceId(content.group_id);
  if (content.counterparty_id !== null) resourceId(content.counterparty_id);
  for (const allocation of content.allocations) {
    resourceId(allocation.id);
    resourceId(allocation.category_id);
    if (allocation.subcategory_id !== null)
      resourceId(allocation.subcategory_id);
  }
  for (const id of content.tag_ids) resourceId(id);
}
function requireAccount(scope: RevisionScope, id: string) {
  if (scope.account_ids !== null && !scope.account_ids.includes(id))
    throw new RevisionError('ACCESS_DENIED');
}
async function authorize(
  request: Readonly<RevisionRequest>,
  provider: RevisionOptions['authorize'],
): Promise<RevisionGrant> {
  let grant: RevisionGrant | null;
  try {
    grant = await provider(request);
  } catch {
    throw new RevisionError('ACCESS_DENIED');
  }
  if (!grant || grant.can_write !== true)
    throw new RevisionError('ACCESS_DENIED');
  try {
    if (
      resourceId(grant.workspace_id) !== request.workspace_id ||
      !['LOCAL', 'CLOUD'].includes(grant.authority) ||
      !(grant.account_ids === null || Array.isArray(grant.account_ids))
    )
      throw Error();
    const actor = grant.actor;
    if (
      !actor ||
      !['LOCAL_USER', 'MEMBER', 'SYSTEM', 'SUPPORT'].includes(
        actor.actor_type,
      ) ||
      (actor.actor_id !== null &&
        (typeof actor.actor_id !== 'string' ||
          !actor.actor_id.trim() ||
          actor.actor_id !== actor.actor_id.trim()))
    )
      throw Error();
    if (actor.device_id !== null) resourceId(actor.device_id);
    if (
      grant.authority === 'CLOUD' &&
      (!request.principal_id || actor.actor_type === 'LOCAL_USER')
    )
      throw Error();
    if (
      grant.authority === 'LOCAL' &&
      (!['LOCAL_USER', 'SYSTEM'].includes(actor.actor_type) ||
        request.principal_id !== undefined ||
        actor.actor_id !== null)
    )
      throw Error();
    if (['MEMBER', 'SUPPORT'].includes(actor.actor_type))
      resourceId(actor.actor_id);
    return Object.freeze({
      workspace_id: request.workspace_id,
      authority: grant.authority,
      can_write: true,
      account_ids:
        grant.account_ids === null
          ? null
          : Object.freeze(
              [...new Set(grant.account_ids.map(resourceId))].sort(),
            ),
      actor: Object.freeze({
        actor_type: actor.actor_type,
        actor_id: actor.actor_id,
        device_id: actor.device_id,
      }),
    });
  } catch {
    throw new RevisionError('INVALID_AUTHORIZATION');
  }
}
function error(error: unknown): RevisionError {
  return error instanceof RevisionError
    ? error
    : new RevisionError(
        error instanceof DomainError
          ? 'INVALID_REVISION'
          : 'DATA_ACCESS_FAILED',
      );
}
function captureInput<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new RevisionError('INVALID_REVISION');
  }
}
export function createRevisionService(options: RevisionOptions) {
  if (
    !options ||
    typeof options.authorize !== 'function' ||
    typeof options.store?.transaction !== 'function' ||
    typeof options.identity?.newId !== 'function' ||
    typeof options.identity.nowInstant !== 'function' ||
    ![
      'MANUAL',
      'IMPORT',
      'SYNC_RESOLUTION',
      'REVERSAL',
      'MIGRATION',
      'SYSTEM',
    ].includes(options.change_source)
  )
    throw new RevisionError('CONFIGURATION_INVALID');
  const store: RevisionStore = Object.freeze({
      transaction: options.store.transaction.bind(options.store),
    }),
    provider = options.authorize,
    newId = options.identity.newId.bind(options.identity),
    nowInstant = options.identity.nowInstant.bind(options.identity),
    source = options.change_source;
  function capture<T extends { readonly id: string }>(
    rows: readonly T[],
    copy: (row: T) => T,
  ): readonly T[] {
    if (
      !Array.isArray(rows) ||
      rows.length < 1 ||
      rows.length > MAX_REVISION_BATCH_SIZE
    )
      throw new RevisionError('INVALID_REVISION');
    const captured = rows
      .map(copy)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (new Set(captured.map((row) => row.id)).size !== captured.length)
      throw new RevisionError('INVALID_REVISION');
    return Object.freeze(captured);
  }
  async function execute(
    request: Readonly<RevisionRequest>,
    changes: readonly (RevisionChange | ReversalChange)[],
    reversing: boolean,
    guard?: RevisionGuard,
    creation?: Readonly<{
      id: string;
      group_type: 'TRANSFER' | 'CARD_PAYMENT';
    }>,
  ): Promise<readonly RevisionResult[]> {
    const grant = await authorize(request, provider),
      scope = Object.freeze({
        workspace_id: grant.workspace_id,
        account_ids: grant.account_ids,
      });
    return store.transaction(scope, async (tx) => {
      if ((await tx.workspaceMode()) !== grant.authority)
        throw new RevisionError('ACCESS_DENIED');
      const at = utcInstant(nowInstant()),
        plans: RevisionPlan[] = [],
        accounts = new Map<string, Account>();
      for (const input of changes) {
        const current = await tx.load(input.id);
        if (current) {
          resourceState(current);
          requireAccount(scope, current.content.account_id);
        }
        if (!current && input.base_revision !== '0')
          throw new RevisionError('NOT_FOUND');
        let plan: RevisionPlan;
        if (reversing) {
          const reversal = input as ReversalChange;
          if (!current) throw new RevisionError('NOT_FOUND');
          if (
            current.version !== reversal.base_revision ||
            reversal.revision_version !== current.version
          )
            throw new RevisionError('REVERSAL_CONFLICT');
          const raw = await tx.history(input.id, reversal.revision_version);
          if (raw === null) throw new RevisionError('INVALID_SNAPSHOT');
          plan = planRevisionReversal(
            current,
            decodeRevisionSnapshot(raw as RevisionSnapshot),
            reversal.base_revision,
            at,
          );
        } else
          plan = planTransactionRevision(
            scope.workspace_id,
            current,
            input as RevisionChange,
            at,
          );
        requireAccount(scope, plan.after.content.account_id);
        resourceState(plan.after);
        const account =
          accounts.get(plan.after.content.account_id) ??
          (await tx.account(plan.after.content.account_id));
        if (!account) throw new RevisionError('NOT_FOUND');
        accounts.set(account.id, account);
        if (guard) {
          const previous = current
            ? current.content.account_id === account.id
              ? account
              : await tx.account(current.content.account_id)
            : null;
          if (current && !previous) throw new RevisionError('NOT_FOUND');
          await guard(
            Object.freeze({
              plan,
              account,
              previous_account: previous,
              ...(tx.taxonomyCatalog
                ? { readTaxonomy: () => tx.taxonomyCatalog!() }
                : {}),
            }),
          );
        }
        validateRevisionAccount(plan, account);
        plans.push(plan);
      }
      if (creation) {
        if (!tx.createGroup) throw new RevisionError('CONFIGURATION_INVALID');
        if (
          plans.length !== 2 ||
          plans.some(
            (p) =>
              p.before !== null ||
              p.after.content.group_id !== creation.id ||
              p.after.content.deleted ||
              p.after.content.origin_kind !== 'MANUAL',
          )
        )
          throw new RevisionError('COMPOSITE_REQUIRED');
        if (await tx.group(creation.id))
          throw new RevisionError('VERSION_CONFLICT');
        await tx.createGroup(Object.freeze({ ...creation, created_at: at }));
      }
      const groupIds = [
        ...new Set(
          plans.flatMap((plan) =>
            plan.after.content.group_id ? [plan.after.content.group_id] : [],
          ),
        ),
      ].sort();
      for (const groupId of groupIds) {
        const group = await tx.group(groupId),
          members = plans.filter(
            (plan) => plan.after.content.group_id === groupId,
          ),
          previousMembers = members.flatMap((p) =>
            p.before?.content.group_id === groupId
              ? [{ id: p.before.id, account_id: p.before.content.account_id }]
              : [],
          );
        if (
          !group ||
          group.state !== 'ACTIVE' ||
          group.group_type === 'OTHER_COMPOSITE' ||
          members.length !== 2 ||
          group.members.length !== previousMembers.length ||
          group.members.some(
            (member) =>
              !previousMembers.some(
                (p) => p.id === member.id && p.account_id === member.account_id,
              ),
          )
        )
          throw new RevisionError('COMPOSITE_REQUIRED');
        for (const member of group.members)
          requireAccount(scope, member.account_id);
        if (
          members[0]!.after.content.deleted !==
          members[1]!.after.content.deleted
        )
          throw new RevisionError('COMPOSITE_REQUIRED');
        members.sort((a, b) => {
          const left =
            group.group_type === 'TRANSFER'
              ? BigInt(a.after.content.account_amount_minor) < 0n
              : accounts.get(a.after.content.account_id)!.balance_nature ===
                'ASSET';
          const right =
            group.group_type === 'TRANSFER'
              ? BigInt(b.after.content.account_amount_minor) < 0n
              : accounts.get(b.after.content.account_id)!.balance_nature ===
                'ASSET';
          return left === right ? 0 : left ? -1 : 1;
        });
        const entry = (plan: RevisionPlan) => ({
          id: plan.after.id,
          workspace_id: scope.workspace_id,
          account_id: plan.after.content.account_id,
          group_id: groupId,
          financial_date: plan.after.content.financial_date,
          account_amount_minor: plan.after.content.account_amount_minor,
          economic_kind: plan.after.content.economic_kind,
        });
        try {
          validateCompositePlan(
            {
              id: groupId,
              workspace_id: scope.workspace_id,
              group_type: group.group_type,
              entries: [entry(members[0]!), entry(members[1]!)],
            },
            members.map((plan) => accounts.get(plan.after.content.account_id)!),
          );
        } catch {
          throw new RevisionError('COMPOSITE_REQUIRED');
        }
      }
      const results: RevisionResult[] = [];
      for (const plan of plans) {
        const revisionId = plan.changed ? uuidV7(newId()) : null;
        if (plan.changed)
          await tx.save(
            plan,
            Object.freeze({
              id: revisionId!,
              workspace_id: scope.workspace_id,
              transaction_id: plan.after.id,
              version: plan.after.version,
              snapshot: plan.snapshot!,
              ...grant.actor,
              change_source: reversing ? 'REVERSAL' : source,
              created_at: at,
            }),
          );
        results.push(
          Object.freeze({
            changed: plan.changed,
            id: plan.after.id,
            base_revision: plan.before?.version ?? '0',
            version: plan.after.version,
            revision_id: revisionId,
          }),
        );
      }
      return Object.freeze(results);
    });
  }
  async function applyChanges(
    input: RevisionRequest,
    rows: readonly RevisionChange[],
    guard?: RevisionGuard,
    creation?: Readonly<{
      id: string;
      group_type: 'TRANSFER' | 'CARD_PAYMENT';
    }>,
  ) {
    try {
      const { request, changes } = captureInput(() => ({
        request: safeRequest(input),
        changes: capture(rows, (row) => {
          const value = captureRevisionChange(row);
          resourceId(value.id);
          resourceContent(value.content);
          return value;
        }),
      }));
      return await execute(request, changes, false, guard, creation);
    } catch (cause) {
      throw error(cause);
    }
  }
  return Object.freeze({
    apply: (input: RevisionRequest, rows: readonly RevisionChange[]) =>
      applyChanges(input, rows),
    async applyComposite(
      input: RevisionRequest,
      rows: readonly RevisionChange[],
      group: Readonly<{ id: string; group_type: 'TRANSFER' | 'CARD_PAYMENT' }>,
      guard: RevisionGuard,
    ) {
      if (typeof guard !== 'function')
        throw new RevisionError('CONFIGURATION_INVALID');
      let captured: Readonly<{
        id: string;
        group_type: 'TRANSFER' | 'CARD_PAYMENT';
      }>;
      try {
        if (
          !group ||
          Object.keys(group).sort().join(',') !== 'group_type,id' ||
          !['TRANSFER', 'CARD_PAYMENT'].includes(group.group_type)
        )
          throw new Error();
        captured = Object.freeze({
          id: uuidV7(group.id),
          group_type: group.group_type,
        });
      } catch {
        throw new RevisionError('INVALID_REVISION');
      }
      return applyChanges(input, rows, guard, captured);
    },
    async applyGuarded(
      input: RevisionRequest,
      rows: readonly RevisionChange[],
      guard: RevisionGuard,
    ) {
      if (typeof guard !== 'function')
        throw new RevisionError('CONFIGURATION_INVALID');
      return applyChanges(input, rows, guard);
    },
    async revert(input: RevisionRequest, rows: readonly ReversalChange[]) {
      try {
        const { request, changes } = captureInput(() => ({
          request: safeRequest(input),
          changes: capture(rows, (row) => {
            if (
              Object.keys(row).sort().join(',') !==
              'base_revision,id,revision_version'
            )
              throw new RevisionError('INVALID_REVISION');
            return Object.freeze({
              id: resourceId(row.id),
              base_revision: revisionVersion(row.base_revision),
              revision_version: revisionVersion(row.revision_version),
            });
          }),
        }));
        return await execute(request, changes, true);
      } catch (cause) {
        throw error(cause);
      }
    },
  });
}
export type RevisionService = ReturnType<typeof createRevisionService>;
// Bounded by the project's synthetic 10k import corpus; larger batches fail
// before authorization/storage and are never split into partial commits.
export const MAX_REVISION_BATCH_SIZE = 10000;
