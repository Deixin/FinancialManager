import { requireId } from './model.js';
import { captureCategories, categoryNameKey } from './categories.js';
import type { Category } from './categories.js';

interface Label {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}
export interface Tag extends Label {
  readonly kind: 'TAG';
}
export interface Subcategory extends Label {
  readonly kind: 'SUBCATEGORY';
  readonly category_id: string;
  readonly sort_order: number;
}
export type TaxonomyItem = Tag | Subcategory;
export interface TaxonomyCatalog {
  readonly categories: readonly Category[];
  readonly items: readonly TaxonomyItem[];
}
export type TaxonomyCode =
  | 'INVALID_TAXONOMY_CHANGE'
  | 'INVALID_TAXONOMY_STATE'
  | 'TAXONOMY_BASE_CONFLICT'
  | 'TAXONOMY_NAME_CONFLICT'
  | 'TAXONOMY_NOT_FOUND'
  | 'TAXONOMY_PARENT_UNAVAILABLE'
  | 'TAXONOMY_LIMIT'
  | 'ACCESS_DENIED'
  | 'CONFIGURATION_INVALID'
  | 'DATA_ACCESS_FAILED'
  | 'CLOSED'
  | 'NESTED_UNIT';
const codes: readonly TaxonomyCode[] = [
  'INVALID_TAXONOMY_CHANGE',
  'INVALID_TAXONOMY_STATE',
  'TAXONOMY_BASE_CONFLICT',
  'TAXONOMY_NAME_CONFLICT',
  'TAXONOMY_NOT_FOUND',
  'TAXONOMY_PARENT_UNAVAILABLE',
  'TAXONOMY_LIMIT',
  'ACCESS_DENIED',
  'CONFIGURATION_INVALID',
  'DATA_ACCESS_FAILED',
  'CLOSED',
  'NESTED_UNIT',
];
export class TaxonomyError extends Error {
  readonly code: TaxonomyCode;
  constructor(code: TaxonomyCode) {
    const safe = codes.includes(code) ? code : 'DATA_ACCESS_FAILED';
    super(safe);
    this.name = 'TaxonomyError';
    this.code = safe;
  }
}
function fail(code: TaxonomyCode = 'INVALID_TAXONOMY_CHANGE'): never {
  throw new TaxonomyError(code);
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
    fail();
}
function order(v: unknown): number {
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v < -2147483648 ||
    v > 2147483647
  )
    fail();
  return v;
}
function name(v: string) {
  if (!v.trim() || v.trim().length > 120 || /\p{Cc}/u.test(v)) fail();
  return v.trim();
}
export function captureTaxonomyItem(raw: unknown, w: string): TaxonomyItem {
  const v = raw as Record<string, unknown>;
  try {
    if (!v || typeof v !== 'object' || !('kind' in v)) fail();
    const kind = v.kind;
    if (kind !== 'TAG' && kind !== 'SUBCATEGORY') fail();
    exact(v, [
      'kind',
      'id',
      'workspace_id',
      'name',
      'status',
      ...(kind === 'SUBCATEGORY' ? ['category_id', 'sort_order'] : []),
    ]);
    requireId(w);
    requireId(v.id);
    requireId(v.workspace_id);
    if (
      v.workspace_id !== w ||
      typeof v.name !== 'string' ||
      !categoryNameKey(v.name) ||
      (v.status !== 'ACTIVE' && v.status !== 'ARCHIVED')
    )
      fail();
    const common = {
      id: v.id,
      workspace_id: w,
      name: v.name,
      status: v.status,
    } as const;
    if (kind === 'TAG') return Object.freeze({ kind, ...common });
    requireId(v.category_id);
    return Object.freeze({
      kind,
      ...common,
      category_id: v.category_id,
      sort_order: order(v.sort_order),
    });
  } catch {
    return fail('INVALID_TAXONOMY_STATE');
  }
}
export function captureTaxonomyCatalog(
  v: TaxonomyCatalog,
  w: string,
): TaxonomyCatalog {
  try {
    exact(v, ['categories', 'items']);
    if (!Array.isArray(v.items)) fail();
    if (v.items.length > 10000 || JSON.stringify(v).length > 4 * 1024 * 1024)
      fail('TAXONOMY_LIMIT');
    const categories = captureCategories(v.categories, w),
      items = v.items.map((r) => captureTaxonomyItem(r, w));
    if (
      new Set(items.map((r) => r.kind + r.id)).size !== items.length ||
      items.some(
        (r) =>
          r.kind === 'SUBCATEGORY' &&
          !categories.some((c) => c.id === r.category_id),
      )
    )
      fail();
    return Object.freeze({
      categories,
      items: Object.freeze(
        items.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)),
      ),
    });
  } catch (e) {
    return fail(
      e instanceof TaxonomyError && e.code === 'TAXONOMY_LIMIT'
        ? e.code
        : 'INVALID_TAXONOMY_STATE',
    );
  }
}
export type TaxonomyCommand =
  | Readonly<{ kind: 'CREATE'; item: TaxonomyItem }>
  | Readonly<{ kind: 'UPDATE'; base: TaxonomyItem; item: TaxonomyItem }>
  | Readonly<{
      kind: 'REORDER_SUBCATEGORIES';
      category_id: string;
      bases: readonly Subcategory[];
      ids: readonly string[];
    }>;
export interface TaxonomyPlan {
  readonly before: TaxonomyItem | null;
  readonly after: TaxonomyItem;
}
const same = (a: TaxonomyItem, b: TaxonomyItem) =>
  JSON.stringify(a) === JSON.stringify(b);
export function captureTaxonomyCommand(
  raw: unknown,
  w: string,
): TaxonomyCommand {
  const v = raw as Record<string, unknown>;
  try {
    if (JSON.stringify(v).length > 4 * 1024 * 1024) fail();
    if (!v || typeof v !== 'object' || !('kind' in v)) fail();
    if (v.kind === 'CREATE' || v.kind === 'UPDATE') {
      const kind = v.kind;
      exact(v, kind === 'CREATE' ? ['kind', 'item'] : ['kind', 'base', 'item']);
      const item = captureTaxonomyItem(v.item, w),
        base = kind === 'UPDATE' ? captureTaxonomyItem(v.base, w) : null;
      if (
        base &&
        (base.kind !== item.kind ||
          base.id !== item.id ||
          (base.kind === 'SUBCATEGORY' &&
            item.kind === 'SUBCATEGORY' &&
            base.category_id !== item.category_id))
      )
        fail();
      if (!base && item.status !== 'ACTIVE') fail();
      const captured = Object.freeze({
        ...item,
        name: base?.name === item.name ? item.name : name(item.name),
      });
      return base
        ? Object.freeze({ kind: 'UPDATE', base, item: captured })
        : Object.freeze({ kind: 'CREATE', item: captured });
    }
    if (v.kind === 'REORDER_SUBCATEGORIES') {
      exact(v, ['kind', 'category_id', 'bases', 'ids']);
      requireId(v.category_id);
      if (
        !Array.isArray(v.bases) ||
        !Array.isArray(v.ids) ||
        v.bases.length > 10000 ||
        v.ids.length > 10000
      )
        fail();
      const parent = v.category_id,
        bases = v.bases.map((r) => captureTaxonomyItem(r, w));
      const ids = v.ids.map((r) => {
        requireId(r);
        return r;
      });
      if (
        bases.some(
          (r) =>
            r.kind !== 'SUBCATEGORY' ||
            r.category_id !== parent ||
            r.status !== 'ACTIVE',
        ) ||
        new Set(ids).size !== ids.length ||
        new Set(bases.map((r) => r.id)).size !== bases.length ||
        ids.length !== bases.length ||
        ids.some((id) => !bases.some((r) => r.id === id))
      )
        fail();
      return Object.freeze({
        kind: 'REORDER_SUBCATEGORIES',
        category_id: parent,
        bases: Object.freeze(bases as Subcategory[]),
        ids: Object.freeze(ids),
      });
    }
    return fail();
  } catch {
    return fail();
  }
}
export function planTaxonomy(
  w: string,
  raw: TaxonomyCatalog,
  input: TaxonomyCommand,
): readonly TaxonomyPlan[] {
  const current = captureTaxonomyCatalog(raw, w),
    c = captureTaxonomyCommand(input, w),
    plans: TaxonomyPlan[] = [];
  const add = (before: TaxonomyItem | null, after: TaxonomyItem) => {
    if (!before || !same(before, after))
      plans.push(Object.freeze({ before, after }));
  };
  if (c.kind === 'REORDER_SUBCATEGORIES') {
    const active = current.items.filter(
      (r) =>
        r.kind === 'SUBCATEGORY' &&
        r.category_id === c.category_id &&
        r.status === 'ACTIVE',
    );
    if (!current.categories.some((r) => r.id === c.category_id))
      fail('TAXONOMY_PARENT_UNAVAILABLE');
    if (
      active.length !== c.bases.length ||
      c.bases.some((a) => !active.some((b) => same(a, b)))
    )
      fail('TAXONOMY_BASE_CONFLICT');
    c.ids.forEach((id, sort_order) => {
      const before = active.find((r) => r.id === id)!;
      add(before, { ...before, sort_order } as Subcategory);
    });
  } else {
    const before = current.items.find(
      (r) => r.kind === c.item.kind && r.id === c.item.id,
    );
    if (c.kind === 'CREATE' && before) {
      if (same(before, c.item)) return Object.freeze([]);
      fail('TAXONOMY_BASE_CONFLICT');
    }
    if (c.kind === 'UPDATE') {
      if (!before) fail('TAXONOMY_NOT_FOUND');
      if (!same(before, c.base)) fail('TAXONOMY_BASE_CONFLICT');
    }
    const item = c.item;
    if (
      item.kind === 'SUBCATEGORY' &&
      (!before ||
        (before.status === 'ARCHIVED' && c.item.status === 'ACTIVE')) &&
      !current.categories.some(
        (r) => r.id === item.category_id && r.status === 'ACTIVE',
      )
    )
      fail('TAXONOMY_PARENT_UNAVAILABLE');
    add(before ?? null, c.item);
  }
  const next = current.items
    .filter(
      (r) => !plans.some((p) => p.after.kind === r.kind && p.after.id === r.id),
    )
    .concat(plans.map((p) => p.after));
  const catalog = captureTaxonomyCatalog(
    { categories: current.categories, items: next },
    w,
  );
  const nameKey = (r: TaxonomyItem) =>
    JSON.stringify([
      r.kind,
      r.kind === 'SUBCATEGORY' ? r.category_id : null,
      categoryNameKey(r.name),
    ]);
  for (const p of plans) {
    if (
      p.after.status === 'ACTIVE' &&
      (!p.before ||
        p.before.status === 'ARCHIVED' ||
        nameKey(p.before) !== nameKey(p.after)) &&
      catalog.items.some(
        (r) =>
          r.status === 'ACTIVE' &&
          (r.kind !== p.after.kind || r.id !== p.after.id) &&
          nameKey(r) === nameKey(p.after),
      )
    )
      fail('TAXONOMY_NAME_CONFLICT');
  }
  return Object.freeze(plans);
}
export interface TaxonomyQuery {
  readonly kind: 'ALL' | TaxonomyItem['kind'];
  readonly status: 'ALL' | TaxonomyItem['status'];
  readonly category_id: string | null;
  readonly search: string;
}
export function captureTaxonomyQuery(v: TaxonomyQuery): TaxonomyQuery {
  exact(v, ['kind', 'status', 'category_id', 'search']);
  if (
    !['ALL', 'TAG', 'SUBCATEGORY'].includes(v.kind) ||
    !['ALL', 'ACTIVE', 'ARCHIVED'].includes(v.status) ||
    typeof v.search !== 'string' ||
    v.search.length > 120 ||
    /\p{Cc}/u.test(v.search) ||
    (v.kind === 'TAG' && v.category_id !== null)
  )
    fail();
  if (v.category_id !== null) requireId(v.category_id);
  return Object.freeze({
    kind: v.kind,
    status: v.status,
    category_id: v.category_id,
    search: categoryNameKey(v.search),
  });
}
export function filterTaxonomy(
  w: string,
  raw: TaxonomyCatalog,
  input: TaxonomyQuery,
): readonly TaxonomyItem[] {
  const catalog = captureTaxonomyCatalog(raw, w),
    q = captureTaxonomyQuery(input);
  return Object.freeze(
    catalog.items
      .filter(
        (r) =>
          (q.kind === 'ALL' || r.kind === q.kind) &&
          (q.status === 'ALL' || r.status === q.status) &&
          (q.category_id === null ||
            (r.kind === 'SUBCATEGORY' && r.category_id === q.category_id)) &&
          categoryNameKey(r.name).includes(q.search),
      )
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          (a.kind === 'SUBCATEGORY' && b.kind === 'SUBCATEGORY'
            ? a.category_id.localeCompare(b.category_id) ||
              a.sort_order - b.sort_order
            : 0) ||
          categoryNameKey(a.name).localeCompare(categoryNameKey(b.name)) ||
          a.id.localeCompare(b.id),
      ),
  );
}
