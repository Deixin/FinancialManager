// SYNTHETIC_US045_DESKTOP_ONLY. Browser transport double; SQLCipher is verified separately.
import { createTaxonomyService } from '../../packages/finance-ports/dist/taxonomy.js';
export const id = (n) =>
    '0199d245-0000-7000-8000-' + String(n).padStart(12, '0'),
  workspace = id(1),
  other = id(2),
  now = '2026-10-18T12:00:00.000Z';
export function syntheticTaxonomyHost() {
  const data = new Map(
    [workspace, other].map((w) => [
      w,
      {
        categories: [10, 11].map((n) => ({
          id: id(n + (w === other ? 20 : 0)),
          workspace_id: w,
          name: 'SYNTHETIC CATEGORY ' + n,
          category_scope: 'BOTH',
          sort_order: n,
          status: 'ACTIVE',
          is_seeded: false,
        })),
        items: [],
      },
    ]),
  );
  const service = createTaxonomyService({
    authorize: async (r) => ({
      workspace_id: r.workspace_id,
      authority: 'LOCAL',
      can_read: true,
      can_manage: true,
    }),
    store: {
      transaction: async (scope, run) => {
        if (!data.has(scope.workspace_id))
          throw Error('SYNTHETIC UNKNOWN WORKSPACE');
        const original = data.get(scope.workspace_id);
        let current = {
          categories: original.categories,
          items: [...original.items],
        };
        const result = await run({
          workspace: async () => ({ storage_mode: 'LOCAL' }),
          catalog: async () => current,
          save: async (p) => {
            current = {
              ...current,
              items: current.items
                .filter((r) => r.kind !== p.after.kind || r.id !== p.after.id)
                .concat(p.after),
            };
          },
        });
        data.set(scope.workspace_id, current);
        return result;
      },
    },
  });
  return {
    snapshot: (w) => ({
      workspace_id: w,
      ...data.get(w),
      items: [...data.get(w).items].sort((a, b) =>
        (a.kind + a.id).localeCompare(b.kind + b.id),
      ),
    }),
    apply: (w, c) => service.apply({ workspace_id: w }, c),
  };
}
