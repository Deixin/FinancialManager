import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  CounterpartyError,
  captureCounterparties,
  captureCounterpartyCommand,
  captureCounterpartyQuery,
  filterCounterparties,
  planCounterparty,
} from '@financial-manager/domain/counterparties';
import type {
  Counterparty,
  CounterpartyCommand,
  CounterpartyPlan,
  CounterpartyQuery,
} from '@financial-manager/domain/counterparties';
import type {
  CategoryRequest,
  CategoryWriteScope,
  CategoryOptions,
} from './categories.js';
export type CounterpartyRequest = CategoryRequest;
export type CounterpartyWriteScope = CategoryWriteScope;
export interface CounterpartyTransaction {
  workspace(): Promise<Readonly<{ storage_mode: 'LOCAL' | 'CLOUD' }> | null>;
  catalog(): Promise<readonly Counterparty[]>;
  save(plan: CounterpartyPlan): Promise<void>;
}
export interface CounterpartyOptions {
  readonly authorize: CategoryOptions['authorize'];
  readonly store: {
    transaction<T>(
      scope: CounterpartyWriteScope,
      operation: (tx: CounterpartyTransaction) => Promise<T>,
    ): Promise<T>;
  };
}
const all: CounterpartyQuery = Object.freeze({
  status: 'ALL',
  relationship_hint: 'ALL',
  search: '',
});
export function createCounterpartyService(options: CounterpartyOptions) {
  if (
    typeof options?.authorize !== 'function' ||
    typeof options.store?.transaction !== 'function'
  )
    throw new CounterpartyError('CONFIGURATION_INVALID');
  async function execute(
    input: CounterpartyRequest,
    command: CounterpartyCommand | null,
    query: CounterpartyQuery,
  ) {
    try {
      let req: Readonly<CounterpartyRequest>,
        c: CounterpartyCommand | null,
        q: CounterpartyQuery;
      try {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
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
            : captureCounterpartyCommand(command, req.workspace_id);
        q = captureCounterpartyQuery(query);
        if (c) (c.kind === 'CREATE' ? uuidV7 : resourceId)(c.item.id);
      } catch {
        throw new CounterpartyError('INVALID_COUNTERPARTY_CHANGE');
      }
      let grant;
      try {
        grant = await options.authorize(req);
      } catch {
        throw new CounterpartyError('ACCESS_DENIED');
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
        throw new CounterpartyError('ACCESS_DENIED');
      const authority = grant.authority;
      return await options.store.transaction(
        Object.freeze({ workspace_id: req.workspace_id }),
        async (tx) => {
          const workspace = await tx.workspace();
          if (!workspace || workspace.storage_mode !== authority)
            throw new CounterpartyError('ACCESS_DENIED');
          const rows = captureCounterparties(
            await tx.catalog(),
            req.workspace_id,
          );
          rows.forEach((r) => resourceId(r.id));
          const plan = c ? planCounterparty(req.workspace_id, rows, c) : null;
          const catalog = captureCounterparties(
            plan
              ? rows.filter((r) => r.id !== plan.after.id).concat(plan.after)
              : rows,
            req.workspace_id,
          );
          if (plan) await tx.save(plan);
          return Object.freeze({
            changed: plan !== null,
            items: filterCounterparties(req.workspace_id, catalog, q),
          });
        },
      );
    } catch (e) {
      if (e instanceof CounterpartyError) throw e;
      throw new CounterpartyError('DATA_ACCESS_FAILED');
    }
  }
  return Object.freeze({
    list: (r: CounterpartyRequest, q: CounterpartyQuery = all) =>
      execute(r, null, q),
    apply: (r: CounterpartyRequest, c: CounterpartyCommand) =>
      c === null || c === undefined
        ? Promise.reject(new CounterpartyError('INVALID_COUNTERPARTY_CHANGE'))
        : execute(r, c, all),
  });
}

export { createCounterpartyAssociationService } from './counterparty-associations.js';
