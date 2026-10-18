import { requireId } from './model.js';

export type CategoryScope = 'EXPENSE' | 'INCOME' | 'BOTH';
export type CategoryPurpose = 'PERSONAL' | 'BUSINESS' | 'OTHER';
export interface Category {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly category_scope: CategoryScope;
  readonly sort_order: number;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly is_seeded: boolean;
}
export type CategoryCode =
  | 'INVALID_CATEGORY_CHANGE'
  | 'INVALID_CATEGORY_STATE'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_BASE_CONFLICT'
  | 'CATEGORY_NAME_CONFLICT'
  | 'CATEGORY_SEED_CONFLICT'
  | 'CATEGORY_LIMIT'
  | 'ACCESS_DENIED'
  | 'CONFIGURATION_INVALID'
  | 'DATA_ACCESS_FAILED'
  | 'CLOSED'
  | 'NESTED_UNIT';
const codes: readonly CategoryCode[] = [
  'INVALID_CATEGORY_CHANGE',
  'INVALID_CATEGORY_STATE',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_BASE_CONFLICT',
  'CATEGORY_NAME_CONFLICT',
  'CATEGORY_SEED_CONFLICT',
  'CATEGORY_LIMIT',
  'ACCESS_DENIED',
  'CONFIGURATION_INVALID',
  'DATA_ACCESS_FAILED',
  'CLOSED',
  'NESTED_UNIT',
];
export class CategoryError extends Error {
  readonly code: CategoryCode;
  constructor(code: CategoryCode) {
    const safe = codes.includes(code) ? code : 'DATA_ACCESS_FAILED';
    super(safe);
    this.name = 'CategoryError';
    this.code = safe;
  }
}
function fail(code: CategoryCode = 'INVALID_CATEGORY_CHANGE'): never {
  throw new CategoryError(code);
}
const profiles = {
  PERSONAL: [
    ['Alimentação', 'EXPENSE'],
    ['Moradia', 'EXPENSE'],
    ['Transporte', 'EXPENSE'],
    ['Saúde', 'EXPENSE'],
    ['Educação', 'EXPENSE'],
    ['Lazer', 'EXPENSE'],
    ['Outras despesas', 'EXPENSE'],
    ['Salário', 'INCOME'],
    ['Outras receitas', 'INCOME'],
  ],
  BUSINESS: [
    ['Despesas operacionais', 'EXPENSE'],
    ['Fornecedores', 'EXPENSE'],
    ['Pessoal', 'EXPENSE'],
    ['Tributos', 'EXPENSE'],
    ['Tarifas e juros', 'EXPENSE'],
    ['Outras despesas', 'EXPENSE'],
    ['Vendas', 'INCOME'],
    ['Prestação de serviços', 'INCOME'],
    ['Outras receitas', 'INCOME'],
  ],
  OTHER: [
    ['Receitas', 'INCOME'],
    ['Despesas', 'EXPENSE'],
  ],
} as const;
export function categoryDefaults(purpose: CategoryPurpose) {
  if (purpose !== 'PERSONAL' && purpose !== 'BUSINESS' && purpose !== 'OTHER')
    fail();
  return Object.freeze(
    profiles[purpose].map(([name, category_scope], sort_order) =>
      Object.freeze({ name, category_scope, sort_order }),
    ),
  );
}
export type CategoryCommand =
  | Readonly<{
      kind: 'SEED';
      profile_version: 1;
      purpose: CategoryPurpose;
      ids: readonly string[];
    }>
  | Readonly<{
      kind: 'CREATE';
      id: string;
      name: string;
      category_scope: CategoryScope;
      sort_order: number;
    }>
  | Readonly<{
      kind: 'UPDATE';
      base: Category;
      name: string;
      sort_order: number;
      status: Category['status'];
    }>
  | Readonly<{
      kind: 'REORDER';
      bases: readonly Category[];
      ids: readonly string[];
    }>;
export interface CategoryPlan {
  readonly before: Category | null;
  readonly after: Category;
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
export function categoryNameKey(v: string) {
  return v.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
function name(v: unknown) {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.trim().length > 120 ||
    /\p{Cc}/u.test(v)
  )
    fail();
  return v.trim();
}
function scope(v: unknown): CategoryScope {
  if (v !== 'EXPENSE' && v !== 'INCOME' && v !== 'BOTH') fail();
  return v;
}
function status(v: unknown): Category['status'] {
  if (v !== 'ACTIVE' && v !== 'ARCHIVED') fail();
  return v;
}
export function captureCategory(v: unknown, w: string): Category {
  try {
    exact(v, [
      'id',
      'workspace_id',
      'name',
      'category_scope',
      'sort_order',
      'status',
      'is_seeded',
    ]);
    requireId(v.id);
    requireId(v.workspace_id);
    requireId(w);
    if (
      v.workspace_id !== w ||
      typeof v.name !== 'string' ||
      !categoryNameKey(v.name) ||
      typeof v.is_seeded !== 'boolean'
    )
      fail();
    return Object.freeze({
      id: v.id,
      workspace_id: w,
      name: v.name,
      category_scope: scope(v.category_scope),
      sort_order: order(v.sort_order),
      status: status(v.status),
      is_seeded: v.is_seeded,
    });
  } catch {
    throw new CategoryError('INVALID_CATEGORY_STATE');
  }
}
export function captureCategories(v: unknown, w: string): readonly Category[] {
  if (!Array.isArray(v)) fail('INVALID_CATEGORY_STATE');
  if (v.length > 10000 || JSON.stringify(v).length > 4 * 1024 * 1024)
    fail('CATEGORY_LIMIT');
  const rows = v.map((r) => captureCategory(r, w));
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    fail('INVALID_CATEGORY_STATE');
  return Object.freeze(rows.sort((a, b) => a.id.localeCompare(b.id)));
}
function ids(v: unknown): readonly string[] {
  if (!Array.isArray(v) || v.length > 10000) fail();
  v.forEach(requireId);
  if (new Set(v).size !== v.length) fail();
  return Object.freeze([...v]) as readonly string[];
}
export function captureCategoryCommand(v: unknown, w: string): CategoryCommand {
  try {
    requireId(w);
    if (!v || typeof v !== 'object') fail();
    const c = v as CategoryCommand;
    if (c.kind === 'SEED') {
      exact(c, ['kind', 'profile_version', 'purpose', 'ids']);
      if (c.profile_version !== 1) fail();
      const list = ids(c.ids);
      if (list.length !== categoryDefaults(c.purpose).length) fail();
      return Object.freeze({
        kind: 'SEED',
        profile_version: 1,
        purpose: c.purpose,
        ids: list,
      });
    }
    if (c.kind === 'CREATE') {
      exact(c, ['kind', 'id', 'name', 'category_scope', 'sort_order']);
      requireId(c.id);
      return Object.freeze({
        kind: 'CREATE',
        id: c.id,
        name: name(c.name),
        category_scope: scope(c.category_scope),
        sort_order: order(c.sort_order),
      });
    }
    if (c.kind === 'UPDATE') {
      exact(c, ['kind', 'base', 'name', 'sort_order', 'status']);
      const base = captureCategory(c.base, w);
      return Object.freeze({
        kind: 'UPDATE',
        base,
        name: c.name === base.name ? base.name : name(c.name),
        sort_order: order(c.sort_order),
        status: status(c.status),
      });
    }
    if (c.kind === 'REORDER') {
      exact(c, ['kind', 'bases', 'ids']);
      const bases = captureCategories(c.bases, w),
        list = ids(c.ids);
      if (
        bases.some((b) => b.status !== 'ACTIVE') ||
        list.length !== bases.length ||
        list.some((id) => !bases.some((b) => b.id === id))
      )
        fail();
      return Object.freeze({ kind: 'REORDER', bases, ids: list });
    }
    return fail();
  } catch (e) {
    throw e instanceof CategoryError && e.code === 'CATEGORY_LIMIT'
      ? e
      : new CategoryError('INVALID_CATEGORY_CHANGE');
  }
}
const same = (a: Category, b: Category) =>
  JSON.stringify(a) === JSON.stringify(b);
export function planCategories(
  w: string,
  purpose: CategoryPurpose,
  raw: readonly Category[],
  input: CategoryCommand,
): readonly CategoryPlan[] {
  const current = captureCategories(raw, w),
    c = captureCategoryCommand(input, w),
    plans: CategoryPlan[] = [];
  if (purpose !== 'PERSONAL' && purpose !== 'BUSINESS' && purpose !== 'OTHER')
    fail('INVALID_CATEGORY_STATE');
  const add = (before: Category | null, after: Category) => {
    const captured = captureCategory(after, w);
    if (!before || !same(before, captured))
      plans.push(Object.freeze({ before, after: captured }));
  };
  if (c.kind === 'SEED') {
    if (c.purpose !== purpose) fail('CATEGORY_SEED_CONFLICT');
    const expected = categoryDefaults(purpose).map((row, i) =>
      captureCategory(
        {
          ...row,
          id: c.ids[i]!,
          workspace_id: w,
          status: 'ACTIVE',
          is_seeded: true,
        },
        w,
      ),
    );
    if (current.length) {
      if (
        current.length === expected.length &&
        expected.every((a) => current.some((b) => same(a, b)))
      )
        return Object.freeze([]);
      fail('CATEGORY_SEED_CONFLICT');
    }
    for (const after of expected) add(null, after);
  } else if (c.kind === 'CREATE') {
    const after = captureCategory(
        {
          id: c.id,
          workspace_id: w,
          name: c.name,
          category_scope: c.category_scope,
          sort_order: c.sort_order,
          status: 'ACTIVE',
          is_seeded: false,
        },
        w,
      ),
      before = current.find((r) => r.id === c.id);
    if (before) {
      if (same(before, after)) return Object.freeze([]);
      fail('CATEGORY_BASE_CONFLICT');
    }
    add(null, after);
  } else if (c.kind === 'UPDATE') {
    const before = current.find((r) => r.id === c.base.id);
    if (!before) fail('CATEGORY_NOT_FOUND');
    if (!same(before, c.base)) fail('CATEGORY_BASE_CONFLICT');
    add(before, {
      ...before,
      name: c.name,
      sort_order: c.sort_order,
      status: c.status,
    });
  } else {
    const active = current.filter((r) => r.status === 'ACTIVE');
    if (
      active.length !== c.bases.length ||
      c.bases.some((a) => !active.some((b) => same(a, b)))
    )
      fail('CATEGORY_BASE_CONFLICT');
    for (const [sort_order, id] of c.ids.entries()) {
      const before = active.find((r) => r.id === id)!;
      add(before, { ...before, sort_order });
    }
  }
  const next = current
      .filter((r) => !plans.some((p) => p.after.id === r.id))
      .concat(plans.map((p) => p.after)),
    names = new Set<string>();
  if (next.length > 10000) fail('CATEGORY_LIMIT');
  for (const row of next.filter((r) => r.status === 'ACTIVE')) {
    const key = categoryNameKey(row.name);
    if (names.has(key)) fail('CATEGORY_NAME_CONFLICT');
    names.add(key);
  }
  return Object.freeze(
    plans.sort((a, b) => a.after.id.localeCompare(b.after.id)),
  );
}
