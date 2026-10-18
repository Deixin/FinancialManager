import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  CategoryError,
  captureCategories,
  captureCategoryCommand,
  planCategories,
} from '@financial-manager/domain/categories';
import type {
  Category,
  CategoryCommand,
  CategoryPlan,
  CategoryPurpose,
} from '@financial-manager/domain/categories';
export interface CategoryRequest {
  readonly workspace_id: string;
  readonly principal_id?: string;
}
export interface CategoryGrant {
  readonly workspace_id: string;
  readonly authority: 'LOCAL' | 'CLOUD';
  readonly can_read: boolean;
  readonly can_manage: boolean;
}
export interface CategoryWriteScope {
  readonly workspace_id: string;
}
export interface CategoryTransaction {
  workspace(): Promise<Readonly<{
    storage_mode: 'LOCAL' | 'CLOUD';
    purpose: CategoryPurpose;
  }> | null>;
  list(): Promise<readonly Category[]>;
  save(plan: CategoryPlan): Promise<void>;
}
export interface CategoryOptions {
  readonly authorize: (
    request: Readonly<CategoryRequest>,
  ) => Promise<CategoryGrant | null>;
  readonly store: {
    transaction<T>(
      scope: CategoryWriteScope,
      run: (tx: CategoryTransaction) => Promise<T>,
    ): Promise<T>;
  };
}
export function createCategoryService(options: CategoryOptions) {
  if (
    typeof options?.authorize !== 'function' ||
    typeof options.store?.transaction !== 'function'
  )
    throw new CategoryError('CONFIGURATION_INVALID');
  const request = (input: CategoryRequest) => {
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).some(
        (k) => !['workspace_id', 'principal_id'].includes(k),
      ) ||
      (input.principal_id !== undefined &&
        (typeof input.principal_id !== 'string' ||
          !input.principal_id.trim() ||
          input.principal_id !== input.principal_id.trim()))
    )
      throw new CategoryError('INVALID_CATEGORY_CHANGE');
    return Object.freeze({
      ...input,
      workspace_id: resourceId(input.workspace_id),
    });
  };
  async function execute(
    input: CategoryRequest,
    command?: CategoryCommand,
    writing = false,
  ) {
    try {
      let req: Readonly<CategoryRequest>, c: CategoryCommand | undefined;
      try {
        req = request(input);
        c = writing
          ? captureCategoryCommand(command, req.workspace_id)
          : undefined;
        if (c?.kind === 'SEED') c.ids.forEach(uuidV7);
        if (c?.kind === 'CREATE') uuidV7(c.id);
        if (c?.kind === 'UPDATE') resourceId(c.base.id);
        if (c?.kind === 'REORDER') c.ids.forEach(resourceId);
      } catch (e) {
        throw e instanceof CategoryError
          ? e
          : new CategoryError('INVALID_CATEGORY_CHANGE');
      }
      let grant: CategoryGrant | null;
      try {
        grant = await options.authorize(req);
      } catch {
        throw new CategoryError('ACCESS_DENIED');
      }
      if (
        !grant ||
        grant.workspace_id !== req.workspace_id ||
        grant.can_read !== true ||
        typeof grant.can_manage !== 'boolean' ||
        !['LOCAL', 'CLOUD'].includes(grant.authority) ||
        (grant.authority === 'LOCAL'
          ? req.principal_id !== undefined
          : !req.principal_id) ||
        (c && grant.can_manage !== true)
      )
        throw new CategoryError('ACCESS_DENIED');
      const authority = grant.authority;
      return await options.store.transaction(
        Object.freeze({ workspace_id: req.workspace_id }),
        async (tx) => {
          const workspace = await tx.workspace();
          if (!workspace || workspace.storage_mode !== authority)
            throw new CategoryError('ACCESS_DENIED');
          const current = captureCategories(await tx.list(), req.workspace_id);
          current.forEach((r) => resourceId(r.id));
          const plans = c
            ? planCategories(req.workspace_id, workspace.purpose, current, c)
            : [];
          for (const plan of plans) await tx.save(plan);
          const categories = captureCategories(
            current
              .filter((r) => !plans.some((p) => p.after.id === r.id))
              .concat(plans.map((p) => p.after)),
            req.workspace_id,
          );
          return Object.freeze({
            changed: plans.length > 0,
            category_ids: Object.freeze(plans.map((p) => p.after.id)),
            categories,
          });
        },
      );
    } catch (e) {
      if (e instanceof CategoryError) throw e;
      throw new CategoryError('DATA_ACCESS_FAILED');
    }
  }
  return Object.freeze({
    list: (r: CategoryRequest) => execute(r),
    apply: (r: CategoryRequest, c: CategoryCommand) => execute(r, c, true),
  });
}
