import { requireId } from './model.js';

export interface Counterparty {
  readonly id: string;
  readonly workspace_id: string;
  readonly display_name: string;
  readonly identifier_type: 'CPF' | 'CNPJ' | 'OTHER' | null;
  readonly identifier_value: string | null;
  readonly relationship_hint: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}
const codes = [
  'INVALID_COUNTERPARTY_CHANGE',
  'INVALID_COUNTERPARTY_STATE',
  'COUNTERPARTY_BASE_CONFLICT',
  'COUNTERPARTY_NOT_FOUND',
  'COUNTERPARTY_LIMIT',
  'ACCESS_DENIED',
  'CONFIGURATION_INVALID',
  'DATA_ACCESS_FAILED',
  'CLOSED',
  'NESTED_UNIT',
] as const;
export type CounterpartyCode = (typeof codes)[number];
export class CounterpartyError extends Error {
  readonly code: CounterpartyCode;
  constructor(code: CounterpartyCode) {
    const safe = codes.includes(code) ? code : 'DATA_ACCESS_FAILED';
    super(safe);
    this.name = 'CounterpartyError';
    this.code = safe;
  }
}
function fail(code: CounterpartyCode = 'INVALID_COUNTERPARTY_CHANGE'): never {
  throw new CounterpartyError(code);
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
function text(v: unknown, max: number): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v !== v.trim() ||
    v.length > max ||
    /\p{Cc}/u.test(v)
  )
    fail();
  return v;
}
const fields = [
  'id',
  'workspace_id',
  'display_name',
  'identifier_type',
  'identifier_value',
  'relationship_hint',
  'status',
];
export function captureCounterparty(raw: unknown, w: string): Counterparty {
  try {
    exact(raw, fields);
    requireId(w);
    requireId(raw.id);
    requireId(raw.workspace_id);
    if (
      raw.workspace_id !== w ||
      ![null, 'CPF', 'CNPJ', 'OTHER'].includes(
        raw.identifier_type as string | null,
      ) ||
      ![null, 'CUSTOMER', 'SUPPLIER', 'OTHER'].includes(
        raw.relationship_hint as string | null,
      ) ||
      !['ACTIVE', 'ARCHIVED'].includes(raw.status as string)
    )
      fail();
    text(raw.display_name, 120);
    if ((raw.identifier_type === null) !== (raw.identifier_value === null))
      fail();
    if (raw.identifier_value !== null) {
      const value = text(raw.identifier_value, 120);
      if (raw.identifier_type === 'CPF' && !/^\d{11}$/.test(value)) fail();
      if (raw.identifier_type === 'CNPJ' && !/^\d{14}$/.test(value)) fail();
    }
    return Object.freeze({ ...raw }) as unknown as Counterparty;
  } catch {
    return fail('INVALID_COUNTERPARTY_STATE');
  }
}
export function captureCounterparties(
  raw: readonly Counterparty[],
  w: string,
): readonly Counterparty[] {
  if (!Array.isArray(raw)) fail('INVALID_COUNTERPARTY_STATE');
  if (raw.length > 10000 || JSON.stringify(raw).length > 4 * 1024 * 1024)
    fail('COUNTERPARTY_LIMIT');
  const rows = Array.from(raw, (r) => captureCounterparty(r, w));
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    fail('INVALID_COUNTERPARTY_STATE');
  return Object.freeze(
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}
export type CounterpartyCommand =
  | Readonly<{ kind: 'CREATE'; item: Counterparty }>
  | Readonly<{ kind: 'UPDATE'; base: Counterparty; item: Counterparty }>;
export interface CounterpartyPlan {
  readonly before: Counterparty | null;
  readonly after: Counterparty;
}
export function captureCounterpartyCommand(
  raw: CounterpartyCommand,
  w: string,
): CounterpartyCommand {
  try {
    if (!raw || !['CREATE', 'UPDATE'].includes(raw.kind)) fail();
    exact(
      raw,
      raw.kind === 'CREATE' ? ['kind', 'item'] : ['kind', 'base', 'item'],
    );
    const item = captureCounterparty(raw.item, w);
    if (raw.kind === 'CREATE') {
      if (item.status !== 'ACTIVE') fail();
      return Object.freeze({ kind: 'CREATE', item });
    }
    const base = captureCounterparty(raw.base, w);
    if (base.id !== item.id) fail();
    return Object.freeze({ kind: 'UPDATE', base, item });
  } catch {
    return fail();
  }
}
function same(a: Counterparty, b: Counterparty) {
  return fields.every(
    (k) => a[k as keyof Counterparty] === b[k as keyof Counterparty],
  );
}
export function planCounterparty(
  w: string,
  rows: readonly Counterparty[],
  command: CounterpartyCommand,
): CounterpartyPlan | null {
  const catalog = captureCounterparties(rows, w),
    c = captureCounterpartyCommand(command, w),
    before = catalog.find((r) => r.id === c.item.id) ?? null;
  if (c.kind === 'CREATE') {
    if (before) {
      if (same(before, c.item)) return null;
      fail('COUNTERPARTY_BASE_CONFLICT');
    }
    if (catalog.length >= 10000) fail('COUNTERPARTY_LIMIT');
  } else {
    if (!before) fail('COUNTERPARTY_NOT_FOUND');
    if (!same(before, c.base)) fail('COUNTERPARTY_BASE_CONFLICT');
    if (same(before, c.item)) return null;
  }
  return Object.freeze({ before, after: c.item });
}
export interface CounterpartyQuery {
  readonly status: 'ALL' | 'ACTIVE' | 'ARCHIVED';
  readonly relationship_hint: Counterparty['relationship_hint'] | 'ALL';
  readonly search: string;
}
export function counterpartySearchKey(v: string): string {
  return v
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ');
}
export function captureCounterpartyQuery(
  raw: CounterpartyQuery,
): CounterpartyQuery {
  exact(raw, ['status', 'relationship_hint', 'search']);
  if (
    !['ALL', 'ACTIVE', 'ARCHIVED'].includes(raw.status) ||
    ![null, 'ALL', 'CUSTOMER', 'SUPPLIER', 'OTHER'].includes(
      raw.relationship_hint,
    ) ||
    typeof raw.search !== 'string' ||
    raw.search.length > 120 ||
    /\p{Cc}/u.test(raw.search)
  )
    fail();
  return Object.freeze({
    status: raw.status,
    relationship_hint: raw.relationship_hint,
    search: raw.search,
  });
}
export function filterCounterparties(
  w: string,
  rows: readonly Counterparty[],
  query: CounterpartyQuery,
): readonly Counterparty[] {
  const catalog = captureCounterparties(rows, w),
    q = captureCounterpartyQuery(query),
    key = counterpartySearchKey(q.search);
  return Object.freeze(
    catalog.filter(
      (r) =>
        (q.status === 'ALL' || r.status === q.status) &&
        (q.relationship_hint === 'ALL' ||
          r.relationship_hint === q.relationship_hint) &&
        (!key ||
          counterpartySearchKey(r.display_name).includes(key) ||
          counterpartySearchKey(r.identifier_value ?? '').includes(key)),
    ),
  );
}
