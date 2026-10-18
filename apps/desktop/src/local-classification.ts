import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  resourceId,
  uuidV7,
  createCryptoIdentity,
} from '@financial-manager/contracts';
import {
  captureClassification,
  classificationChange,
  validateClassificationPlan,
  ClassificationError,
} from '@financial-manager/domain/classification';
import type {
  ClassificationCommand,
  ClassificationSelection,
} from '@financial-manager/domain/classification';
import { utcInstant } from '@financial-manager/domain';
import { planTransactionRevision } from '@financial-manager/domain/revisions';
import type { RevisionState } from '@financial-manager/domain/revisions';
import { LocalMovementError } from './local-movements.js';
import type { MovementResult } from './local-movements.js';
import { decodeClassificationSnapshot } from './local-classification-filters.js';
import type { ClassificationSnapshot } from './local-classification-filters.js';
export function captureLocalClassification(
  input: readonly ClassificationCommand[],
  workspace: string,
): readonly ClassificationCommand[] {
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
      .map((c) => captureClassification(c, workspace))
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
      for (const id of c.tag_ids) resourceId(id);
      if (c.classification.kind === 'SET') {
        (c.base.content.allocations.length ? resourceId : uuidV7)(
          c.classification.allocation_id,
        );
        resourceId(c.classification.category_id);
        if (c.classification.subcategory_id !== null)
          resourceId(c.classification.subcategory_id);
      }
      classificationChange(c);
    }
    return Object.freeze(commands);
  } catch (e) {
    throw new LocalMovementError(
      e instanceof ClassificationError ? e.code : 'INVALID_CLASSIFICATION',
    );
  }
}
export function classificationEdit(
  snapshot: ClassificationSnapshot,
  id: string,
  classification: ClassificationSelection,
  tag_ids: readonly string[],
) {
  const base = snapshot.movements.transactions.find((r) => r.id === id);
  if (!base) throw new LocalMovementError('NOT_FOUND');
  const commands: ClassificationCommand[] = [{ base, classification, tag_ids }];
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
          classification: { kind: 'KEEP' as const },
          tag_ids: r.content.tag_ids,
        })),
    );
  }
  const captured = captureLocalClassification(commands, base.workspace_id),
    now = utcInstant(new Date().toISOString());
  try {
    for (const c of captured)
      validateClassificationPlan(
        c,
        planTransactionRevision(
          base.workspace_id,
          c.base,
          classificationChange(c),
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
      e instanceof ClassificationError ? e.code : 'INVALID_CLASSIFICATION',
    );
  }
  return captured;
}
export function newClassificationAllocation(base: RevisionState) {
  return (
    base.content.allocations[0]?.id ??
    createCryptoIdentity(globalThis.crypto, Date.now).newId()
  );
}
export function decodeClassificationResult(
  raw: unknown,
  commands: readonly ClassificationCommand[],
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
          classificationChange(c),
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
export function verifyClassificationRead(
  snapshot: ClassificationSnapshot,
  commands: readonly ClassificationCommand[],
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
        JSON.stringify(classificationChange(c).content)
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
export function createLocalClassificationGateway() {
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
    async apply(workspace: string, input: readonly ClassificationCommand[]) {
      const commands = captureLocalClassification(input, workspace);
      return decodeClassificationResult(
        await call('apply_local_classification_change', {
          workspaceId: workspace,
          input: commands,
        }),
        commands,
      );
    },
  });
}
export function localClassificationMessage(error: unknown) {
  const code = error instanceof LocalMovementError ? error.code : '';
  if (['VERSION_CONFLICT', 'CLASSIFICATION_BASE_CONFLICT'].includes(code))
    return 'A base mudou ou esta tentativa já foi registrada. Consulte o resultado e revise antes de tentar outra alteração.';
  if (code === 'CLASSIFICATION_REFERENCE_UNAVAILABLE')
    return 'Uma referência escolhida está indisponível ou foi arquivada. Atualize a consulta e revise a classificação.';
  if (code === 'CLASSIFICATION_SCOPE_MISMATCH')
    return 'Escolha uma categoria compatível com a natureza econômica desta movimentação.';
  if (code === 'CLASSIFICATION_SPLIT_REVIEW_REQUIRED')
    return 'Conserve o rateio existente para editar as tags.';
  if (code === 'CLASSIFICATION_AMOUNT_UNSUPPORTED')
    return 'Este valor não permite uma classificação monetária única. É possível conservar a classificação e editar tags.';
  if (code === 'CLASSIFICATION_DELETED')
    return 'Restaure a movimentação antes de classificar.';
  if (code === 'COMPOSITE_REQUIRED')
    return 'A operação agrupada precisa dos dois lados válidos e de contas ativas. Atualize a consulta e confira o grupo completo.';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo foi bloqueado. Desbloqueie para consultar os dados.';
  if (code === 'INVALID_CLASSIFICATION')
    return 'Confira categoria, subcategoria e tags antes de salvar.';
  return 'Não foi possível confirmar a alteração. Consulte o resultado antes de iniciar outra tentativa.';
}
