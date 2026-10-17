import { invoke, isTauri } from '@tauri-apps/api/core';
export type LockStatus = Readonly<{
  enabled: boolean;
  locked: boolean;
  retry_after_seconds: number;
  biometrics: 'UNAVAILABLE';
}>;
export class LocalPrivacyError extends Error {
  constructor(readonly code: string) {
    super('LOCAL_PRIVACY_OPERATION_FAILED');
  }
}
export function decodeLockStatus(value: unknown): LockStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalPrivacyError('INVALID_RESPONSE');
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(',') !==
      'biometrics,enabled,locked,retry_after_seconds' ||
    typeof r.enabled !== 'boolean' ||
    typeof r.locked !== 'boolean' ||
    !Number.isInteger(r.retry_after_seconds) ||
    (r.retry_after_seconds as number) < 0 ||
    (r.retry_after_seconds as number) > 30 ||
    r.biometrics !== 'UNAVAILABLE' ||
    (!r.enabled && (r.locked || r.retry_after_seconds !== 0))
  )
    throw new LocalPrivacyError('INVALID_RESPONSE');
  return Object.freeze({
    enabled: r.enabled,
    locked: r.locked,
    retry_after_seconds: r.retry_after_seconds as number,
    biometrics: 'UNAVAILABLE',
  });
}
export function privacyMessage(error: unknown): string {
  const code = error instanceof LocalPrivacyError ? error.code : '';
  if (code === 'INVALID_PIN')
    return 'Use de 6 a 12 dígitos e confirme o mesmo PIN.';
  if (code === 'AUTHENTICATION_FAILED')
    return 'PIN incorreto. Os dados do cofre foram preservados.';
  if (code === 'RETRY_LATER')
    return 'Aguarde 30 segundos antes de tentar novamente. Se o relógio do computador mudou, confira a data e a hora.';
  return 'Não foi possível concluir a verificação da proteção local. Seus dados foram preservados. Confira o estado antes de continuar.';
}
export interface PrivacyGateway {
  status(): Promise<LockStatus>;
  lock(): Promise<LockStatus>;
  unlock(pin: string): Promise<LockStatus>;
  configure(
    currentPin: string | null,
    newPin: string,
    confirmation: string,
  ): Promise<LockStatus>;
  disable(pin: string): Promise<LockStatus>;
}
export function createPrivacyGateway(): PrivacyGateway | null {
  if (!isTauri()) return null;
  const codes = [
    'INVALID_PIN',
    'AUTHENTICATION_FAILED',
    'RETRY_LATER',
    'LOCAL_LOCKED',
  ];
  const call = async (command: string, args?: Record<string, unknown>) => {
    try {
      const result = decodeLockStatus(await invoke<unknown>(command, args));
      if (
        (command === 'lock_local_session' &&
          result.enabled &&
          !result.locked) ||
        (['configure_local_pin', 'unlock_local_session'].includes(command) &&
          !result.enabled) ||
        (command === 'disable_local_pin' && result.enabled)
      )
        throw new LocalPrivacyError('INVALID_RESPONSE');
      return result;
    } catch (error) {
      if (error instanceof LocalPrivacyError) throw error;
      throw new LocalPrivacyError(
        typeof error === 'string' && codes.includes(error)
          ? error
          : 'STORAGE_UNAVAILABLE',
      );
    }
  };
  return Object.freeze({
    status: () => call('local_lock_status'),
    lock: () => call('lock_local_session'),
    unlock: (pin: string) => call('unlock_local_session', { input: { pin } }),
    configure: (
      currentPin: string | null,
      newPin: string,
      confirmation: string,
    ) =>
      call('configure_local_pin', {
        input: {
          current_pin: currentPin,
          new_pin: newPin,
          confirm_pin: confirmation,
        },
      }),
    disable: (pin: string) => call('disable_local_pin', { input: { pin } }),
  });
}
