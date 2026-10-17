import { invoke, isTauri } from '@tauri-apps/api/core';
export type BackupResult = Readonly<{
  outcome: 'CREATED' | 'CANCELED';
  created_at: string | null;
}>;
export class LocalBackupError extends Error {
  constructor(readonly code: string) {
    super('LOCAL_BACKUP_OPERATION_FAILED');
  }
}
export function validRecoveryPassword(value: string): boolean {
  const length = [...value].length;
  return (
    length >= 12 &&
    length <= 128 &&
    new TextEncoder().encode(value).length <= 1024 &&
    !/\p{Cc}/u.test(value) &&
    !/^\p{White_Space}+$/u.test(value)
  );
}
export function decodeBackupResult(value: unknown): BackupResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalBackupError('INVALID_RESPONSE');
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(',') !== 'created_at,outcome' ||
    !['CREATED', 'CANCELED'].includes(r.outcome as string) ||
    (r.outcome === 'CANCELED'
      ? r.created_at !== null
      : typeof r.created_at !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.created_at) ||
        !Number.isFinite(Date.parse(r.created_at)) ||
        new Date(r.created_at).toISOString() !== r.created_at)
  )
    throw new LocalBackupError('INVALID_RESPONSE');
  return Object.freeze({
    outcome: r.outcome as BackupResult['outcome'],
    created_at: r.created_at as string | null,
  });
}
export function backupMessage(error: unknown): string {
  const code = error instanceof LocalBackupError ? error.code : '';
  if (code === 'INVALID_BACKUP_PASSWORD')
    return 'Use uma senha de 12 a 128 caracteres e confirme exatamente a mesma senha.';
  if (code === 'BACKUP_LIMIT')
    return 'O cofre excede o limite de 64 MiB de backup desta versão. Os dados existentes foram preservados.';
  if (code === 'BACKUP_ALREADY_EXISTS')
    return 'Já existe um arquivo com esse nome. Escolha um novo nome; o arquivo existente foi preservado.';
  if (code === 'BACKUP_DESTINATION_UNAVAILABLE')
    return 'Não foi possível usar o destino. Escolha um novo arquivo .fmbackup fora da pasta interna do aplicativo.';
  if (code === 'LOCAL_LOCKED')
    return 'A sessão foi bloqueada antes de confirmar o backup. Verifique o arquivo escolhido antes de considerá-lo válido.';
  return 'Não foi possível concluir e verificar o backup. O cofre existente foi preservado. Se houver um arquivo no destino, não o considere confirmado.';
}
export function createBackupGateway(): Readonly<{
  create(
    workspaceId: string,
    password: string,
    confirmation: string,
  ): Promise<BackupResult>;
}> | null {
  if (!isTauri()) return null;
  return Object.freeze({
    async create(workspaceId: string, password: string, confirmation: string) {
      try {
        return decodeBackupResult(
          await invoke<unknown>('create_local_backup', {
            input: { workspace_id: workspaceId, password, confirmation },
          }),
        );
      } catch (error) {
        if (error instanceof LocalBackupError) throw error;
        throw new LocalBackupError(
          typeof error === 'string' &&
            [
              'INVALID_BACKUP_PASSWORD',
              'BACKUP_LIMIT',
              'BACKUP_ALREADY_EXISTS',
              'BACKUP_DESTINATION_UNAVAILABLE',
              'LOCAL_LOCKED',
            ].includes(error)
            ? error
            : 'STORAGE_UNAVAILABLE',
        );
      }
    },
  });
}
