import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId } from '@financial-manager/contracts';
import { decodeOfxPreview } from './local-ofx-preview.js';
import type { OfxPreview } from './local-ofx-preview.js';
export interface FileTarget {
  readonly workspace_id: string;
  readonly batch_id: string;
  readonly account_id: string;
}
export interface FileOptions {
  readonly encoding: 'utf-8' | 'windows-1252';
  readonly delimiter: ',' | ';' | '\t' | null;
}
export interface FileInspection {
  readonly policy_version: '1';
  readonly format: 'CSV' | 'OFX';
  readonly encoding: FileOptions['encoding'];
  readonly byte_length: number;
  readonly records: number;
  readonly columns: number | null;
  readonly depth: number | null;
}
export interface InspectedFile {
  readonly file_name: string;
  readonly file_hash: string;
  readonly inspection: FileInspection;
  readonly normalization?: OfxPreview;
}
const codes = [
  'INVALID_REQUEST',
  'EMPTY_FILE',
  'FILE_LIMIT',
  'UNSUPPORTED_FORMAT',
  'TYPE_MISMATCH',
  'ENCODING_MISMATCH',
  'INVALID_ENCODING',
  'INVALID_CONTENT',
  'LINE_LIMIT',
  'ROW_LIMIT',
  'COLUMN_LIMIT',
  'FIELD_LIMIT',
  'RECORD_LIMIT',
  'INVALID_CSV',
  'INVALID_OFX',
  'UNSUPPORTED_LAYOUT',
  'ACTIVE_CONTENT',
  'DEPTH_LIMIT',
  'NODE_LIMIT',
  'TIME_LIMIT',
  'CANCELLED',
  'INVALID_DESTINATION',
  'INVALID_OFX_STRUCTURE',
  'OFX_SOURCE_ERROR',
  'INVALID_SOURCE_ACCOUNT',
  'ACCOUNT_KIND_MISMATCH',
  'CURRENCY_MISMATCH',
  'INVALID_PERIOD',
  'EMPTY_STATEMENT',
  'HASH_UNAVAILABLE',
  'FILE_UNAVAILABLE',
  'LOCAL_LOCKED',
  'INVALID_IMPORT_REQUEST',
  'IMPORT_ACCOUNT_UNAVAILABLE',
  'IMPORT_NOT_FOUND',
  'REQUEST_CONFLICT',
  'STORAGE_UNAVAILABLE',
  'INVALID_RESPONSE',
] as const;
export class LocalFileError extends Error {
  readonly code: (typeof codes)[number];
  constructor(code: unknown) {
    const safe = codes.find((s) => s === code) ?? 'STORAGE_UNAVAILABLE';
    super(safe);
    this.code = safe;
  }
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
    throw new LocalFileError('INVALID_RESPONSE');
}
export function captureFileTarget(target: FileTarget): FileTarget {
  try {
    exact(target, ['workspace_id', 'batch_id', 'account_id']);
    return Object.freeze({
      workspace_id: resourceId(target.workspace_id),
      batch_id: resourceId(target.batch_id),
      account_id: resourceId(target.account_id),
    });
  } catch {
    throw new LocalFileError('INVALID_REQUEST');
  }
}
export function captureFileOptions(options: FileOptions): FileOptions {
  try {
    exact(options, ['encoding', 'delimiter']);
    if (
      !['utf-8', 'windows-1252'].includes(options.encoding) ||
      ![null, ',', ';', '\t'].includes(options.delimiter)
    )
      throw Error();
    return Object.freeze({ ...options });
  } catch {
    throw new LocalFileError('INVALID_REQUEST');
  }
}
export function decodeInspectedFile(
  raw: unknown,
  options: FileOptions,
  target?: FileTarget,
): InspectedFile {
  try {
    exact(raw, [
      'outcome',
      'file_name',
      'file_hash',
      'inspection',
      ...(raw && typeof raw === 'object' && 'normalization' in raw
        ? ['normalization']
        : []),
    ]);
    if (
      raw.outcome !== 'VALIDATED' ||
      typeof raw.file_name !== 'string' ||
      !raw.file_name ||
      raw.file_name.lastIndexOf('.') < 1 ||
      raw.file_name.length > 255 ||
      raw.file_name.trim() !== raw.file_name ||
      /[\p{Cc}\p{Cf}\p{Cs}\\/:]/u.test(raw.file_name) ||
      /[. ]$/.test(raw.file_name) ||
      typeof raw.file_hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.file_hash)
    )
      throw Error();
    const i = raw.inspection;
    exact(i, [
      'policy_version',
      'format',
      'encoding',
      'byte_length',
      'records',
      'columns',
      'depth',
    ]);
    const bound = (n: unknown, min: number, max: number) =>
      typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
    if (
      i.policy_version !== '1' ||
      i.encoding !== options.encoding ||
      !bound(i.byte_length, 1, 16 * 1024 * 1024) ||
      !bound(i.records, 0, 10000)
    )
      throw Error();
    if (i.format === 'CSV') {
      if (
        'normalization' in raw ||
        options.delimiter === null ||
        !bound(i.records, 1, 10000) ||
        i.depth !== null ||
        !bound(i.columns, 2, 64) ||
        !raw.file_name.toLowerCase().endsWith('.csv')
      )
        throw Error();
    } else if (i.format === 'OFX') {
      if (
        options.delimiter !== null ||
        i.columns !== null ||
        !bound(i.depth, 1, 32) ||
        !raw.file_name.toLowerCase().endsWith('.ofx')
      )
        throw Error();
    } else throw Error();
    const normalization =
      i.format === 'OFX'
        ? decodeOfxPreview(raw.normalization, {
            workspace_id: target?.workspace_id ?? '',
            account_id: target?.account_id ?? '',
            file_name: raw.file_name,
            file_hash: raw.file_hash,
            records: i.records as number,
          })
        : undefined;
    return Object.freeze({
      file_name: raw.file_name,
      file_hash: raw.file_hash,
      ...(normalization ? { normalization } : {}),
      inspection: Object.freeze({ ...i }) as unknown as FileInspection,
    });
  } catch {
    throw new LocalFileError('INVALID_RESPONSE');
  }
}
export function createImportFileGateway(call: typeof invoke = invoke) {
  if (call === invoke && !isTauri()) return null;
  async function run(target: FileTarget, input: Record<string, unknown>) {
    try {
      return await call('local_import_file', {
        workspaceId: target.workspace_id,
        input,
      });
    } catch (error) {
      throw new LocalFileError(
        typeof error === 'string' ? error : (error as { code?: unknown })?.code,
      );
    }
  }
  return Object.freeze({
    async select(value: FileTarget) {
      const target = captureFileTarget(value);
      const raw = await run(target, {
        action: 'SELECT',
        batch_id: target.batch_id,
      });
      exact(raw, ['selection_id']);
      if (raw.selection_id === null) return null;
      try {
        return resourceId(raw.selection_id);
      } catch {
        throw new LocalFileError('INVALID_RESPONSE');
      }
    },
    async validate(value: FileTarget, selection: string, options: FileOptions) {
      const target = captureFileTarget(value),
        captured = captureFileOptions(options);
      let id: string;
      try {
        id = resourceId(selection);
      } catch {
        throw new LocalFileError('INVALID_REQUEST');
      }
      const raw = await run(target, {
        action: 'VALIDATE',
        batch_id: target.batch_id,
        selection_id: id,
        ...captured,
      });
      exact(raw, ['workspace_id', 'batch_id', 'selection_id', 'result']);
      if (
        raw.workspace_id !== target.workspace_id ||
        raw.batch_id !== target.batch_id ||
        raw.selection_id !== id
      )
        throw new LocalFileError('INVALID_RESPONSE');
      const result = raw.result;
      if (
        result &&
        typeof result === 'object' &&
        'outcome' in result &&
        result.outcome === 'REJECTED'
      ) {
        exact(result, ['outcome', 'code']);
        const rejected = (result as Record<string, unknown>).code;
        if (!codes.some((code) => code === rejected))
          throw new LocalFileError('INVALID_RESPONSE');
        throw new LocalFileError(rejected);
      }
      return decodeInspectedFile(result, captured, target);
    },
    async cancel(value: FileTarget) {
      const target = captureFileTarget(value);
      const raw = await run(target, { action: 'CANCEL' });
      exact(raw, ['cancelled']);
      if (raw.cancelled !== true) throw new LocalFileError('INVALID_RESPONSE');
    },
  });
}
export function fileMessage(error: unknown): string {
  const code =
    error instanceof LocalFileError ? error.code : 'STORAGE_UNAVAILABLE';
  if (code === 'LOCAL_LOCKED')
    return 'Desbloqueie o aplicativo para validar o arquivo.';
  if (code === 'CURRENCY_MISMATCH' || code === 'ACCOUNT_KIND_MISMATCH')
    return 'O extrato não corresponde à moeda ou ao tipo da conta de destino. Selecione a conta correta e uma nova exportação.';
  if (code === 'CANCELLED')
    return 'Validação cancelada. Nenhum lançamento foi criado.';
  if (code === 'UNSUPPORTED_FORMAT' || code === 'UNSUPPORTED_LAYOUT')
    return 'Arquivo incompatível. Use um extrato OFX ou CSV compatível, ou cadastre os lançamentos manualmente.';
  if (
    code === 'INVALID_ENCODING' ||
    code === 'ENCODING_MISMATCH' ||
    code === 'TYPE_MISMATCH' ||
    code === 'INVALID_REQUEST'
  )
    return 'O arquivo não corresponde às opções escolhidas. Selecione novamente e confira formato, separador e encoding.';
  if (
    [
      'FILE_LIMIT',
      'ROW_LIMIT',
      'COLUMN_LIMIT',
      'FIELD_LIMIT',
      'RECORD_LIMIT',
      'LINE_LIMIT',
      'DEPTH_LIMIT',
      'NODE_LIMIT',
      'TIME_LIMIT',
    ].includes(code)
  )
    return 'O arquivo excede os limites de leitura segura. Exporte um período menor e selecione novamente.';
  return 'Não foi possível validar o arquivo com segurança. Selecione uma nova exportação OFX/CSV e tente novamente. Nenhum lançamento foi criado.';
}
