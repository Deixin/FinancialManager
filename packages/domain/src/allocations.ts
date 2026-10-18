import { requireId } from './model.js';
import { moneyMinor } from './money.js';
import {
  captureRevisionContent,
  captureRevisionState,
  captureRevisionChange,
} from './revisions.js';
import type {
  RevisionAllocation,
  RevisionState,
  RevisionChange,
  RevisionPlan,
} from './revisions.js';
import { captureTaxonomyCatalog } from './taxonomy.js';
import type { TaxonomyCatalog } from './taxonomy.js';

const codes = [
  'INVALID_ALLOCATION_CHANGE',
  'ALLOCATION_TOTAL_MISMATCH',
  'ALLOCATION_BASE_CONFLICT',
  'ALLOCATION_REFERENCE_UNAVAILABLE',
  'ALLOCATION_SCOPE_MISMATCH',
  'ALLOCATION_DELETED',
] as const;
export type AllocationCode = (typeof codes)[number];
export class AllocationError extends Error {
  readonly code: AllocationCode;
  constructor(code: AllocationCode) {
    const safe = codes.includes(code) ? code : 'INVALID_ALLOCATION_CHANGE';
    super(safe);
    this.name = 'AllocationError';
    this.code = safe;
  }
}
function fail(code: AllocationCode = 'INVALID_ALLOCATION_CHANGE'): never {
  throw new AllocationError(code);
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
export type AllocationSelection =
  | Readonly<{ kind: 'KEEP' }>
  | Readonly<{ kind: 'CLEAR' }>
  | Readonly<{ kind: 'REPLACE'; allocations: readonly RevisionAllocation[] }>;
export interface AllocationCommand {
  readonly base: RevisionState;
  readonly allocation: AllocationSelection;
}
/** Captures explicit final parcels without accepting financial or tag changes. */
export function captureAllocation(
  input: AllocationCommand,
  w: string,
): AllocationCommand {
  try {
    exact(input, ['base', 'allocation']);
    requireId(w);
    if (JSON.stringify(input).length > 4 * 1024 * 1024) fail();
    const base = captureRevisionState(input.base),
      s = input.allocation;
    if (base.workspace_id !== w) fail();
    if (base.content.deleted) fail('ALLOCATION_DELETED');
    let allocation: AllocationSelection;
    if (s?.kind === 'KEEP' || s?.kind === 'CLEAR') {
      exact(s, ['kind']);
      allocation = Object.freeze({ kind: s.kind });
    } else if (s?.kind === 'REPLACE') {
      exact(s, ['kind', 'allocations']);
      if (
        !Array.isArray(s.allocations) ||
        !s.allocations.length ||
        s.allocations.length > 1000
      )
        fail();
      let sum = 0n;
      for (const row of s.allocations) {
        const n = BigInt(moneyMinor(row.amount_minor));
        if (n <= 0n) fail();
        sum += n;
      }
      const amount = BigInt(base.content.account_amount_minor);
      if (sum !== (amount < 0n ? -amount : amount))
        fail('ALLOCATION_TOTAL_MISMATCH');
      allocation = Object.freeze({
        kind: 'REPLACE',
        allocations: captureRevisionContent({
          ...base.content,
          allocations: s.allocations,
        }).allocations,
      });
    } else return fail();
    return Object.freeze({ base, allocation });
  } catch (e) {
    if (e instanceof AllocationError) throw e;
    return fail();
  }
}
export function allocationChange(input: AllocationCommand): RevisionChange {
  const c = captureAllocation(input, input?.base?.workspace_id);
  return captureRevisionChange({
    id: c.base.id,
    base_revision: c.base.version,
    content: {
      ...c.base.content,
      allocations:
        c.allocation.kind === 'KEEP'
          ? c.base.content.allocations
          : c.allocation.kind === 'CLEAR'
            ? []
            : c.allocation.allocations,
    },
  });
}
export function validateAllocationPlan(
  input: AllocationCommand,
  plan: RevisionPlan,
  raw: TaxonomyCatalog,
  w: string,
): void {
  const c = captureAllocation(input, w),
    expected = allocationChange(c),
    before = plan.before;
  if (
    !before ||
    JSON.stringify(captureRevisionState(before)) !== JSON.stringify(c.base)
  )
    fail('ALLOCATION_BASE_CONFLICT');
  if (
    plan.after.id !== before.id ||
    plan.after.workspace_id !== w ||
    JSON.stringify(plan.after.content) !== JSON.stringify(expected.content)
  )
    fail();
  const catalog = captureTaxonomyCatalog(raw, w);
  for (const a of expected.content.allocations) {
    const previous = before.content.allocations.find((r) => r.id === a.id),
      category = catalog.categories.find((r) => r.id === a.category_id);
    const changed =
      !previous ||
      previous.category_id !== a.category_id ||
      previous.subcategory_id !== a.subcategory_id;
    if (!category || (changed && category.status !== 'ACTIVE'))
      fail('ALLOCATION_REFERENCE_UNAVAILABLE');
    if (changed) {
      const scope =
        before.content.economic_kind === 'INCOME'
          ? 'INCOME'
          : ['EXPENSE', 'EXPENSE_REVERSAL'].includes(
                before.content.economic_kind,
              )
            ? 'EXPENSE'
            : 'BOTH';
      if (
        category.category_scope !== 'BOTH' &&
        category.category_scope !== scope
      )
        fail('ALLOCATION_SCOPE_MISMATCH');
    }
    if (a.subcategory_id !== null) {
      const sub = catalog.items.find(
        (r) =>
          r.kind === 'SUBCATEGORY' &&
          r.id === a.subcategory_id &&
          r.category_id === a.category_id,
      );
      if (!sub || (changed && sub.status !== 'ACTIVE'))
        fail('ALLOCATION_REFERENCE_UNAVAILABLE');
    }
  }
}
