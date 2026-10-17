import { invoke, isTauri } from '@tauri-apps/api/core';
export type LockStatus = Readonly<{
  enabled: boolean;
  locked: boolean;
  retry_after_seconds: number;
  hello_enabled: boolean;
  hello_availability:
    | 'AVAILABLE'
    | 'UNAVAILABLE'
    | 'NOT_CONFIGURED'
    | 'DISABLED_BY_POLICY'
    | 'DEVICE_BUSY';
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
      'enabled,hello_availability,hello_enabled,locked,retry_after_seconds' ||
    typeof r.enabled !== 'boolean' ||
    typeof r.locked !== 'boolean' ||
    !Number.isInteger(r.retry_after_seconds) ||
    (r.retry_after_seconds as number) < 0 ||
    (r.retry_after_seconds as number) > 30 ||
    typeof r.hello_enabled !== 'boolean' ||
    ![
      'AVAILABLE',
      'UNAVAILABLE',
      'NOT_CONFIGURED',
      'DISABLED_BY_POLICY',
      'DEVICE_BUSY',
    ].includes(r.hello_availability as string) ||
    (!r.enabled && r.hello_enabled) ||
    (!r.enabled && (r.locked || r.retry_after_seconds !== 0))
  )
    throw new LocalPrivacyError('INVALID_RESPONSE');
  return Object.freeze({
    enabled: r.enabled,
    locked: r.locked,
    retry_after_seconds: r.retry_after_seconds as number,
    hello_enabled: r.hello_enabled,
    hello_availability:
      r.hello_availability as LockStatus['hello_availability'],
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
  if (code === 'HELLO_CANCELED')
    return 'Verificação do Windows Hello cancelada. O aplicativo continua bloqueado.';
  if (code === 'HELLO_FAILED')
    return 'O Windows Hello não confirmou sua identidade. O aplicativo continua bloqueado.';
  if (code === 'HELLO_UNAVAILABLE')
    return 'Windows Hello indisponível. Use o PIN do aplicativo para desbloquear.';
  if (code === 'LOCAL_LOCKED')
    return 'O aplicativo continua bloqueado. Volte à janela e tente novamente.';
  return 'Não foi possível concluir a verificação da proteção local. Seus dados foram preservados. Confira o estado antes de continuar.';
}
export function helloAvailabilityMessage(
  value: LockStatus['hello_availability'],
): string {
  switch (value) {
    case 'AVAILABLE':
      return 'Windows Hello disponível neste perfil Windows.';
    case 'NOT_CONFIGURED':
      return 'Configure o Windows Hello nas opções de entrada do Windows para usar esta alternativa.';
    case 'DISABLED_BY_POLICY':
      return 'Windows Hello desativado pela política do Windows.';
    case 'DEVICE_BUSY':
      return 'Windows Hello ocupado. Use o PIN do aplicativo ou tente novamente mais tarde.';
    default:
      return 'Windows Hello indisponível neste dispositivo. Use o PIN do aplicativo.';
  }
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
  configureHello(pin: string, enabled: boolean): Promise<LockStatus>;
  unlockHello(): Promise<LockStatus>;
}
export function createPrivacyGateway(): PrivacyGateway | null {
  if (!isTauri()) return null;
  const codes = [
    'INVALID_PIN',
    'AUTHENTICATION_FAILED',
    'RETRY_LATER',
    'LOCAL_LOCKED',
    'HELLO_CANCELED',
    'HELLO_FAILED',
    'HELLO_UNAVAILABLE',
  ];
  const call = async (command: string, args?: Record<string, unknown>) => {
    try {
      const result = decodeLockStatus(await invoke<unknown>(command, args));
      if (
        (command === 'lock_local_session' &&
          result.enabled &&
          !result.locked) ||
        ([
          'configure_local_pin',
          'unlock_local_session',
          'configure_local_hello',
          'unlock_local_hello',
        ].includes(command) &&
          !result.enabled) ||
        (command === 'unlock_local_hello' && !result.hello_enabled) ||
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
    configureHello: (pin: string, enabled: boolean) =>
      call('configure_local_hello', { input: { pin }, enabled }),
    unlockHello: () => call('unlock_local_hello'),
  });
}
