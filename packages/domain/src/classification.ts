import { requireId } from './model.js';
export {
  captureAllocation,
  allocationChange,
  validateAllocationPlan,
  AllocationError,
} from './allocations.js';
export type {
  AllocationCommand,
  AllocationSelection,
  AllocationCode,
} from './allocations.js';
import { moneyMinor } from './money.js';
import { captureRevisionState, captureRevisionChange } from './revisions.js';
import type {
  RevisionState,
  RevisionChange,
  RevisionPlan,
} from './revisions.js';
import { captureTaxonomyCatalog } from './taxonomy.js';
import type { TaxonomyCatalog } from './taxonomy.js';
export type ClassificationCode =
  | 'INVALID_CLASSIFICATION'
  | 'CLASSIFICATION_BASE_CONFLICT'
  | 'CLASSIFICATION_REFERENCE_UNAVAILABLE'
  | 'CLASSIFICATION_SCOPE_MISMATCH'
  | 'CLASSIFICATION_SPLIT_REVIEW_REQUIRED'
  | 'CLASSIFICATION_AMOUNT_UNSUPPORTED'
  | 'CLASSIFICATION_DELETED'
  | 'CLASSIFICATION_STATE_CONFLICT';
const codes: readonly ClassificationCode[] = [
  'INVALID_CLASSIFICATION',
  'CLASSIFICATION_BASE_CONFLICT',
  'CLASSIFICATION_REFERENCE_UNAVAILABLE',
  'CLASSIFICATION_SCOPE_MISMATCH',
  'CLASSIFICATION_SPLIT_REVIEW_REQUIRED',
  'CLASSIFICATION_AMOUNT_UNSUPPORTED',
  'CLASSIFICATION_DELETED',
  'CLASSIFICATION_STATE_CONFLICT',
];
export class ClassificationError extends Error {
  readonly code: ClassificationCode;
  constructor(code: ClassificationCode) {
    const safe = codes.includes(code) ? code : 'INVALID_CLASSIFICATION';
    super(safe);
    this.name = 'ClassificationError';
    this.code = safe;
  }
}
function fail(code: ClassificationCode = 'INVALID_CLASSIFICATION'): never {
  throw new ClassificationError(code);
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
export type ClassificationSelection =
  | Readonly<{ kind: 'KEEP' }>
  | Readonly<{ kind: 'CLEAR' }>
  | Readonly<{
      kind: 'SET';
      allocation_id: string;
      category_id: string;
      subcategory_id: string | null;
    }>;
export interface ClassificationCommand {
  readonly base: RevisionState;
  readonly classification: ClassificationSelection;
  readonly tag_ids: readonly string[];
}
function ids(v: unknown): readonly string[] {
  if (!Array.isArray(v) || v.length > 10000) fail();
  v.forEach(requireId);
  if (new Set(v).size !== v.length) fail();
  return Object.freeze([...v].sort());
}
export function captureClassification(
  input: ClassificationCommand,
  w: string,
): ClassificationCommand {
  try {
    exact(input, ['base', 'classification', 'tag_ids']);
    requireId(w);
    if (JSON.stringify(input).length > 4 * 1024 * 1024) fail();
    const base = captureRevisionState(input.base),
      c = input.classification;
    if (base.workspace_id !== w) fail();
    if (base.content.deleted) fail('CLASSIFICATION_DELETED');
    let selection: ClassificationSelection;
    if (c?.kind === 'KEEP' || c?.kind === 'CLEAR') {
      exact(c, ['kind']);
      selection = Object.freeze({ kind: c.kind });
    } else if (c?.kind === 'SET') {
      exact(c, ['kind', 'allocation_id', 'category_id', 'subcategory_id']);
      requireId(c.allocation_id);
      requireId(c.category_id);
      if (c.subcategory_id !== null) requireId(c.subcategory_id);
      selection = Object.freeze({
        kind: 'SET',
        allocation_id: c.allocation_id,
        category_id: c.category_id,
        subcategory_id: c.subcategory_id,
      });
    } else return fail();
    if (selection.kind !== 'KEEP' && base.content.allocations.length > 1)
      fail('CLASSIFICATION_SPLIT_REVIEW_REQUIRED');
    if (
      selection.kind === 'SET' &&
      base.content.allocations.length === 1 &&
      base.content.allocations[0]!.id !== selection.allocation_id
    )
      fail();
    return Object.freeze({
      base,
      classification: selection,
      tag_ids: ids(input.tag_ids),
    });
  } catch (e) {
    if (e instanceof ClassificationError) throw e;
    return fail();
  }
}
export function classificationChange(
  command: ClassificationCommand,
): RevisionChange {
  const c = captureClassification(command, command.base.workspace_id),
    before = c.base.content;
  let allocations = before.allocations;
  if (c.classification.kind === 'CLEAR') allocations = Object.freeze([]);
  if (c.classification.kind === 'SET') {
    const value = BigInt(before.account_amount_minor),
      absolute = value < 0n ? -value : value;
    if (absolute === 0n || absolute > 9223372036854775807n)
      fail('CLASSIFICATION_AMOUNT_UNSUPPORTED');
    allocations = Object.freeze([
      Object.freeze({
        id: c.classification.allocation_id,
        category_id: c.classification.category_id,
        subcategory_id: c.classification.subcategory_id,
        amount_minor: moneyMinor(absolute.toString()),
        note: before.allocations[0]?.note ?? null,
      }),
    ]);
  }
  return captureRevisionChange({
    id: c.base.id,
    base_revision: c.base.version,
    content: { ...before, allocations, tag_ids: c.tag_ids },
  });
}
export function validateClassificationPlan(
  command: ClassificationCommand,
  plan: RevisionPlan,
  raw: TaxonomyCatalog,
  w: string,
): void {
  const c = captureClassification(command, w),
    expected = classificationChange(c),
    before = plan.before;
  if (
    !before ||
    JSON.stringify(captureRevisionState(before)) !== JSON.stringify(c.base)
  )
    fail('CLASSIFICATION_BASE_CONFLICT');
  if (
    JSON.stringify(plan.after.content) !== JSON.stringify(expected.content) ||
    plan.after.id !== before.id ||
    plan.after.workspace_id !== w
  )
    fail();
  const catalog = captureTaxonomyCatalog(raw, w),
    original = before.content;
  for (const id of expected.content.tag_ids) {
    const tag = catalog.items.find((r) => r.kind === 'TAG' && r.id === id);
    if (!tag || (!original.tag_ids.includes(id) && tag.status !== 'ACTIVE'))
      fail('CLASSIFICATION_REFERENCE_UNAVAILABLE');
  }
  for (const a of expected.content.allocations) {
    const previous = original.allocations.find((r) => r.id === a.id),
      category = catalog.categories.find((r) => r.id === a.category_id);
    if (
      !category ||
      ((!previous || previous.category_id !== a.category_id) &&
        category.status !== 'ACTIVE')
    )
      fail('CLASSIFICATION_REFERENCE_UNAVAILABLE');
    const changed =
      !previous ||
      previous.category_id !== a.category_id ||
      previous.subcategory_id !== a.subcategory_id;
    if (changed) {
      if (category.status !== 'ACTIVE')
        fail('CLASSIFICATION_REFERENCE_UNAVAILABLE');
      const allowed =
        original.economic_kind === 'INCOME'
          ? 'INCOME'
          : ['EXPENSE', 'EXPENSE_REVERSAL'].includes(original.economic_kind)
            ? 'EXPENSE'
            : 'BOTH';
      if (
        category.category_scope !== 'BOTH' &&
        category.category_scope !== allowed
      )
        fail('CLASSIFICATION_SCOPE_MISMATCH');
    }
    if (a.subcategory_id !== null) {
      const sub = catalog.items.find(
        (r) =>
          r.kind === 'SUBCATEGORY' &&
          r.id === a.subcategory_id &&
          r.category_id === a.category_id,
      );
      if (!sub || (changed && sub.status !== 'ACTIVE'))
        fail('CLASSIFICATION_REFERENCE_UNAVAILABLE');
    }
  }
}
export interface ClassificationFilter {
  readonly category_id: string | null;
  readonly subcategory_id: string | null;
  readonly tag_ids: readonly string[];
  readonly tag_match: 'ANY' | 'ALL';
  readonly unclassified_only: boolean;
}
export function captureClassificationFilter(
  input: ClassificationFilter,
): ClassificationFilter {
  try {
    if (JSON.stringify(input).length > 4 * 1024 * 1024) fail();
    exact(input, [
      'category_id',
      'subcategory_id',
      'tag_ids',
      'tag_match',
      'unclassified_only',
    ]);
    if (input.category_id !== null) requireId(input.category_id);
    if (input.subcategory_id !== null) requireId(input.subcategory_id);
    if (
      !['ANY', 'ALL'].includes(input.tag_match) ||
      typeof input.unclassified_only !== 'boolean' ||
      (input.unclassified_only &&
        (input.category_id !== null || input.subcategory_id !== null))
    )
      fail();
    return Object.freeze({
      category_id: input.category_id,
      subcategory_id: input.subcategory_id,
      tag_ids: ids(input.tag_ids),
      tag_match: input.tag_match,
      unclassified_only: input.unclassified_only,
    });
  } catch {
    return fail();
  }
}
/** The host must supply an already authorized, consistent and complete bounded snapshot. */
export function filterClassifications(
  w: string,
  raw: readonly RevisionState[],
  input: ClassificationFilter,
): readonly RevisionState[] {
  const q = captureClassificationFilter(input);
  requireId(w);
  if (
    !Array.isArray(raw) ||
    raw.length > 10000 ||
    JSON.stringify(raw).length > 4 * 1024 * 1024
  )
    fail();
  const states = new Map<string, RevisionState>();
  for (const row of raw) {
    const r = captureRevisionState(row);
    if (r.workspace_id !== w) fail();
    const previous = states.get(r.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(r))
      fail('CLASSIFICATION_STATE_CONFLICT');
    states.set(r.id, r);
  }
  return Object.freeze(
    [...states.values()]
      .filter(
        (r) =>
          !r.content.deleted &&
          (!q.unclassified_only || r.content.allocations.length === 0) &&
          ((q.category_id === null && q.subcategory_id === null) ||
            r.content.allocations.some(
              (a) =>
                (q.category_id === null || a.category_id === q.category_id) &&
                (q.subcategory_id === null ||
                  a.subcategory_id === q.subcategory_id),
            )) &&
          (!q.tag_ids.length ||
            (q.tag_match === 'ANY'
              ? q.tag_ids.some((id) => r.content.tag_ids.includes(id))
              : q.tag_ids.every((id) => r.content.tag_ids.includes(id)))),
      )
      .sort(
        (a, b) =>
          b.content.financial_date.localeCompare(a.content.financial_date) ||
          b.id.localeCompare(a.id),
      ),
  );
}
