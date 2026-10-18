import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureTaxonomyCatalog,
  captureTaxonomyCommand,
  planTaxonomy,
} from '@financial-manager/domain/taxonomy';
import type {
  TaxonomyCatalog,
  TaxonomyCommand,
  TaxonomyItem,
} from '@financial-manager/domain/taxonomy';
export interface TaxonomySnapshot extends TaxonomyCatalog {
  readonly workspace_id: string;
}
export interface TaxonomyResult extends TaxonomyCatalog {
  readonly changed: boolean;
  readonly item_ids: readonly Readonly<{
    kind: TaxonomyItem['kind'];
    id: string;
  }>[];
}
const codes = [
  'INVALID_TAXONOMY_CHANGE',
  'INVALID_TAXONOMY_STATE',
  'TAXONOMY_NOT_FOUND',
  'TAXONOMY_BASE_CONFLICT',
  'TAXONOMY_NAME_CONFLICT',
  'TAXONOMY_PARENT_UNAVAILABLE',
  'TAXONOMY_LIMIT',
  'INVALID_RESPONSE',
  'LOCAL_LOCKED',
  'KEY_MISSING',
  'INSTALLATION_BUSY',
  'REQUEST_CONFLICT',
  'INTEGRITY_FAILURE',
  'UNSUPPORTED_SCHEMA',
  'STORAGE_UNAVAILABLE',
];
export class LocalTaxonomyError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('LOCAL_TAXONOMY_OPERATION_FAILED');
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
    Object.keys(v).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new LocalTaxonomyError('INVALID_RESPONSE');
}
export function captureLocalTaxonomy(
  input: TaxonomyCommand,
  w: string,
): TaxonomyCommand {
  try {
    resourceId(w);
    const c = captureTaxonomyCommand(input, w);
    if (c.kind === 'REORDER_SUBCATEGORIES') {
      resourceId(c.category_id);
      c.ids.forEach(resourceId);
    } else {
      (c.kind === 'CREATE' ? uuidV7 : resourceId)(c.item.id);
      if (c.item.kind === 'SUBCATEGORY') resourceId(c.item.category_id);
    }
    if (
      new TextEncoder().encode(JSON.stringify(c)).byteLength >
      4 * 1024 * 1024
    )
      throw new LocalTaxonomyError('TAXONOMY_LIMIT');
    return c;
  } catch (e) {
    throw new LocalTaxonomyError(
      e instanceof LocalTaxonomyError && e.code === 'TAXONOMY_LIMIT'
        ? e.code
        : 'INVALID_TAXONOMY_CHANGE',
    );
  }
}
export function decodeTaxonomySnapshot(
  raw: unknown,
  w: string,
): TaxonomySnapshot {
  try {
    resourceId(w);
    exact(raw, ['workspace_id', 'categories', 'items']);
    if (raw.workspace_id !== w) throw Error();
    const catalog = captureTaxonomyCatalog(
      { categories: raw.categories, items: raw.items } as TaxonomyCatalog,
      w,
    );
    catalog.categories.forEach((r) => resourceId(r.id));
    catalog.items.forEach((r) => {
      resourceId(r.id);
      if (r.kind === 'SUBCATEGORY') resourceId(r.category_id);
    });
    return Object.freeze({ workspace_id: w, ...catalog });
  } catch {
    throw new LocalTaxonomyError('INVALID_RESPONSE');
  }
}
export function decodeTaxonomyResult(
  raw: unknown,
  input: TaxonomyCommand,
  base: TaxonomySnapshot,
): TaxonomyResult {
  try {
    exact(raw, ['changed', 'item_ids', 'categories', 'items']);
    if (typeof raw.changed !== 'boolean' || !Array.isArray(raw.item_ids))
      throw Error();
    const next = decodeTaxonomySnapshot(
      {
        workspace_id: base.workspace_id,
        categories: raw.categories,
        items: raw.items,
      },
      base.workspace_id,
    );
    const plans = planTaxonomy(
        base.workspace_id,
        { categories: base.categories, items: base.items },
        input,
      ),
      keys = plans.map((p) => ({ kind: p.after.kind, id: p.after.id }));
    const ids = raw.item_ids.map((r) => {
      exact(r, ['kind', 'id']);
      if (r.kind !== 'TAG' && r.kind !== 'SUBCATEGORY') throw Error();
      return Object.freeze({ kind: r.kind, id: resourceId(r.id) });
    });
    const expected = captureTaxonomyCatalog(
      {
        categories: base.categories,
        items: base.items
          .filter(
            (r) =>
              !plans.some(
                (p) => p.after.kind === r.kind && p.after.id === r.id,
              ),
          )
          .concat(plans.map((p) => p.after)),
      },
      base.workspace_id,
    );
    if (
      JSON.stringify({ categories: next.categories, items: next.items }) !==
        JSON.stringify(expected) ||
      JSON.stringify(ids) !== JSON.stringify(raw.changed ? keys : []) ||
      (!raw.changed && plans.length && input.kind !== 'CREATE') ||
      (raw.changed && !plans.length)
    )
      throw Error();
    return Object.freeze({
      changed: raw.changed,
      item_ids: Object.freeze(ids),
      categories: next.categories,
      items: next.items,
    });
  } catch {
    throw new LocalTaxonomyError('INVALID_RESPONSE');
  }
}
export function createLocalTaxonomyGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (e) {
      throw new LocalTaxonomyError(
        typeof e === 'string' ? e : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async read(w: string) {
      return decodeTaxonomySnapshot(
        await call('read_local_taxonomy', { workspaceId: resourceId(w) }),
        w,
      );
    },
    async apply(w: string, input: TaxonomyCommand, snapshot: TaxonomySnapshot) {
      const base = decodeTaxonomySnapshot(snapshot, w),
        c = captureLocalTaxonomy(input, w);
      return decodeTaxonomyResult(
        await call('apply_local_taxonomy_change', { workspaceId: w, input: c }),
        c,
        base,
      );
    },
  });
}
export function localTaxonomyMessage(e: unknown) {
  const code = e instanceof LocalTaxonomyError ? e.code : '';
  if (code === 'TAXONOMY_NAME_CONFLICT')
    return 'Já existe um item ativo com esse nome. Escolha outro nome ou arquive o item existente.';
  if (code === 'TAXONOMY_BASE_CONFLICT')
    return 'O catálogo mudou ou a tentativa já foi registrada. Atualize e revise antes de alterar novamente.';
  if (code === 'TAXONOMY_PARENT_UNAVAILABLE')
    return 'A categoria não está disponível. Escolha uma categoria ativa ou atualize o catálogo.';
  if (code === 'INVALID_TAXONOMY_CHANGE')
    return 'Confira o nome, a categoria e a ordem do item.';
  if (code === 'TAXONOMY_LIMIT')
    return 'O catálogo excede o limite de leitura ou alteração. Nenhum resultado parcial foi aplicado.';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo foi bloqueado. Desbloqueie para continuar.';
  return 'Não foi possível concluir. Repita a mesma tentativa ou atualize o catálogo para conferir o resultado.';
}
