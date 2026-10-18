import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  TaxonomyError,
  captureTaxonomyCatalog,
  captureTaxonomyCommand,
  captureTaxonomyQuery,
  filterTaxonomy,
  planTaxonomy,
} from '@financial-manager/domain/taxonomy';
import type {
  TaxonomyCatalog,
  TaxonomyCommand,
  TaxonomyPlan,
  TaxonomyQuery,
} from '@financial-manager/domain/taxonomy';
import type {
  CategoryOptions,
  CategoryRequest,
  CategoryWriteScope,
} from './categories.js';
export interface TaxonomyTransaction {
  workspace(): Promise<Readonly<{ storage_mode: 'LOCAL' | 'CLOUD' }> | null>;
  catalog(): Promise<TaxonomyCatalog>;
  save(plan: TaxonomyPlan): Promise<void>;
}
export interface TaxonomyOptions {
  readonly authorize: CategoryOptions['authorize'];
  readonly store: {
    transaction<T>(
      scope: CategoryWriteScope,
      run: (tx: TaxonomyTransaction) => Promise<T>,
    ): Promise<T>;
  };
}
const all: TaxonomyQuery = Object.freeze({
  kind: 'ALL',
  status: 'ALL',
  category_id: null,
  search: '',
});
export function createTaxonomyService(options: TaxonomyOptions) {
  if (
    typeof options?.authorize !== 'function' ||
    typeof options.store?.transaction !== 'function'
  )
    throw new TaxonomyError('CONFIGURATION_INVALID');
  async function execute(
    input: CategoryRequest,
    command: TaxonomyCommand | null,
    query: TaxonomyQuery,
  ) {
    try {
      let req: Readonly<CategoryRequest>,
        c: TaxonomyCommand | null,
        q: TaxonomyQuery;
      try {
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
          throw Error();
        req = Object.freeze({
          workspace_id: resourceId(input.workspace_id),
          ...(input.principal_id === undefined
            ? {}
            : { principal_id: input.principal_id }),
        });
        c =
          command === null
            ? null
            : captureTaxonomyCommand(command, req.workspace_id);
        q = captureTaxonomyQuery(query);
        if (q.category_id !== null) resourceId(q.category_id);
        if (c) {
          if (c.kind === 'REORDER_SUBCATEGORIES') {
            resourceId(c.category_id);
            c.ids.forEach(resourceId);
          } else {
            (c.kind === 'CREATE' ? uuidV7 : resourceId)(c.item.id);
            if (c.item.kind === 'SUBCATEGORY') resourceId(c.item.category_id);
          }
        }
      } catch {
        throw new TaxonomyError('INVALID_TAXONOMY_CHANGE');
      }
      let grant;
      try {
        grant = await options.authorize(req);
      } catch {
        throw new TaxonomyError('ACCESS_DENIED');
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
        (c && !grant.can_manage)
      )
        throw new TaxonomyError('ACCESS_DENIED');
      const authority = grant.authority;
      return await options.store.transaction(
        Object.freeze({ workspace_id: req.workspace_id }),
        async (tx) => {
          const workspace = await tx.workspace();
          if (!workspace || workspace.storage_mode !== authority)
            throw new TaxonomyError('ACCESS_DENIED');
          const current = captureTaxonomyCatalog(
            await tx.catalog(),
            req.workspace_id,
          );
          current.categories.forEach((r) => resourceId(r.id));
          current.items.forEach((r) => {
            resourceId(r.id);
            if (r.kind === 'SUBCATEGORY') resourceId(r.category_id);
          });
          const plans = c ? planTaxonomy(req.workspace_id, current, c) : [];
          for (const plan of plans) await tx.save(plan);
          const catalog = captureTaxonomyCatalog(
            {
              categories: current.categories,
              items: current.items
                .filter(
                  (r) =>
                    !plans.some(
                      (p) => p.after.kind === r.kind && p.after.id === r.id,
                    ),
                )
                .concat(plans.map((p) => p.after)),
            },
            req.workspace_id,
          );
          return Object.freeze({
            changed: plans.length > 0,
            item_ids: Object.freeze(
              plans.map((p) =>
                Object.freeze({ kind: p.after.kind, id: p.after.id }),
              ),
            ),
            categories: catalog.categories,
            items: filterTaxonomy(req.workspace_id, catalog, q),
          });
        },
      );
    } catch (e) {
      if (e instanceof TaxonomyError) throw e;
      throw new TaxonomyError('DATA_ACCESS_FAILED');
    }
  }
  return Object.freeze({
    list: (r: CategoryRequest, q: TaxonomyQuery = all) => execute(r, null, q),
    apply: (r: CategoryRequest, c: TaxonomyCommand) =>
      c === null || c === undefined
        ? Promise.reject(new TaxonomyError('INVALID_TAXONOMY_CHANGE'))
        : execute(r, c, all),
  });
}
