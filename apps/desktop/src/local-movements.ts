import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureManualMovement,
  manualMovementChange,
  ManualMovementError,
} from '@financial-manager/domain/manual-movements';
import type { ManualMovementCommand } from '@financial-manager/domain/manual-movements';
import {
  captureRevisionState,
  decodeRevisionSnapshot,
  revisionVersion,
  nextRevision,
} from '@financial-manager/domain/revisions';
import type {
  RevisionState,
  RevisionSnapshot,
} from '@financial-manager/domain/revisions';
import { utcInstant } from '@financial-manager/domain';
import type { Account } from '@financial-manager/domain';
import { decodeAccountsSnapshot } from './local-accounts.js';
import type { AccountsSnapshot } from './local-accounts.js';
const codes = [
  'INVALID_MANUAL_MOVEMENT',
  'MANUAL_MOVEMENT_READ_ONLY',
  'MANUAL_BASE_CONFLICT',
  'MANUAL_ACCOUNT_CHANGED',
  'MANUAL_ACCOUNT_ARCHIVED',
  'MOVEMENT_DELETED',
  'ALLOCATION_REVIEW_REQUIRED',
  'VERSION_CONFLICT',
  'VERSION_EXHAUSTED',
  'ORIGIN_IMMUTABLE',
  'COMPOSITE_REQUIRED',
  'INVALID_REVISION',
  'MOVEMENT_LIMIT',
  'LOCAL_LOCKED',
  'KEY_MISSING',
  'INSTALLATION_BUSY',
  'NOT_FOUND',
  'REQUEST_CONFLICT',
  'INTEGRITY_FAILURE',
  'STORAGE_UNAVAILABLE',
  'UNSUPPORTED_SCHEMA',
  'INVALID_RESPONSE',
];
export class LocalMovementError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('LOCAL_MOVEMENT_OPERATION_FAILED');
    this.code = codes.includes(code) ? code : 'STORAGE_UNAVAILABLE';
  }
}
export interface MovementHistory {
  readonly id: string;
  readonly transaction_id: string;
  readonly version: string;
  readonly created_at: string;
  readonly change_source: string;
  readonly compatible: boolean;
  readonly snapshot: RevisionSnapshot | null;
}
export interface MovementsSnapshot {
  readonly balance: AccountsSnapshot;
  readonly transactions: readonly RevisionState[];
  readonly history: readonly MovementHistory[];
}
export interface MovementResult {
  readonly changed: boolean;
  readonly id: string;
  readonly base_revision: string;
  readonly version: string;
  readonly revision_id: string | null;
}
function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  )
    throw new LocalMovementError('INVALID_RESPONSE');
}
function stateIds(s: RevisionState) {
  resourceId(s.workspace_id);
  resourceId(s.id);
  resourceId(s.content.account_id);
  for (const v of [s.content.group_id, s.content.counterparty_id])
    if (v !== null) resourceId(v);
  for (const a of s.content.allocations) {
    resourceId(a.id);
    resourceId(a.category_id);
    if (a.subcategory_id !== null) resourceId(a.subcategory_id);
  }
  for (const id of s.content.tag_ids) resourceId(id);
}
export function movementAccount(a: Account): Account {
  return Object.freeze({
    id: a.id,
    workspace_id: a.workspace_id,
    currency_code: a.currency_code,
    account_kind: a.account_kind,
    balance_nature: a.balance_nature,
    status: a.status,
  });
}
export function captureLocalManualMovement(
  input: ManualMovementCommand,
  workspace: string,
) {
  try {
    resourceId(workspace);
    const captured = captureManualMovement(input, workspace);
    if ('id' in captured) uuidV7(captured.id);
    if ('base' in captured) stateIds(captured.base);
    if ('account' in captured) resourceId(captured.account.id);
    manualMovementChange(captured);
    return captured;
  } catch (error) {
    throw new LocalMovementError(
      error instanceof ManualMovementError
        ? error.code
        : 'INVALID_MANUAL_MOVEMENT',
    );
  }
}
export function decodeMovementsSnapshot(
  value: unknown,
  workspace: string,
): MovementsSnapshot {
  try {
    exact(value, ['balance', 'transactions', 'history']);
    if (!Array.isArray(value.transactions) || !Array.isArray(value.history))
      throw Error();
    const balance = decodeAccountsSnapshot(value.balance, workspace),
      accounts = new Set(balance.accounts.map((a) => a.account.id)),
      ids = new Map<string, RevisionState>();
    const transactions = value.transactions.map((raw) => {
      const s = captureRevisionState(raw);
      stateIds(s);
      if (
        s.workspace_id !== workspace ||
        !accounts.has(s.content.account_id) ||
        ids.has(s.id)
      )
        throw Error();
      ids.set(s.id, s);
      return s;
    });
    const actual = new Map(balance.movements.map((m) => [m.id, m]));
    let active = 0;
    for (const s of transactions)
      if (!s.content.deleted) {
        active++;
        const m = actual.get(s.id);
        if (
          !m ||
          m.account_id !== s.content.account_id ||
          m.group_id !== s.content.group_id ||
          m.financial_date !== s.content.financial_date ||
          m.account_amount_minor !== s.content.account_amount_minor ||
          m.economic_kind !== s.content.economic_kind
        )
          throw Error();
      }
    if (active !== actual.size) throw Error();
    const seen = new Set<string>(),
      versions = new Set<string>();
    const history = value.history.map((raw) => {
      exact(raw, [
        'id',
        'transaction_id',
        'version',
        'created_at',
        'change_source',
        'compatible',
        'snapshot',
      ]);
      const id = resourceId(raw.id),
        transaction = resourceId(raw.transaction_id),
        version = revisionVersion(raw.version),
        current = ids.get(transaction);
      utcInstant(raw.created_at);
      if (
        !current ||
        BigInt(version) > BigInt(current.version) ||
        seen.has(id) ||
        versions.has(transaction + '/' + version) ||
        typeof raw.compatible !== 'boolean' ||
        ![
          'MANUAL',
          'IMPORT',
          'SYNC_RESOLUTION',
          'REVERSAL',
          'MIGRATION',
          'SYSTEM',
        ].includes(String(raw.change_source))
      )
        throw Error();
      seen.add(id);
      versions.add(transaction + '/' + version);
      let snapshot: RevisionSnapshot | null = null;
      if (raw.compatible) {
        snapshot = decodeRevisionSnapshot(raw.snapshot);
        stateIds(snapshot.after);
        if (snapshot.before) stateIds(snapshot.before);
        if (
          snapshot.after.id !== transaction ||
          snapshot.after.workspace_id !== workspace ||
          snapshot.after.version !== version
        )
          throw Error();
      } else if (raw.snapshot !== null) throw Error();
      return Object.freeze({
        id,
        transaction_id: transaction,
        version,
        created_at: raw.created_at as string,
        change_source: raw.change_source as string,
        compatible: raw.compatible,
        snapshot,
      });
    });
    const count =
      balance.accounts.reduce((n, a) => n + 1 + a.references.length, 0) +
      transactions.reduce(
        (n, s) =>
          n + 1 + s.content.allocations.length + s.content.tag_ids.length,
        0,
      ) +
      history.length;
    if (
      count > 200000 ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
        32 * 1024 * 1024
    )
      throw Error();
    return Object.freeze({
      balance,
      transactions: Object.freeze(transactions),
      history: Object.freeze(history),
    });
  } catch {
    throw new LocalMovementError('INVALID_RESPONSE');
  }
}
export function decodeMovementResult(
  value: unknown,
  command: ManualMovementCommand,
): MovementResult {
  try {
    exact(value, ['changed', 'id', 'base_revision', 'version', 'revision_id']);
    const id = 'id' in command ? command.id : command.base.id,
      base = 'base' in command ? command.base.version : '0';
    if (
      typeof value.changed !== 'boolean' ||
      value.id !== id ||
      value.base_revision !== base ||
      value.version !== (value.changed ? nextRevision(base) : base)
    )
      throw Error();
    if (value.changed) uuidV7(value.revision_id);
    else if (value.revision_id !== null) throw Error();
    return Object.freeze({
      changed: value.changed,
      id,
      base_revision: base,
      version: value.version as string,
      revision_id: value.revision_id as string | null,
    });
  } catch {
    throw new LocalMovementError('INVALID_RESPONSE');
  }
}
export function createLocalMovementsGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (error) {
      throw new LocalMovementError(
        typeof error === 'string' ? error : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async read(workspace: string) {
      return decodeMovementsSnapshot(
        await call('read_local_movements', {
          workspaceId: resourceId(workspace),
        }),
        workspace,
      );
    },
    async apply(workspace: string, command: ManualMovementCommand) {
      const input = captureLocalManualMovement(command, workspace);
      return decodeMovementResult(
        await call('apply_local_manual_movement', {
          workspaceId: workspace,
          input,
        }),
        input,
      );
    },
  });
}
export function localMovementMessage(error: unknown) {
  const code = error instanceof LocalMovementError ? error.code : '';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo foi bloqueado. Desbloqueie para consultar os dados.';
  if (['VERSION_CONFLICT', 'MANUAL_BASE_CONFLICT'].includes(code))
    return 'A base mudou ou esta tentativa já foi registrada. Consulte o resultado e revise antes de tentar outra alteração.';
  if (['MANUAL_ACCOUNT_CHANGED', 'MANUAL_ACCOUNT_ARCHIVED'].includes(code))
    return 'A conta mudou ou está arquivada. Atualize os dados e confira a conta antes de continuar.';
  if (code === 'ALLOCATION_REVIEW_REQUIRED')
    return 'Esta mudança exige revisar a classificação ou o rateio. Os valores atuais foram preservados.';
  if (code === 'MANUAL_MOVEMENT_READ_ONLY' || code === 'COMPOSITE_REQUIRED')
    return 'Este registro pertence a outra origem ou operação agrupada e não pode ser reescrito pelo editor manual.';
  if (code === 'MOVEMENT_DELETED')
    return 'Restaure o registro antes de editá-lo.';
  if (code === 'MOVEMENT_LIMIT')
    return 'Os dados excedem o limite desta consulta. Nenhum resultado parcial foi apresentado.';
  if (code === 'INVALID_MANUAL_MOVEMENT')
    return 'Confira conta, data, nome e valor. Use um valor positivo para entrada ou gasto; ajustes exigem variação não nula e motivo.';
  if (code === 'KEY_MISSING')
    return 'A chave deste espaço não está disponível. Nenhum dado foi substituído.';
  return 'Não foi possível concluir a operação. A tentativa pode já ter sido registrada; consulte o resultado antes de iniciar outra.';
}
export function editableMinor(value: string) {
  const negative = value.startsWith('-'),
    digits = negative ? value.slice(1) : value;
  return (
    (negative ? '-' : '') +
    (digits.length > 2 ? digits.slice(0, -2) : '0') +
    ',' +
    digits.slice(-2).padStart(2, '0')
  );
}
export function canEditMovement(state: RevisionState) {
  return (
    state.content.origin_kind === 'MANUAL' &&
    state.content.group_id === null &&
    ['INCOME', 'EXPENSE'].includes(state.content.economic_kind) &&
    !state.content.deleted
  );
}
export function canToggleMovement(state: RevisionState) {
  return (
    state.content.origin_kind === 'MANUAL' &&
    state.content.group_id === null &&
    ['INCOME', 'EXPENSE', 'ADJUSTMENT'].includes(state.content.economic_kind)
  );
}
export const movementKindLabel = (kind: string) =>
  ({
    INCOME: 'Entrada',
    EXPENSE: 'Gasto',
    ADJUSTMENT: 'Ajuste de saldo',
    TRANSFER: 'Transferência',
    DEBT_SETTLEMENT: 'Liquidação de dívida',
    EXPENSE_REVERSAL: 'Estorno de gasto',
    OTHER: 'Outro',
  })[kind] ?? 'Outro';
