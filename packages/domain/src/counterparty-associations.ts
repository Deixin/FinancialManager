import { requireId } from './model.js';
import { captureRevisionState, captureRevisionChange } from './revisions.js';
import type {
  RevisionState,
  RevisionChange,
  RevisionPlan,
} from './revisions.js';

export interface CounterpartyReference {
  readonly id: string;
  readonly workspace_id: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}
const codes = [
  'INVALID_COUNTERPARTY_ASSOCIATION',
  'COUNTERPARTY_ASSOCIATION_BASE_CONFLICT',
  'COUNTERPARTY_REFERENCE_UNAVAILABLE',
  'COUNTERPARTY_ASSOCIATION_DELETED',
] as const;
export type CounterpartyAssociationCode = (typeof codes)[number];
export class CounterpartyAssociationError extends Error {
  readonly code: CounterpartyAssociationCode;
  constructor(code: CounterpartyAssociationCode) {
    const safe = codes.includes(code)
      ? code
      : 'INVALID_COUNTERPARTY_ASSOCIATION';
    super(safe);
    this.name = 'CounterpartyAssociationError';
    this.code = safe;
  }
}
function fail(
  code: CounterpartyAssociationCode = 'INVALID_COUNTERPARTY_ASSOCIATION',
): never {
  throw new CounterpartyAssociationError(code);
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
export function captureCounterpartyReference(
  raw: unknown,
  w: string,
): CounterpartyReference {
  try {
    exact(raw, ['id', 'workspace_id', 'status']);
    requireId(w);
    requireId(raw.id);
    requireId(raw.workspace_id);
    if (
      raw.workspace_id !== w ||
      (raw.status !== 'ACTIVE' && raw.status !== 'ARCHIVED')
    )
      fail();
    return Object.freeze({
      id: raw.id,
      workspace_id: raw.workspace_id,
      status: raw.status,
    });
  } catch {
    return fail('COUNTERPARTY_REFERENCE_UNAVAILABLE');
  }
}
export type CounterpartySelection =
  | Readonly<{ kind: 'KEEP' }>
  | Readonly<{ kind: 'CLEAR' }>
  | Readonly<{ kind: 'SET'; counterparty_id: string }>;
export interface CounterpartyAssociationCommand {
  readonly base: RevisionState;
  readonly counterparty: CounterpartySelection;
}
export function captureCounterpartyAssociation(
  raw: CounterpartyAssociationCommand,
  w: string,
): CounterpartyAssociationCommand {
  try {
    exact(raw, ['base', 'counterparty']);
    requireId(w);
    if (JSON.stringify(raw).length > 4 * 1024 * 1024) fail();
    const base = captureRevisionState(raw.base),
      c = raw.counterparty;
    if (base.workspace_id !== w) fail();
    if (base.content.deleted) fail('COUNTERPARTY_ASSOCIATION_DELETED');
    let counterparty: CounterpartySelection;
    if (c?.kind === 'KEEP' || c?.kind === 'CLEAR') {
      exact(c, ['kind']);
      counterparty = Object.freeze({ kind: c.kind });
    } else if (c?.kind === 'SET') {
      exact(c, ['kind', 'counterparty_id']);
      requireId(c.counterparty_id);
      counterparty = Object.freeze({
        kind: 'SET',
        counterparty_id: c.counterparty_id,
      });
    } else return fail();
    return Object.freeze({ base, counterparty });
  } catch (e) {
    if (e instanceof CounterpartyAssociationError) throw e;
    return fail();
  }
}
export function counterpartyAssociationChange(
  raw: CounterpartyAssociationCommand,
): RevisionChange {
  const c = captureCounterpartyAssociation(raw, raw.base.workspace_id);
  return captureRevisionChange({
    id: c.base.id,
    base_revision: c.base.version,
    content: {
      ...c.base.content,
      counterparty_id:
        c.counterparty.kind === 'KEEP'
          ? c.base.content.counterparty_id
          : c.counterparty.kind === 'CLEAR'
            ? null
            : c.counterparty.counterparty_id,
    },
  });
}
export function validateCounterpartyAssociationPlan(
  raw: CounterpartyAssociationCommand,
  plan: RevisionPlan,
  references: readonly CounterpartyReference[],
  w: string,
): void {
  const c = captureCounterpartyAssociation(raw, w),
    expected = counterpartyAssociationChange(c),
    before = plan.before;
  if (
    !before ||
    JSON.stringify(captureRevisionState(before)) !== JSON.stringify(c.base)
  )
    fail('COUNTERPARTY_ASSOCIATION_BASE_CONFLICT');
  if (
    plan.after.id !== before.id ||
    plan.after.workspace_id !== w ||
    JSON.stringify(plan.after.content) !== JSON.stringify(expected.content)
  )
    fail();
  if (!Array.isArray(references) || references.length > 256)
    fail('COUNTERPARTY_REFERENCE_UNAVAILABLE');
  const catalog = Array.from(references, (r) =>
    captureCounterpartyReference(r, w),
  );
  if (new Set(catalog.map((r) => r.id)).size !== catalog.length)
    fail('COUNTERPARTY_REFERENCE_UNAVAILABLE');
  const id = expected.content.counterparty_id;
  if (id !== null) {
    const reference = catalog.find((r) => r.id === id);
    if (
      !reference ||
      (before.content.counterparty_id !== id && reference.status !== 'ACTIVE')
    )
      fail('COUNTERPARTY_REFERENCE_UNAVAILABLE');
  }
}
