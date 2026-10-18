import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureCounterpartyCommand,
  captureCounterparties,
  planCounterparty,
  captureCounterpartyAssociation,
  counterpartyAssociationChange,
  validateCounterpartyAssociationPlan,
  CounterpartyError,
  CounterpartyAssociationError,
} from '@financial-manager/domain/counterparties';
import type {
  Counterparty,
  CounterpartyCommand,
  CounterpartyAssociationCommand,
  CounterpartySelection,
} from '@financial-manager/domain/counterparties';
import { utcInstant } from '@financial-manager/domain';
import { planTransactionRevision } from '@financial-manager/domain/revisions';
import {
  LocalMovementError,
  decodeMovementsSnapshot,
} from './local-movements.js';
import type { MovementsSnapshot, MovementResult } from './local-movements.js';
export interface CounterpartySnapshot {
  readonly workspace_id: string;
  readonly items: readonly Counterparty[];
  readonly movements?: MovementsSnapshot;
}
function exact(
  raw: unknown,
  keys: readonly string[],
): asserts raw is Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== [...keys].sort().join(',')
  )
    throw Error();
}
function items(raw: readonly Counterparty[], w: string) {
  return Object.freeze(
    captureCounterparties(raw, w).map((r) => {
      resourceId(r.id);
      return Object.freeze({
        id: r.id,
        workspace_id: r.workspace_id,
        display_name: r.display_name,
        identifier_type: r.identifier_type,
        identifier_value: r.identifier_value,
        relationship_hint: r.relationship_hint,
        status: r.status,
      });
    }),
  );
}
export function decodeCounterpartySnapshot(
  raw: unknown,
  w: string,
  includeMovements = false,
): CounterpartySnapshot {
  try {
    resourceId(w);
    exact(
      raw,
      includeMovements
        ? ['workspace_id', 'items', 'movements']
        : ['workspace_id', 'items'],
    );
    if (raw.workspace_id !== w) throw Error();
    const catalog = items(raw.items as Counterparty[], w);
    if (!includeMovements)
      return Object.freeze({ workspace_id: w, items: catalog });
    const movements = decodeMovementsSnapshot(raw.movements, w);
    if (
      movements.transactions.length > 10000 ||
      movements.transactions.some(
        (r) =>
          r.content.counterparty_id !== null &&
          !catalog.some((c) => c.id === r.content.counterparty_id),
      )
    )
      throw Error();
    return Object.freeze({ workspace_id: w, items: catalog, movements });
  } catch {
    throw new LocalMovementError('INVALID_RESPONSE');
  }
}
export function captureLocalCounterparty(
  input: CounterpartyCommand,
  w: string,
) {
  try {
    resourceId(w);
    const c = captureCounterpartyCommand(input, w);
    resourceId(c.item.id);
    if (c.kind === 'CREATE') uuidV7(c.item.id);
    if (
      new TextEncoder().encode(JSON.stringify(c)).byteLength >
      4 * 1024 * 1024
    )
      throw Error();
    return c;
  } catch {
    throw new LocalMovementError('INVALID_COUNTERPARTY_CHANGE');
  }
}
export function decodeCounterpartyResult(
  raw: unknown,
  c: CounterpartyCommand,
  base: CounterpartySnapshot,
) {
  try {
    exact(raw, ['changed', 'items']);
    if (typeof raw.changed !== 'boolean') throw Error();
    const next = items(raw.items as Counterparty[], base.workspace_id),
      p = planCounterparty(base.workspace_id, base.items, c);
    const expected = items(
      p
        ? base.items.filter((r) => r.id !== p.after.id).concat(p.after)
        : base.items,
      base.workspace_id,
    );
    // An exact CREATE replay may return unchanged after a lost acknowledgement.
    if (
      JSON.stringify(next) !== JSON.stringify(expected) ||
      (raw.changed && !p) ||
      (!raw.changed && p && c.kind !== 'CREATE')
    )
      throw Error();
    return Object.freeze({ changed: raw.changed, items: next });
  } catch {
    throw new LocalMovementError('INVALID_RESPONSE');
  }
}
export function captureLocalAssociations(
  input: readonly CounterpartyAssociationCommand[],
  w: string,
) {
  try {
    resourceId(w);
    if (
      !Array.isArray(input) ||
      !input.length ||
      input.length > 256 ||
      JSON.stringify(input).length > 4 * 1024 * 1024 ||
      new TextEncoder().encode(JSON.stringify(input)).byteLength >
        4 * 1024 * 1024
    )
      throw Error();
    const commands = Array.from(input, (c) =>
      captureCounterpartyAssociation(c, w),
    ).sort((a, b) => a.base.id.localeCompare(b.base.id));
    if (new Set(commands.map((c) => c.base.id)).size !== commands.length)
      throw Error();
    for (const c of commands) {
      resourceId(c.base.id);
      resourceId(c.base.content.account_id);
      for (const id of [
        c.base.content.group_id,
        c.base.content.counterparty_id,
        c.counterparty.kind === 'SET' ? c.counterparty.counterparty_id : null,
      ])
        if (id !== null) resourceId(id);
      for (const a of c.base.content.allocations) {
        resourceId(a.id);
        resourceId(a.category_id);
        if (a.subcategory_id !== null) resourceId(a.subcategory_id);
      }
      for (const id of c.base.content.tag_ids) resourceId(id);
    }
    return Object.freeze(commands);
  } catch (e) {
    throw new LocalMovementError(
      e instanceof CounterpartyAssociationError
        ? e.code
        : 'INVALID_COUNTERPARTY_ASSOCIATION',
    );
  }
}
export function associationEdit(
  snapshot: CounterpartySnapshot,
  id: string,
  counterparty: CounterpartySelection,
) {
  const base = snapshot.movements?.transactions.find((r) => r.id === id);
  if (!base) throw new LocalMovementError('NOT_FOUND');
  const commands: CounterpartyAssociationCommand[] = [{ base, counterparty }];
  if (base.content.group_id) {
    const group = snapshot.movements!.transactions.filter(
      (r) => r.content.group_id === base.content.group_id,
    );
    if (group.length !== 2 || group.some((r) => r.content.deleted))
      throw new LocalMovementError('COMPOSITE_REQUIRED');
    commands.push(
      ...group
        .filter((r) => r.id !== id)
        .map((base) => ({ base, counterparty: { kind: 'KEEP' as const } })),
    );
  }
  const captured = captureLocalAssociations(commands, base.workspace_id),
    now = utcInstant(new Date().toISOString());
  const ids = new Set(
    captured.map(
      (c) => counterpartyAssociationChange(c).content.counterparty_id,
    ),
  );
  const references = snapshot.items
    .filter((r) => ids.has(r.id))
    .map(({ id, workspace_id, status }) => ({ id, workspace_id, status }));
  try {
    for (const c of captured)
      validateCounterpartyAssociationPlan(
        c,
        planTransactionRevision(
          base.workspace_id,
          c.base,
          counterpartyAssociationChange(c),
          now,
        ),
        references,
        base.workspace_id,
      );
  } catch (e) {
    throw new LocalMovementError(
      e instanceof CounterpartyAssociationError
        ? e.code
        : 'INVALID_COUNTERPARTY_ASSOCIATION',
    );
  }
  return captured;
}
export function createLocalCounterpartyGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (e) {
      throw new LocalMovementError(
        typeof e === 'string' ? e : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async read(w: string, includeMovements = false) {
      return decodeCounterpartySnapshot(
        await call('read_local_counterparties', {
          workspaceId: resourceId(w),
          includeMovements,
        }),
        w,
        includeMovements,
      );
    },
    async apply(
      w: string,
      input: CounterpartyCommand,
      snapshot: CounterpartySnapshot,
    ) {
      const base = decodeCounterpartySnapshot(
          { workspace_id: snapshot.workspace_id, items: snapshot.items },
          w,
        ),
        c = captureLocalCounterparty(input, w);
      return decodeCounterpartyResult(
        await call('apply_local_counterparty_change', {
          workspaceId: w,
          input: c,
        }),
        c,
        base,
      );
    },
    async associate(
      w: string,
      input: readonly CounterpartyAssociationCommand[],
    ) {
      const commands = captureLocalAssociations(input, w);
      return decodeAssociationResult(
        await call('apply_local_counterparty_association', {
          workspaceId: w,
          input: commands,
        }),
        commands,
      );
    },
  });
}
export function localCounterpartyMessage(e: unknown) {
  const code =
    e instanceof LocalMovementError || e instanceof CounterpartyError
      ? e.code
      : '';
  if (
    [
      'COUNTERPARTY_BASE_CONFLICT',
      'COUNTERPARTY_ASSOCIATION_BASE_CONFLICT',
      'VERSION_CONFLICT',
    ].includes(code)
  )
    return 'Os dados mudaram ou a tentativa já foi registrada. Consulte o resultado e revise antes de uma nova alteração.';
  if (code === 'COUNTERPARTY_REFERENCE_UNAVAILABLE')
    return 'A contraparte está indisponível ou foi arquivada. Atualize a consulta e revise a escolha.';
  if (code === 'COUNTERPARTY_LIMIT')
    return 'O catálogo excede o limite. Nenhum resultado parcial foi apresentado.';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo foi bloqueado. Desbloqueie para continuar.';
  if (code === 'INVALID_COUNTERPARTY_CHANGE')
    return 'Confira o nome, o tipo e o identificador. CPF usa 11 dígitos; CNPJ, 14.';
  if (code === 'COMPOSITE_REQUIRED')
    return 'Confira os dois lados da operação agrupada e suas contas ativas.';
  return 'Não foi possível confirmar. Repita a mesma tentativa ou consulte o resultado para revisar.';
}

export function decodeAssociationResult(
  raw: unknown,
  commands: readonly CounterpartyAssociationCommand[],
): readonly MovementResult[] {
  try {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).join(',') !== 'entries'
    )
      throw Error();
    const entries = (raw as { entries: unknown }).entries;
    if (!Array.isArray(entries) || entries.length !== commands.length)
      throw Error();
    const seen = new Set<string>(),
      audit = new Set<string>();
    return Object.freeze(
      entries.map((r) => {
        if (
          !r ||
          typeof r !== 'object' ||
          Array.isArray(r) ||
          Object.keys(r).sort().join(',') !==
            'base_revision,changed,id,revision_id,version'
        )
          throw Error();
        const c = commands.find((c) => c.base.id === r.id);
        if (!c || seen.has(r.id)) throw Error();
        seen.add(r.id);
        const p = planTransactionRevision(
          c.base.workspace_id,
          c.base,
          counterpartyAssociationChange(c),
          utcInstant(new Date().toISOString()),
        );
        if (
          r.changed !== p.changed ||
          r.base_revision !== c.base.version ||
          r.version !== p.after.version
        )
          throw Error();
        if (p.changed) {
          uuidV7(r.revision_id);
          if (audit.has(r.revision_id)) throw Error();
          audit.add(r.revision_id);
        } else if (r.revision_id !== null) throw Error();
        return Object.freeze({
          changed: p.changed,
          id: c.base.id,
          base_revision: c.base.version,
          version: r.version as string,
          revision_id: r.revision_id as string | null,
        });
      }),
    );
  } catch {
    throw new LocalMovementError('INVALID_RESPONSE');
  }
}
export function verifyAssociationRead(
  snapshot: CounterpartySnapshot,
  commands: readonly CounterpartyAssociationCommand[],
  entries: readonly MovementResult[],
) {
  for (const c of commands) {
    const result = entries.find((r) => r.id === c.base.id),
      after = snapshot.movements!.transactions.find((r) => r.id === c.base.id);
    if (
      !result ||
      !after ||
      after.workspace_id !== c.base.workspace_id ||
      after.version !== result.version ||
      after.created_at !== c.base.created_at ||
      after.updated_at < c.base.updated_at ||
      after.deleted_at !== c.base.deleted_at ||
      JSON.stringify(after.content) !==
        JSON.stringify(counterpartyAssociationChange(c).content)
    )
      throw new LocalMovementError('INVALID_RESPONSE');
    if (result.changed) {
      const history = snapshot.movements!.history.find(
        (r) => r.id === result.revision_id,
      );
      if (
        !history?.compatible ||
        history.change_source !== 'MANUAL' ||
        !history.snapshot ||
        JSON.stringify(history.snapshot.before) !== JSON.stringify(c.base) ||
        JSON.stringify(history.snapshot.after) !== JSON.stringify(after)
      )
        throw new LocalMovementError('INVALID_RESPONSE');
    } else if (JSON.stringify(after) !== JSON.stringify(c.base))
      throw new LocalMovementError('INVALID_RESPONSE');
  }
}
