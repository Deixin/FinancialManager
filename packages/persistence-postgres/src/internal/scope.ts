import { DataAccessError } from '@financial-manager/finance-ports';
import type {
  AuthorizeRead,
  ReadGrant,
  ReadPermission,
  ReadRequest,
} from '@financial-manager/finance-ports';
import { resourceId } from '@financial-manager/contracts';
import type { ResourceId } from '@financial-manager/contracts';
import { financialDate } from '@financial-manager/domain';
export interface ReadContext {
  readonly workspace_id: ResourceId;
  readonly permissions: readonly ReadPermission[];
  readonly account_ids: readonly ResourceId[] | null;
}
export function captureRequest(input: ReadRequest): Readonly<ReadRequest> {
  try {
    if (
      !input ||
      Object.keys(input).sort().join(',') !== 'principal_id,workspace_id' ||
      typeof input.principal_id !== 'string' ||
      !input.principal_id.trim() ||
      input.principal_id !== input.principal_id.trim()
    )
      throw new Error();
    return Object.freeze({
      workspace_id: resourceId(input.workspace_id),
      principal_id: input.principal_id,
    });
  } catch {
    throw new DataAccessError('INVALID_INPUT');
  }
}
export async function authorizeContext(
  request: Readonly<ReadRequest>,
  authorize: AuthorizeRead,
): Promise<ReadContext> {
  let grant: ReadGrant | null;
  try {
    grant = await authorize(request);
  } catch {
    throw new DataAccessError('ACCESS_DENIED');
  }
  if (!grant) throw new DataAccessError('ACCESS_DENIED');
  try {
    if (
      resourceId(grant.workspace_id) !== request.workspace_id ||
      !Array.isArray(grant.permissions) ||
      !grant.permissions.length ||
      grant.permissions.some(
        (value) => value !== 'accounts:read' && value !== 'transactions:read',
      ) ||
      !(grant.account_ids === null || Array.isArray(grant.account_ids))
    )
      throw new Error();
    const accounts =
      grant.account_ids === null
        ? null
        : Object.freeze(
            [...new Set(grant.account_ids.map((id) => resourceId(id)))].sort(),
          );
    return Object.freeze({
      workspace_id: resourceId(grant.workspace_id),
      permissions: Object.freeze([...new Set(grant.permissions)]),
      account_ids: accounts,
    });
  } catch {
    throw new DataAccessError('INVALID_AUTHORIZATION');
  }
}
export function inputId(value: unknown): ResourceId {
  try {
    return resourceId(value);
  } catch {
    throw new DataAccessError('INVALID_INPUT');
  }
}
export function inputDate(value: unknown): string {
  try {
    return financialDate(value);
  } catch {
    throw new DataAccessError('INVALID_INPUT');
  }
}
export function inputLimit(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 100
  )
    throw new DataAccessError('INVALID_INPUT');
  return value;
}
export function requireAccount(context: ReadContext, id: ResourceId): void {
  if (context.account_ids !== null && !context.account_ids.includes(id))
    throw new DataAccessError('ACCESS_DENIED');
}
export class ReadGuard {
  active = true;
  failed = false;
  readonly pending = new Set<Promise<unknown>>();
  constructor(readonly context: ReadContext) {}
  query<T>(
    permission: ReadPermission,
    operation: () => Promise<T>,
  ): Promise<T> {
    const work = (async () => {
      if (!this.active) throw new DataAccessError('SCOPE_CLOSED');
      if (!this.context.permissions.includes(permission))
        throw new DataAccessError('ACCESS_DENIED');
      const value = await operation();
      if (!this.active) throw new DataAccessError('SCOPE_CLOSED');
      return value;
    })().catch((error: unknown) => {
      this.failed = true;
      throw error instanceof DataAccessError
        ? error
        : new DataAccessError('DATA_ACCESS_FAILED');
    });
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => {});
    return work;
  }
  async finish(): Promise<void> {
    const outstanding = this.pending.size;
    this.active = false;
    await Promise.allSettled([...this.pending]);
    if (outstanding) throw new DataAccessError('PENDING_WORK');
    if (this.failed) throw new DataAccessError('UNIT_OF_WORK_FAILED');
  }
}
