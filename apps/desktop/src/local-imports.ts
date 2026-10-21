import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureImportBatch,
  captureImportSource,
  captureImportEffect,
  captureImportCounts,
  captureImportQuery,
  importExact,
} from '@financial-manager/domain/imports';
import type {
  ImportQuery,
  ImportEffect,
} from '@financial-manager/domain/imports';
import type {
  ImportBatch,
  ImportSource,
  ImportCounts,
} from '@financial-manager/domain/imports';
export interface ImportSummary {
  readonly batch: ImportBatch;
  readonly sources: readonly ImportSource[];
  readonly counts: ImportCounts;
}
const codes = [
  'INVALID_IMPORT_REQUEST',
  'INVALID_IMPORT_STATE',
  'IMPORT_LIMIT',
  'IMPORT_NOT_FOUND',
  'IMPORT_BASE_CONFLICT',
  'IMPORT_ACCOUNT_UNAVAILABLE',
  'LOCAL_LOCKED',
  'KEY_MISSING',
  'REQUEST_CONFLICT',
  'INTEGRITY_FAILURE',
  'UNSUPPORTED_SCHEMA',
  'INVALID_RESPONSE',
  'STORAGE_UNAVAILABLE',
] as const;
export class LocalImportError extends Error {
  readonly code: (typeof codes)[number];
  constructor(code: string) {
    const safe = codes.find((c) => c === code) ?? 'STORAGE_UNAVAILABLE';
    super(safe);
    this.code = safe;
  }
}
export interface ImportPage {
  readonly items: readonly ImportSummary[];
  readonly next_cursor: ImportQuery['cursor'];
}
export interface ImportDetail extends ImportSummary {
  readonly effects: readonly ImportEffect[];
  readonly next_effect_cursor: string | null;
}
export interface PrepareImport {
  readonly id: string;
  readonly target_account_id: string;
}
export interface ImportDetailQuery {
  readonly id: string;
  readonly effect_after: string | null;
  readonly effect_limit: number;
}
function summary(raw: unknown, w: string): ImportSummary {
  importExact(raw, ['batch', 'sources', 'counts']);
  const b = captureImportBatch(raw.batch, w);
  for (const id of [
    b.id,
    b.target_account_id,
    b.reverses_batch_id,
    b.created_by_member_id,
  ])
    if (id !== null) resourceId(id);
  if (!Array.isArray(raw.sources) || raw.sources.length > 16) throw Error();
  const sources = raw.sources.map((s) => captureImportSource(s, w, b.id));
  for (const s of sources) resourceId(s.id);
  if (
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.some((s, i) => i > 0 && s.id <= sources[i - 1]!.id)
  )
    throw Error();
  const counts = captureImportCounts(raw.counts);
  if (
    BigInt(counts.total_items) > 200000n ||
    BigInt(counts.total_effects) > 400000n
  )
    throw Error();
  return Object.freeze({ batch: b, sources: Object.freeze(sources), counts });
}
export function captureLocalImportQuery(input: ImportQuery) {
  try {
    const q = captureImportQuery(input);
    if (q.account_id) resourceId(q.account_id);
    if (q.cursor) resourceId(q.cursor.id);
    return q;
  } catch {
    throw new LocalImportError('INVALID_IMPORT_REQUEST');
  }
}
export function captureLocalImportPrepare(input: PrepareImport): PrepareImport {
  try {
    importExact(input, ['id', 'target_account_id']);
    return Object.freeze({
      id: uuidV7(input.id),
      target_account_id: resourceId(input.target_account_id),
    });
  } catch {
    throw new LocalImportError('INVALID_IMPORT_REQUEST');
  }
}
export function captureLocalImportDetail(
  input: ImportDetailQuery,
): ImportDetailQuery {
  try {
    importExact(input, ['id', 'effect_after', 'effect_limit']);
    resourceId(input.id);
    if (input.effect_after !== null) resourceId(input.effect_after);
    if (
      !Number.isSafeInteger(input.effect_limit) ||
      input.effect_limit < 1 ||
      input.effect_limit > 100
    )
      throw Error();
    return Object.freeze({ ...input });
  } catch {
    throw new LocalImportError('INVALID_IMPORT_REQUEST');
  }
}
export function decodeImportPage(
  raw: unknown,
  w: string,
  q: ImportQuery,
): ImportPage {
  try {
    resourceId(w);
    importExact(raw, ['items', 'next_cursor']);
    if (!Array.isArray(raw.items) || raw.items.length > q.limit) throw Error();
    const items = raw.items.map((r) => summary(r, w));
    if (new Set(items.map((r) => r.batch.id)).size !== items.length)
      throw Error();
    for (let i = 0; i < items.length; i++) {
      const b = items[i]!.batch,
        prev = i ? items[i - 1]!.batch : q.cursor;
      if (
        (q.account_id !== null && b.target_account_id !== q.account_id) ||
        (q.statuses.length && !q.statuses.includes(b.status)) ||
        (prev &&
          !(
            b.created_at < prev.created_at ||
            (b.created_at === prev.created_at && b.id < prev.id)
          ))
      )
        throw Error();
    }
    const next = captureLocalImportQuery({
      ...q,
      cursor: raw.next_cursor as ImportQuery['cursor'],
    }).cursor;
    if (next) {
      const last = items.at(-1)?.batch;
      if (
        items.length !== q.limit ||
        !last ||
        last.id !== next.id ||
        last.created_at !== next.created_at
      )
        throw Error();
    }
    return Object.freeze({ items: Object.freeze(items), next_cursor: next });
  } catch {
    throw new LocalImportError('INVALID_RESPONSE');
  }
}
export function decodeImportDetail(
  raw: unknown,
  w: string,
  q: ImportDetailQuery,
): ImportDetail {
  try {
    importExact(raw, [
      'batch',
      'sources',
      'counts',
      'effects',
      'next_effect_cursor',
    ]);
    const { effects, next_effect_cursor, ...rest } = raw,
      s = summary(rest, w);
    if (
      s.batch.id !== q.id ||
      !Array.isArray(effects) ||
      effects.length > q.effect_limit
    )
      throw Error();
    const rows = effects.map((e) => captureImportEffect(e, w, q.id));
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i]!;
      for (const id of [
        e.id,
        e.import_item_id,
        e.transaction_id,
        e.before_revision_id,
        e.after_revision_id,
      ])
        if (id !== null) resourceId(id);
      const prior = i ? rows[i - 1]!.id : q.effect_after;
      if (prior !== null && e.id <= prior) throw Error();
    }
    if (
      next_effect_cursor !== null &&
      (resourceId(next_effect_cursor) !== rows.at(-1)?.id ||
        rows.length !== q.effect_limit)
    )
      throw Error();
    if (BigInt(s.counts.total_effects) < BigInt(rows.length)) throw Error();
    return Object.freeze({
      ...s,
      effects: Object.freeze(rows),
      next_effect_cursor: next_effect_cursor as string | null,
    });
  } catch {
    throw new LocalImportError('INVALID_RESPONSE');
  }
}
export function decodeImportPrepare(raw: unknown, w: string, c: PrepareImport) {
  try {
    importExact(raw, ['created', 'batch', 'sources', 'counts']);
    const { created, ...rest } = raw,
      s = summary(rest, w),
      b = s.batch;
    if (
      typeof created !== 'boolean' ||
      b.id !== c.id ||
      b.target_account_id !== c.target_account_id ||
      b.batch_kind !== 'IMPORT' ||
      b.created_by_member_id !== null
    )
      throw Error();
    if (
      created &&
      (b.status !== 'PREPARING' ||
        b.version !== '1' ||
        s.sources.length ||
        s.counts.total_items !== '0' ||
        s.counts.total_effects !== '0')
    )
      throw Error();
    return Object.freeze({ created, ...s });
  } catch {
    throw new LocalImportError('INVALID_RESPONSE');
  }
}
export function createLocalImportsGateway() {
  if (!isTauri()) return null;
  async function call(command: string, w: string, input: unknown) {
    try {
      return await invoke<unknown>(command, {
        workspaceId: resourceId(w),
        input,
      });
    } catch (e) {
      throw e instanceof LocalImportError
        ? e
        : new LocalImportError(
            typeof e === 'string' ? e : 'STORAGE_UNAVAILABLE',
          );
    }
  }
  return Object.freeze({
    async list(w: string, input: ImportQuery) {
      const q = captureLocalImportQuery(input);
      return decodeImportPage(await call('list_local_imports', w, q), w, q);
    },
    async detail(w: string, input: ImportDetailQuery) {
      const q = captureLocalImportDetail(input);
      return decodeImportDetail(await call('read_local_import', w, q), w, q);
    },
    async prepare(w: string, input: PrepareImport) {
      const c = captureLocalImportPrepare(input);
      return decodeImportPrepare(
        await call('prepare_local_import', w, c),
        w,
        c,
      );
    },
  });
}
export const importStatusLabels = Object.freeze({
  PREPARING: 'Em preparação',
  REVIEW: 'Em revisão',
  CONFIRMING: 'Confirmando',
  COMMITTED: 'Concluído',
  FAILED: 'Falhou',
  REVERSED: 'Revertido',
  PARTIALLY_REVERSED: 'Parcialmente revertido',
});
export function localImportMessage(e: unknown) {
  const code = e instanceof LocalImportError ? e.code : '';
  if (code === 'IMPORT_ACCOUNT_UNAVAILABLE')
    return 'Escolha uma conta ativa antes de preparar uma importação.';
  if (code === 'IMPORT_BASE_CONFLICT')
    return 'Este pedido já pertence a outra preparação. Recarregue o histórico para conferir.';
  if (code === 'IMPORT_LIMIT')
    return 'O lote excede o tamanho suportado. Nenhuma informação foi truncada.';
  if (code === 'IMPORT_NOT_FOUND')
    return 'O lote não foi encontrado neste espaço.';
  return 'Não foi possível confirmar a consulta ou a preparação. Você pode repetir o mesmo pedido com segurança.';
}
