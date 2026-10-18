// Explicitly synthetic in-memory browser host; persistence is tested separately in SQLCipher.
import { createCategoryService } from '../../packages/finance-ports/dist/categories.js';
export const id = (n) =>
    '0199d244-0000-7000-8000-' + String(n).padStart(12, '0'),
  workspace = id(1),
  other = id(2),
  now = '2026-10-18T12:00:00.000Z';
export function syntheticCategoryHost() {
  const data = new Map([
    [workspace, []],
    [other, []],
  ]);
  const purpose = (w) => (w === other ? 'BUSINESS' : 'PERSONAL');
  const service = createCategoryService({
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
        let current = [...original];
        try {
          const result = await run({
            workspace: async () => ({
              storage_mode: 'LOCAL',
              purpose: purpose(scope.workspace_id),
            }),
            list: async () => current,
            save: async (p) => {
              current = current
                .filter((r) => r.id !== p.after.id)
                .concat(p.after);
            },
          });
          data.set(scope.workspace_id, current);
          return result;
        } catch (e) {
          data.set(scope.workspace_id, original);
          throw e;
        }
      },
    },
  });
  return {
    snapshot: (w) => ({
      workspace_id: w,
      purpose: purpose(w),
      categories: [...data.get(w)].sort((a, b) => a.id.localeCompare(b.id)),
    }),
    apply: (w, c) => service.apply({ workspace_id: w }, c),
  };
}
