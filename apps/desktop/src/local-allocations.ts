import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  resourceId,
  uuidV7,
  createCryptoIdentity,
} from '@financial-manager/contracts';
import {
  captureAllocation,
  allocationChange,
  validateAllocationPlan,
  AllocationError,
} from '@financial-manager/domain/classification';
import type {
  AllocationCommand,
  AllocationSelection,
} from '@financial-manager/domain/classification';
import { utcInstant } from '@financial-manager/domain';
import { planTransactionRevision } from '@financial-manager/domain/revisions';
import { LocalMovementError } from './local-movements.js';
import type { MovementResult } from './local-movements.js';
import { decodeClassificationSnapshot } from './local-classification-filters.js';
import type { ClassificationSnapshot } from './local-classification-filters.js';
export function captureLocalAllocations(
  input: readonly AllocationCommand[],
  workspace: string,
): readonly AllocationCommand[] {
  try {
    resourceId(workspace);
    if (
      !Array.isArray(input) ||
      !input.length ||
      input.length > 256 ||
      JSON.stringify(input).length > 4 * 1024 * 1024 ||
      new TextEncoder().encode(JSON.stringify(input)).byteLength >
        4 * 1024 * 1024
    )
      throw Error();
    const commands = input
      .map((c) => captureAllocation(c, workspace))
      .toSorted((a, b) => a.base.id.localeCompare(b.base.id));
    if (new Set(commands.map((c) => c.base.id)).size !== commands.length)
      throw Error();
    for (const c of commands) {
      resourceId(c.base.id);
      resourceId(c.base.content.account_id);
      for (const id of [
        c.base.content.group_id,
        c.base.content.counterparty_id,
      ])
        if (id !== null) resourceId(id);
      for (const a of c.base.content.allocations) {
        resourceId(a.id);
        resourceId(a.category_id);
        if (a.subcategory_id !== null) resourceId(a.subcategory_id);
      }
      if (c.allocation.kind === 'REPLACE')
        for (const a of c.allocation.allocations) {
          (c.base.content.allocations.some((old) => old.id === a.id)
            ? resourceId
            : uuidV7)(a.id);
          resourceId(a.category_id);
          if (a.subcategory_id !== null) resourceId(a.subcategory_id);
        }
      allocationChange(c);
    }
    return Object.freeze(commands);
  } catch (e) {
    throw new LocalMovementError(
      e instanceof AllocationError ? e.code : 'INVALID_ALLOCATION_CHANGE',
    );
  }
}
export function allocationEdit(
  snapshot: ClassificationSnapshot,
  id: string,
  allocation: AllocationSelection,
) {
  const base = snapshot.movements.transactions.find((r) => r.id === id);
  if (!base) throw new LocalMovementError('NOT_FOUND');
  const commands: AllocationCommand[] = [{ base, allocation }];
  if (base.content.group_id) {
    const members = snapshot.movements.transactions.filter(
      (r) => r.content.group_id === base.content.group_id,
    );
    if (members.length !== 2 || members.some((r) => r.content.deleted))
      throw new LocalMovementError('COMPOSITE_REQUIRED');
    commands.push(
      ...members
        .filter((r) => r.id !== id)
        .map((r) => ({
          base: r,
          allocation: { kind: 'KEEP' as const },
        })),
    );
  }
  const captured = captureLocalAllocations(commands, base.workspace_id),
    now = utcInstant(new Date().toISOString());
  try {
    for (const c of captured)
      validateAllocationPlan(
        c,
        planTransactionRevision(
          base.workspace_id,
          c.base,
          allocationChange(c),
          now,
        ),
        {
          categories: snapshot.catalog.categories,
          items: snapshot.catalog.items,
        },
        base.workspace_id,
      );
  } catch (e) {
    throw new LocalMovementError(
      e instanceof AllocationError ? e.code : 'INVALID_ALLOCATION_CHANGE',
    );
  }
  return captured;
}
export function newAllocationId() {
  return createCryptoIdentity(globalThis.crypto, Date.now).newId();
}
export function decodeAllocationResult(
  raw: unknown,
  commands: readonly AllocationCommand[],
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
          allocationChange(c),
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
export function verifyAllocationRead(
  snapshot: ClassificationSnapshot,
  commands: readonly AllocationCommand[],
  entries: readonly MovementResult[],
) {
  for (const c of commands) {
    const result = entries.find((r) => r.id === c.base.id),
      after = snapshot.movements.transactions.find((r) => r.id === c.base.id);
    if (
      !result ||
      !after ||
      after.workspace_id !== c.base.workspace_id ||
      after.version !== result.version ||
      after.created_at !== c.base.created_at ||
      after.updated_at < c.base.updated_at ||
      after.deleted_at !== c.base.deleted_at ||
      JSON.stringify(after.content) !==
        JSON.stringify(allocationChange(c).content)
    )
      throw new LocalMovementError('INVALID_RESPONSE');
    if (result.changed) {
      const history = snapshot.movements.history.find(
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
export function createLocalAllocationGateway() {
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
    async read(workspace: string) {
      return decodeClassificationSnapshot(
        await call('read_local_movements', {
          workspaceId: resourceId(workspace),
          includeClassification: true,
        }),
        workspace,
      );
    },
    async apply(workspace: string, input: readonly AllocationCommand[]) {
      const commands = captureLocalAllocations(input, workspace);
      return decodeAllocationResult(
        await call('apply_local_allocation_change', {
          workspaceId: workspace,
          input: commands,
        }),
        commands,
      );
    },
  });
}
export function localAllocationMessage(error: unknown) {
  const code = error instanceof LocalMovementError ? error.code : '';
  if (['VERSION_CONFLICT', 'ALLOCATION_BASE_CONFLICT'].includes(code))
    return 'A base mudou ou esta tentativa já foi registrada. Consulte o resultado e revise antes de tentar outra alteração.';
  if (code === 'ALLOCATION_TOTAL_MISMATCH')
    return 'A soma das parcelas precisa coincidir com o total da movimentação.';
  if (code === 'ALLOCATION_REFERENCE_UNAVAILABLE')
    return 'Uma referência escolhida está indisponível ou foi arquivada. Atualize a consulta e revise as parcelas.';
  if (code === 'ALLOCATION_SCOPE_MISMATCH')
    return 'Escolha categorias compatíveis com a natureza econômica desta movimentação.';
  if (code === 'ALLOCATION_DELETED')
    return 'Restaure a movimentação antes de editar o rateio.';
  if (code === 'COMPOSITE_REQUIRED')
    return 'Confira os dois lados válidos da operação agrupada e suas contas ativas.';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo foi bloqueado. Desbloqueie para consultar os dados.';
  if (code === 'INVALID_ALLOCATION_CHANGE')
    return 'Confira os valores positivos, categorias, subcategorias e notas das parcelas.';
  return 'Não foi possível confirmar o rateio. Consulte o resultado antes de iniciar outra tentativa.';
}
