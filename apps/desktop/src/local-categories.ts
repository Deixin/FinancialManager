import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureCategoryCommand,
  captureCategories,
  categoryDefaults,
  planCategories,
} from '@financial-manager/domain/categories';
import type {
  CategoryCommand,
  CategoryPurpose,
  Category,
} from '@financial-manager/domain/categories';
export interface CategoriesSnapshot {
  readonly workspace_id: string;
  readonly purpose: CategoryPurpose;
  readonly categories: readonly Category[];
}
export interface CategoryResult {
  readonly changed: boolean;
  readonly category_ids: readonly string[];
  readonly categories: readonly Category[];
}
const codes = [
  'INVALID_CATEGORY_CHANGE',
  'INVALID_CATEGORY_STATE',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_BASE_CONFLICT',
  'CATEGORY_NAME_CONFLICT',
  'CATEGORY_SEED_CONFLICT',
  'CATEGORY_LIMIT',
  'INVALID_RESPONSE',
  'LOCAL_LOCKED',
  'KEY_MISSING',
  'INSTALLATION_BUSY',
  'REQUEST_CONFLICT',
  'INTEGRITY_FAILURE',
  'UNSUPPORTED_SCHEMA',
  'STORAGE_UNAVAILABLE',
];
export class LocalCategoryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('LOCAL_CATEGORY_OPERATION_FAILED');
    this.code = codes.includes(code) ? code : 'STORAGE_UNAVAILABLE';
  }
}
function exact(
  v: unknown,
  keys: readonly string[],
): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    JSON.stringify(Object.keys(v).sort()) !== JSON.stringify([...keys].sort())
  )
    throw new LocalCategoryError('INVALID_RESPONSE');
}
export function captureLocalCategory(input: CategoryCommand, w: string) {
  try {
    resourceId(w);
    const c = captureCategoryCommand(input, w);
    if (c.kind === 'SEED') c.ids.forEach(uuidV7);
    else if (c.kind === 'CREATE') uuidV7(c.id);
    else if (c.kind === 'UPDATE') resourceId(c.base.id);
    else c.ids.forEach(resourceId);
    if (
      new TextEncoder().encode(JSON.stringify(c)).byteLength >
      4 * 1024 * 1024
    )
      throw new LocalCategoryError('CATEGORY_LIMIT');
    return c;
  } catch (e) {
    throw new LocalCategoryError(
      e && typeof e === 'object' && 'code' in e && e.code === 'CATEGORY_LIMIT'
        ? 'CATEGORY_LIMIT'
        : 'INVALID_CATEGORY_CHANGE',
    );
  }
}
export function decodeCategoriesSnapshot(
  raw: unknown,
  w: string,
): CategoriesSnapshot {
  try {
    resourceId(w);
    exact(raw, ['workspace_id', 'purpose', 'categories']);
    if (raw.workspace_id !== w) throw Error();
    categoryDefaults(raw.purpose as CategoryPurpose);
    const categories = captureCategories(raw.categories, w);
    categories.forEach((r) => resourceId(r.id));
    return Object.freeze({
      workspace_id: w,
      purpose: raw.purpose as CategoryPurpose,
      categories,
    });
  } catch {
    throw new LocalCategoryError('INVALID_RESPONSE');
  }
}
export function decodeCategoryResult(
  raw: unknown,
  c: CategoryCommand,
  base: CategoriesSnapshot,
): CategoryResult {
  try {
    exact(raw, ['changed', 'category_ids', 'categories']);
    if (typeof raw.changed !== 'boolean' || !Array.isArray(raw.category_ids))
      throw Error();
    const categories = decodeCategoriesSnapshot(
        { ...base, categories: raw.categories },
        base.workspace_id,
      ).categories,
      plans = planCategories(
        base.workspace_id,
        base.purpose,
        base.categories,
        c,
      ),
      ids = raw.category_ids.map(resourceId),
      changed = plans.map((p) => p.after.id),
      expected = captureCategories(
        base.categories
          .filter((r) => !changed.includes(r.id))
          .concat(plans.map((p) => p.after)),
        base.workspace_id,
      );
    if (
      JSON.stringify(categories) !== JSON.stringify(expected) ||
      JSON.stringify(ids) !== JSON.stringify(raw.changed ? changed : []) ||
      (!raw.changed &&
        changed.length &&
        c.kind !== 'CREATE' &&
        c.kind !== 'SEED') ||
      (raw.changed && !changed.length)
    )
      throw Error();
    return Object.freeze({
      changed: raw.changed,
      category_ids: Object.freeze(ids),
      categories,
    });
  } catch {
    throw new LocalCategoryError('INVALID_RESPONSE');
  }
}
export function createLocalCategoriesGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (e) {
      throw new LocalCategoryError(
        typeof e === 'string' ? e : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async read(w: string) {
      return decodeCategoriesSnapshot(
        await call('read_local_categories', { workspaceId: resourceId(w) }),
        w,
      );
    },
    async apply(
      w: string,
      input: CategoryCommand,
      snapshot: CategoriesSnapshot,
    ) {
      const base = decodeCategoriesSnapshot(snapshot, w),
        c = captureLocalCategory(input, w);
      return decodeCategoryResult(
        await call('apply_local_category_change', { workspaceId: w, input: c }),
        c,
        base,
      );
    },
  });
}
export function localCategoryMessage(e: unknown) {
  const c = e instanceof LocalCategoryError ? e.code : '';
  if (c === 'CATEGORY_NAME_CONFLICT')
    return 'Já existe uma categoria ativa com esse nome. Revise o nome ou arquive a categoria existente.';
  if (c === 'CATEGORY_BASE_CONFLICT' || c === 'CATEGORY_SEED_CONFLICT')
    return 'O catálogo mudou ou esta tentativa já foi registrada. Atualize o catálogo e revise antes de alterar novamente.';
  if (c === 'INVALID_CATEGORY_CHANGE')
    return 'Confira o nome da categoria, o tipo e a ordem.';
  if (c === 'CATEGORY_LIMIT')
    return 'O catálogo excede o limite de leitura ou alteração. Nenhum resultado parcial foi aplicado.';
  if (c === 'LOCAL_LOCKED')
    return 'O aplicativo foi bloqueado. Desbloqueie para continuar.';
  return 'Não foi possível concluir. Você pode repetir a mesma tentativa ou atualizar o catálogo para conferir o resultado.';
}
