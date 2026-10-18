import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId } from '@financial-manager/contracts';
import { filterClassifications } from '@financial-manager/domain/classification';
import type { ClassificationFilter } from '@financial-manager/domain/classification';
import type { RevisionState } from '@financial-manager/domain/revisions';
import {
  decodeMovementsSnapshot,
  LocalMovementError,
} from './local-movements.js';
import type { MovementsSnapshot } from './local-movements.js';
import { decodeTaxonomySnapshot } from './local-taxonomy.js';
import type { TaxonomySnapshot } from './local-taxonomy.js';
export interface ClassificationSnapshot {
  readonly movements: MovementsSnapshot;
  readonly catalog: TaxonomySnapshot;
}
export function classificationReferenceName(
  snapshot: ClassificationSnapshot | null,
  kind: 'CATEGORY' | 'SUBCATEGORY' | 'TAG',
  id: string,
) {
  return (
    (kind === 'CATEGORY'
      ? snapshot?.catalog.categories.find((r) => r.id === id)
      : snapshot?.catalog.items.find((r) => r.kind === kind && r.id === id)
    )?.name ?? 'Referência indisponível'
  );
}
export const emptyClassificationFilter: ClassificationFilter = Object.freeze({
  category_id: null,
  subcategory_id: null,
  tag_ids: Object.freeze([]),
  tag_match: 'ANY',
  unclassified_only: false,
});
export function decodeClassificationSnapshot(
  value: unknown,
  workspace: string,
): ClassificationSnapshot {
  try {
    resourceId(workspace);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'balance,classification,history,transactions'
    )
      throw Error();
    const raw = value as Record<string, unknown>,
      movements = decodeMovementsSnapshot(
        {
          balance: raw.balance,
          transactions: raw.transactions,
          history: raw.history,
        },
        workspace,
      ),
      catalog = decodeTaxonomySnapshot(raw.classification, workspace),
      categories = new Set(catalog.categories.map((r) => r.id)),
      tags = new Set(
        catalog.items.filter((r) => r.kind === 'TAG').map((r) => r.id),
      ),
      subs = new Map(
        catalog.items
          .filter((r) => r.kind === 'SUBCATEGORY')
          .map((r) => [r.id, r.category_id]),
      );
    // The shared filter also checks its complete-snapshot bounds and state identity.
    filterClassifications(
      workspace,
      movements.transactions,
      emptyClassificationFilter,
    );
    for (const state of movements.transactions) {
      if (
        state.content.tag_ids.some((id) => !tags.has(id)) ||
        state.content.allocations.some(
          (a) =>
            !categories.has(a.category_id) ||
            (a.subcategory_id !== null &&
              subs.get(a.subcategory_id) !== a.category_id),
        )
      )
        throw Error();
    }
    return Object.freeze({ movements, catalog });
  } catch {
    throw new LocalMovementError('INVALID_RESPONSE');
  }
}
export function classificationRows(
  workspace: string,
  snapshot: ClassificationSnapshot,
  filter: ClassificationFilter,
  accountId: string,
  from: string,
  to: string,
): readonly RevisionState[] {
  return Object.freeze(
    filterClassifications(
      workspace,
      snapshot.movements.transactions,
      filter,
    ).filter(
      (s) =>
        (!accountId || s.content.account_id === accountId) &&
        (!from || s.content.financial_date >= from) &&
        (!to || s.content.financial_date <= to),
    ),
  );
}
export function createLocalClassificationFiltersGateway() {
  if (!isTauri()) return null;
  return Object.freeze({
    async read(workspace: string) {
      let raw: unknown;
      try {
        raw = await invoke<unknown>('read_local_movements', {
          workspaceId: resourceId(workspace),
          includeClassification: true,
        });
      } catch (error) {
        throw new LocalMovementError(
          typeof error === 'string' ? error : 'STORAGE_UNAVAILABLE',
        );
      }
      return decodeClassificationSnapshot(raw, workspace);
    },
  });
}
