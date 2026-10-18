import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureTransfer,
  transferChanges,
} from '@financial-manager/domain/transfers';
import type {
  TransferCommand,
  TransferBase,
} from '@financial-manager/domain/transfers';
import type { RevisionState } from '@financial-manager/domain/revisions';
import {
  revisionVersion,
  nextRevision,
} from '@financial-manager/domain/revisions';
import {
  decodeMovementsSnapshot,
  LocalMovementError,
  localMovementMessage,
} from './local-movements.js';
import type { MovementsSnapshot, MovementResult } from './local-movements.js';
const codes = [
  'INVALID_TRANSFER',
  'TRANSFER_READ_ONLY',
  'TRANSFER_BASE_CONFLICT',
  'TRANSFER_ACCOUNT_CHANGED',
  'TRANSFER_ACCOUNT_ARCHIVED',
  'TRANSFER_DELETED',
];
export class LocalTransferError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('LOCAL_TRANSFER_OPERATION_FAILED');
    this.code = codes.includes(code) ? code : new LocalMovementError(code).code;
  }
}
export interface TransferGroup {
  readonly id: string;
  readonly workspace_id: string;
  readonly group_type: 'TRANSFER' | 'CARD_PAYMENT' | 'OTHER_COMPOSITE';
  readonly state: 'ACTIVE' | 'BROKEN' | 'VOIDED';
  readonly member_ids: readonly string[];
}
export interface TransfersSnapshot {
  readonly movements: MovementsSnapshot;
  readonly groups: readonly TransferGroup[];
}
export interface TransferResult {
  readonly group_id: string;
  readonly entries: readonly MovementResult[];
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
    throw new LocalTransferError('INVALID_RESPONSE');
}
function stateIds(s: RevisionState) {
  for (const v of [s.id, s.workspace_id, s.content.account_id]) resourceId(v);
  for (const v of [s.content.group_id, s.content.counterparty_id])
    if (v !== null) resourceId(v);
  for (const a of s.content.allocations) {
    resourceId(a.id);
    resourceId(a.category_id);
    if (a.subcategory_id !== null) resourceId(a.subcategory_id);
  }
  s.content.tag_ids.forEach(resourceId);
}
export function captureLocalTransfer(input: TransferCommand, w: string) {
  try {
    resourceId(w);
    const c = captureTransfer(input, w);
    if (c.kind === 'CREATE') {
      uuidV7(c.id);
      uuidV7(c.source_entry_id);
      uuidV7(c.target_entry_id);
    } else {
      resourceId(c.base.group_id);
      stateIds(c.base.source);
      stateIds(c.base.target);
    }
    if (c.kind === 'CREATE' || c.kind === 'EDIT') {
      resourceId(c.source_account.id);
      resourceId(c.target_account.id);
    }
    transferChanges(c);
    return c;
  } catch (e) {
    throw new LocalTransferError(
      e &&
        typeof e === 'object' &&
        'code' in e &&
        [...codes, 'ALLOCATION_REVIEW_REQUIRED'].includes(String(e.code))
        ? String(e.code)
        : 'INVALID_TRANSFER',
    );
  }
}
export function decodeTransfersSnapshot(
  raw: unknown,
  w: string,
): TransfersSnapshot {
  try {
    exact(raw, ['movements', 'groups']);
    const movements = decodeMovementsSnapshot(raw.movements, w);
    if (!Array.isArray(raw.groups)) throw Error();
    const actual = new Map<string, string[]>();
    for (const s of movements.transactions)
      if (s.content.group_id) {
        const ids = actual.get(s.content.group_id) ?? [];
        ids.push(s.id);
        actual.set(s.content.group_id, ids);
      }
    const seen = new Set<string>();
    const groups = raw.groups.map((g) => {
      exact(g, ['id', 'workspace_id', 'group_type', 'state', 'member_ids']);
      const id = resourceId(g.id);
      if (
        seen.has(id) ||
        g.workspace_id !== w ||
        !['TRANSFER', 'CARD_PAYMENT', 'OTHER_COMPOSITE'].includes(
          String(g.group_type),
        ) ||
        !['ACTIVE', 'BROKEN', 'VOIDED'].includes(String(g.state)) ||
        !Array.isArray(g.member_ids)
      )
        throw Error();
      seen.add(id);
      const ids = g.member_ids.map(resourceId).sort();
      if (
        new Set(ids).size !== ids.length ||
        JSON.stringify(ids) !== JSON.stringify((actual.get(id) ?? []).sort())
      )
        throw Error();
      return Object.freeze({
        id,
        workspace_id: w,
        group_type: g.group_type as TransferGroup['group_type'],
        state: g.state as TransferGroup['state'],
        member_ids: Object.freeze(ids),
      });
    });
    if ([...actual.keys()].some((id) => !seen.has(id))) throw Error();
    const count =
      groups.length +
      movements.balance.accounts.reduce(
        (n, a) => n + 1 + a.references.length,
        0,
      ) +
      movements.transactions.reduce(
        (n, s) =>
          n + 1 + s.content.allocations.length + s.content.tag_ids.length,
        0,
      ) +
      movements.history.length;
    if (
      count > 200000 ||
      new TextEncoder().encode(JSON.stringify(raw)).byteLength >
        32 * 1024 * 1024
    )
      throw Error();
    return Object.freeze({ movements, groups: Object.freeze(groups) });
  } catch {
    throw new LocalTransferError('INVALID_RESPONSE');
  }
}
export function decodeTransferResult(
  raw: unknown,
  c: TransferCommand,
): TransferResult {
  try {
    exact(raw, ['group_id', 'entries']);
    const group = c.kind === 'CREATE' ? c.id : c.base.group_id,
      expected =
        c.kind === 'CREATE'
          ? new Map([
              [c.source_entry_id, '0'],
              [c.target_entry_id, '0'],
            ])
          : new Map([
              [c.base.source.id, c.base.source.version],
              [c.base.target.id, c.base.target.version],
            ]);
    if (
      raw.group_id !== group ||
      !Array.isArray(raw.entries) ||
      raw.entries.length !== 2
    )
      throw Error();
    const entries = raw.entries.map((r) => {
      exact(r, ['id', 'base_revision', 'version', 'changed', 'revision_id']);
      const id = resourceId(r.id),
        base = expected.get(id);
      if (
        base === undefined ||
        r.base_revision !== base ||
        typeof r.changed !== 'boolean' ||
        r.version !== (r.changed ? nextRevision(base) : base)
      )
        throw Error();
      revisionVersion(r.version);
      if (r.changed) uuidV7(r.revision_id);
      else if (r.revision_id !== null) throw Error();
      expected.delete(id);
      return Object.freeze({
        id,
        base_revision: base,
        version: r.version as string,
        changed: r.changed,
        revision_id: r.revision_id as string | null,
      });
    });
    if (expected.size) throw Error();
    return Object.freeze({ group_id: group, entries: Object.freeze(entries) });
  } catch {
    throw new LocalTransferError('INVALID_RESPONSE');
  }
}
export function transferBase(
  snapshot: TransfersSnapshot,
  groupId: string,
): TransferBase | null {
  try {
    const g = snapshot.groups.find((g) => g.id === groupId);
    if (
      !g ||
      g.group_type !== 'TRANSFER' ||
      g.state !== 'ACTIVE' ||
      g.member_ids.length !== 2
    )
      return null;
    const pair = g.member_ids.map((id) =>
      snapshot.movements.transactions.find((s) => s.id === id)!,
    );
    const source = pair.find(
        (s) => BigInt(s.content.account_amount_minor) < 0n,
      ),
      target = pair.find((s) => BigInt(s.content.account_amount_minor) > 0n);
    if (!source || !target) return null;
    const c = captureLocalTransfer(
      { kind: 'DELETE', base: { group_id: groupId, source, target } },
      snapshot.movements.balance.workspace_id,
    );
    return c.kind === 'DELETE' ? c.base : null;
  } catch {
    return null;
  }
}
export function createLocalTransfersGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (e) {
      throw new LocalTransferError(
        typeof e === 'string' ? e : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async read(w: string) {
      return decodeTransfersSnapshot(
        await call('read_local_transfers', { workspaceId: resourceId(w) }),
        w,
      );
    },
    async apply(w: string, input: TransferCommand) {
      const c = captureLocalTransfer(input, w);
      return decodeTransferResult(
        await call('apply_local_transfer', { workspaceId: w, input: c }),
        c,
      );
    },
  });
}
export function localTransferMessage(e: unknown) {
  const code = e instanceof LocalTransferError ? e.code : '';
  if (code === 'INVALID_TRANSFER')
    return 'Confira duas contas de ativo distintas, data, nome e valor positivo em BRL.';
  if (code === 'TRANSFER_READ_ONLY')
    return 'Esta operação não é uma transferência manual compatível. Seus dados foram preservados.';
  if (code === 'TRANSFER_BASE_CONFLICT')
    return 'A base mudou ou esta tentativa já foi registrada. Consulte o resultado e revise antes de tentar outra alteração.';
  if (
    code === 'TRANSFER_ACCOUNT_CHANGED' ||
    code === 'TRANSFER_ACCOUNT_ARCHIVED'
  )
    return 'Uma das contas mudou ou está arquivada. Atualize os dados antes de continuar.';
  if (code === 'TRANSFER_DELETED')
    return 'Restaure os dois lados antes de editar a transferência.';
  return localMovementMessage(new LocalMovementError(code));
}
