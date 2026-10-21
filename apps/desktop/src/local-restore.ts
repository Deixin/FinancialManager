import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId } from '@financial-manager/contracts';
import { utcInstant } from '@financial-manager/domain';
import { decodeLocalWorkspace } from './local-workspaces.js';
export const restoreTables = [
  'workspace',
  'financial_account',
  'balance_reference',
  'category',
  'subcategory',
  'tag',
  'counterparty',
  'transaction_group',
  'financial_transaction',
  'transaction_allocation',
  'transaction_tag',
  'transaction_revision',
  'import_batch',
  'import_source',
  'import_item',
  'import_effect',
] as const;
export type RestorePreview = Readonly<{
  restore_id: string;
  source_name: string;
  display_name: string;
  purpose: 'PERSONAL' | 'BUSINESS' | 'OTHER';
  backup_created_at: string;
  record_counts: Readonly<Record<(typeof restoreTables)[number], string>>;
}>;
export class LocalRestoreError extends Error {
  constructor(readonly code: string) {
    super('LOCAL_RESTORE_OPERATION_FAILED');
  }
}
const fail = () => {
  throw new LocalRestoreError('INVALID_RESPONSE');
};
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(','),
  );
}
export function decodeSelection(value: unknown): string | null {
  if (!exact(value, ['selection_id'])) return fail();
  if (value.selection_id === null) return null;
  try {
    return resourceId(value.selection_id);
  } catch {
    return fail();
  }
}
export function decodeRestorePreview(value: unknown): RestorePreview {
  if (
    !exact(value, [
      'restore_id',
      'source_name',
      'display_name',
      'purpose',
      'backup_created_at',
      'record_counts',
    ]) ||
    !exact(value.record_counts, restoreTables)
  )
    return fail();
  for (const field of ['source_name', 'display_name']) {
    const name = value[field];
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 120 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(name)
    )
      return fail();
  }
  if (!['PERSONAL', 'BUSINESS', 'OTHER'].includes(String(value.purpose)))
    return fail();
  try {
    resourceId(value.restore_id);
    utcInstant(value.backup_created_at);
  } catch {
    return fail();
  }
  for (const count of Object.values(value.record_counts)) {
    if (
      typeof count !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(count) ||
      count.length > 19 ||
      BigInt(count) > 9223372036854775807n
    )
      return fail();
  }
  if (value.record_counts.workspace !== '1') return fail();
  return Object.freeze({
    ...value,
    record_counts: Object.freeze({ ...value.record_counts }),
  }) as RestorePreview;
}
export function restoreMessage(error: unknown): string {
  const code = error instanceof LocalRestoreError ? error.code : '';
  if (code === 'BACKUP_AUTHENTICATION_FAILED')
    return 'Senha incorreta ou pacote adulterado. Nenhum espaço existente foi alterado. Confira a senha e tente novamente.';
  if (code === 'INVALID_BACKUP_PASSWORD')
    return 'Informe a senha original do backup, com 12 a 128 caracteres. PIN e Windows Hello não a recuperam.';
  if (code === 'UNSUPPORTED_BACKUP' || code === 'UNSUPPORTED_SCHEMA')
    return 'Este formato ou schema de backup não é compatível com esta versão. Nenhum espaço existente foi alterado.';
  if (code === 'LOCAL_LOCKED')
    return 'A sessão foi bloqueada. Se a confirmação já havia começado, confira a lista de espaços antes de iniciar outra restauração.';
  return 'Não foi possível validar ou concluir a restauração. Os espaços existentes foram preservados. Confira a lista de espaços antes de iniciar outra restauração; você pode repetir a confirmação da mesma prévia.';
}
export function createRestoreGateway() {
  if (!isTauri()) return null;
  const call = async (command: string, args?: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (error) {
      throw new LocalRestoreError(
        typeof error === 'string' &&
          [
            'BACKUP_AUTHENTICATION_FAILED',
            'INVALID_BACKUP_PASSWORD',
            'UNSUPPORTED_BACKUP',
            'UNSUPPORTED_SCHEMA',
            'LOCAL_LOCKED',
          ].includes(error)
          ? error
          : 'RESTORE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async select() {
      return decodeSelection(await call('select_local_backup'));
    },
    async preview(selectionId: string, password: string) {
      return decodeRestorePreview(
        await call('preview_local_restore', {
          input: { selection_id: selectionId, password },
        }),
      );
    },
    async confirm(restoreId: string) {
      return decodeLocalWorkspace(
        await call('confirm_local_restore', { restoreId }),
      );
    },
    async cancel() {
      if ((await call('cancel_local_restore')) !== null) fail();
    },
  });
}
