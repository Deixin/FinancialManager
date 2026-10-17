import { invoke, isTauri } from '@tauri-apps/api/core';
import { resourceId } from '@financial-manager/contracts';
import { utcInstant } from '@financial-manager/domain';

export type Purpose = 'PERSONAL' | 'BUSINESS' | 'OTHER';
export type LocalWorkspace = Readonly<{
  id: string;
  display_name: string;
  purpose: Purpose;
  storage_mode: 'LOCAL';
  default_currency: 'BRL';
  created_at: string;
}>;
export type CreateLocalWorkspace = Readonly<{
  workspace_id: string;
  display_name: string;
  purpose: Purpose;
}>;
export interface LocalWorkspaceGateway {
  list(): Promise<readonly LocalWorkspace[]>;
  create(input: CreateLocalWorkspace): Promise<LocalWorkspace>;
  open(id: string): Promise<LocalWorkspace>;
}
export class LocalWorkspaceError extends Error {
  constructor(readonly code: string) {
    super('LOCAL_WORKSPACE_OPERATION_FAILED');
  }
}
const codes = [
  'INVALID_WORKSPACE',
  'STORAGE_UNAVAILABLE',
  'INSTALLATION_BUSY',
  'KEY_MISSING',
  'INTEGRITY_FAILURE',
  'UNSUPPORTED_SCHEMA',
  'NOT_FOUND',
  'REQUEST_CONFLICT',
  'LOCAL_LOCKED',
];
export function decodeLocalWorkspace(value: unknown): LocalWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalWorkspaceError('INVALID_RESPONSE');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !==
      [
        'id',
        'display_name',
        'purpose',
        'storage_mode',
        'default_currency',
        'created_at',
      ]
        .sort()
        .join(',') ||
    typeof row.display_name !== 'string' ||
    !row.display_name.trim() ||
    row.display_name.length > 120 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(row.display_name) ||
    !['PERSONAL', 'BUSINESS', 'OTHER'].includes(String(row.purpose)) ||
    row.storage_mode !== 'LOCAL' ||
    row.default_currency !== 'BRL'
  )
    throw new LocalWorkspaceError('INVALID_RESPONSE');
  try {
    resourceId(row.id);
    utcInstant(row.created_at);
  } catch {
    throw new LocalWorkspaceError('INVALID_RESPONSE');
  }
  return Object.freeze({
    id: row.id as string,
    display_name: row.display_name,
    purpose: row.purpose as Purpose,
    storage_mode: 'LOCAL',
    default_currency: 'BRL',
    created_at: row.created_at as string,
  });
}
export function createLocalWorkspaceGateway(): LocalWorkspaceGateway | null {
  if (!isTauri()) return null;
  const call = async (command: string, args?: Record<string, unknown>) => {
    try {
      return await invoke<unknown>(command, args);
    } catch (error) {
      throw new LocalWorkspaceError(
        typeof error === 'string' && codes.includes(error)
          ? error
          : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    async list() {
      const value = await call('list_local_workspaces');
      if (!Array.isArray(value))
        throw new LocalWorkspaceError('INVALID_RESPONSE');
      const result = value.map(decodeLocalWorkspace);
      if (new Set(result.map((row) => row.id)).size !== result.length)
        throw new LocalWorkspaceError('INVALID_RESPONSE');
      return Object.freeze(result);
    },
    async create(input: CreateLocalWorkspace) {
      const captured = Object.freeze({ ...input });
      const result = decodeLocalWorkspace(
        await call('create_local_workspace', { input: captured }),
      );
      if (result.id !== captured.workspace_id)
        throw new LocalWorkspaceError('INVALID_RESPONSE');
      return result;
    },
    async open(id: string) {
      const result = decodeLocalWorkspace(
        await call('open_local_workspace', { workspaceId: id }),
      );
      if (result.id !== id) throw new LocalWorkspaceError('INVALID_RESPONSE');
      return result;
    },
  });
}
export function localWorkspaceMessage(error: unknown): string {
  const code = error instanceof LocalWorkspaceError ? error.code : '';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo está bloqueado. Desbloqueie com o PIN para continuar.';
  if (code === 'KEY_MISSING')
    return 'A chave deste espaço não está disponível neste perfil Windows. Nenhum dado foi substituído.';
  if (code === 'INSTALLATION_BUSY')
    return 'O armazenamento local está aberto em outra instância do aplicativo. Feche-a e tente novamente.';
  if (code === 'REQUEST_CONFLICT')
    return 'Esta tentativa já criou um espaço com outros dados. Volte à lista para conferir.';
  return 'Não foi possível acessar o espaço local. Seus dados existentes foram preservados. Tente novamente.';
}
