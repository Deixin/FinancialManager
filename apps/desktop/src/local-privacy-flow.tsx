import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LocalWorkspaceFlow } from './local-workspace-flow.js';
import {
  createPrivacyGateway,
  privacyMessage,
  helloAvailabilityMessage,
} from './local-privacy.js';
import type { LockStatus } from './local-privacy.js';
import type { LocalWorkspace } from './local-workspaces.js';
import { LocalBackupFlow, LocalBackupPending } from './local-backup-flow.js';
import { createBackupGateway, backupMessage } from './local-backup.js';
import { createRestoreGateway, restoreMessage } from './local-restore.js';
import type { RestorePreview } from './local-restore.js';
import { LocalRestoreFlow } from './local-restore-flow.js';
export function LocalPrivacyFlow({ onExit }: { onExit: () => void }) {
  const [gateway] = useState(createPrivacyGateway);
  const [backups] = useState(createBackupGateway);
  const [restores] = useState(createRestoreGateway);
  const [restoredWorkspaceId, setRestoredWorkspaceId] = useState<string | null>(
    null,
  );
  const [restoreSelection, setRestoreSelection] = useState<string | null>(null),
    [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null),
    [restoreBusy, setRestoreBusy] = useState<
      'selecting' | 'validating' | 'restoring' | null
    >(null);
  const [backupWorkspace, setBackupWorkspace] = useState<LocalWorkspace | null>(
    null,
  );
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [settings, setSettings] = useState(false),
    [busy, setBusy] = useState(Boolean(gateway));
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [retryLeft, setRetryLeft] = useState(0);
  const [pin, setPin] = useState(''),
    [nextPin, setNextPin] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const epoch = useRef(0),
    alive = useRef(true),
    pending = useRef(false),
    helloPending = useRef(false),
    backupPending = useRef(false),
    restorePickerPending = useRef(false),
    restorePending = useRef(false),
    current = useRef<LockStatus | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  function clearPins() {
    setPin('');
    setNextPin('');
    setConfirmation('');
  }
  function accept(next: LockStatus) {
    current.current = next;
    setStatus(next);
  }
  async function refresh() {
    if (!gateway || pending.current) return;
    const token = ++epoch.current;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      // Every new entry/retry closes the native session, even if a prior exit lost its IPC request.
      const next = await gateway.lock();
      if (alive.current && epoch.current === token) accept(next);
    } catch (reason) {
      if (alive.current && epoch.current === token) {
        setStatus(null);
        setError(privacyMessage(reason));
      }
    } finally {
      if (epoch.current === token) pending.current = false;
      if (alive.current && epoch.current === token) setBusy(false);
    }
  }
  function lockNow() {
    if (
      !gateway ||
      !current.current ||
      (!current.current.enabled &&
        !backupPending.current &&
        !restorePending.current)
    )
      return;
    const token = ++epoch.current;
    pending.current = false;
    helloPending.current = false;
    backupPending.current = false;
    restorePickerPending.current = false;
    restorePending.current = false;
    setRestoreSelection(null);
    setRestorePreview(null);
    setRestoreBusy(null);
    setBackupWorkspace(null);
    setRestoredWorkspaceId(null);
    // Remove the financial tree immediately; late replies belong to the old epoch.
    accept({ ...current.current, locked: current.current.enabled });
    clearPins();
    setSettings(false);
    setError('');
    setNotice('');
    setBusy(true);
    void gateway
      .lock()
      .then((next) => {
        if (alive.current && epoch.current === token) accept(next);
      })
      .catch((reason) => {
        if (alive.current && epoch.current === token) {
          setStatus(null);
          setError(privacyMessage(reason));
        }
      })
      .finally(() => {
        if (alive.current && epoch.current === token) setBusy(false);
      });
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, [gateway]);
  useEffect(() => {
    // Native consent starts with the financial tree removed. Its owned prompt
    // blurs this window; Rust requires OS success and restored foreground focus.
    const blur = () => {
      if (
        !helloPending.current &&
        !backupPending.current &&
        !restorePickerPending.current
      )
        lockNow();
    };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [gateway]);
  useEffect(() => {
    const remaining = status?.retry_after_seconds ?? 0;
    setRetryLeft(remaining);
    if (!remaining) return;
    const deadline = Date.now() + remaining * 1000;
    const timer = window.setInterval(
      () =>
        setRetryLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      250,
    );
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(() => {
    if (status?.locked || settings || !status) {
      document.title = status?.locked
        ? 'Financial Manager · Bloqueado'
        : 'Financial Manager · Privacidade local';
      if (!busy) heading.current?.focus();
    }
  }, [status?.locked, settings, busy]);
  async function leave() {
    epoch.current++;
    clearPins();
    setStatus(null);
    setBusy(true);
    try {
      await gateway?.lock();
    } catch {
      /* Native lock is requested before leaving the local route. */
    }
    if (alive.current) onExit();
  }
  async function createBackup(password: string, confirmation: string) {
    if (
      !gateway ||
      !backups ||
      !backupWorkspace ||
      pending.current ||
      !current.current
    )
      return;
    const workspaceId = backupWorkspace.id,
      token = ++epoch.current;
    pending.current = true;
    backupPending.current = true;
    setBackupWorkspace(null);
    clearPins();
    accept({ ...current.current, locked: current.current.enabled });
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await backups.create(workspaceId, password, confirmation);
      if (alive.current && epoch.current === token)
        setNotice(
          result.outcome === 'CANCELED'
            ? 'Criação de backup cancelada. Nenhum arquivo de backup foi gravado.'
            : 'Backup criptografado criado e verificado em ' +
                new Date(result.created_at!).toLocaleString('pt-BR') +
                '. Guarde a senha separadamente do arquivo.',
        );
    } catch (reason) {
      if (alive.current && epoch.current === token)
        setError(backupMessage(reason));
    } finally {
      if (alive.current && epoch.current === token) {
        try {
          const next = await gateway.status();
          if (alive.current && epoch.current === token) accept(next);
        } catch {
          if (alive.current && epoch.current === token) setStatus(null);
        }
      }
      if (epoch.current === token) {
        pending.current = false;
        backupPending.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  async function cancelRestoreFlow() {
    const token = ++epoch.current;
    pending.current = true;
    restorePending.current = false;
    restorePickerPending.current = false;
    setRestoreSelection(null);
    setRestorePreview(null);
    setRestoreBusy(null);
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await restores?.cancel();
      const next = await gateway?.status();
      if (next && alive.current && epoch.current === token) accept(next);
    } catch (reason) {
      if (alive.current && epoch.current === token)
        setError(restoreMessage(reason));
    } finally {
      if (epoch.current === token) pending.current = false;
      if (alive.current && epoch.current === token) setBusy(false);
    }
  }
  async function restoreOperation(
    kind: 'selecting' | 'validating' | 'restoring',
    password?: string,
  ) {
    if (!gateway || !restores || pending.current || !current.current) return;
    const token = ++epoch.current;
    pending.current = true;
    restorePending.current = true;
    restorePickerPending.current = kind === 'selecting';
    setBackupWorkspace(null);
    clearPins();
    setRestoreBusy(kind);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (kind === 'selecting') {
        setRestoredWorkspaceId(null);
        setRestoreSelection(null);
        setRestorePreview(null);
        const selection = await restores.select();
        if (alive.current && epoch.current === token) {
          setRestoreSelection(selection);
          if (!selection)
            setNotice(
              'Seleção de backup cancelada. Nenhum espaço foi alterado.',
            );
        }
      } else if (kind === 'validating' && restoreSelection) {
        const preview = await restores.preview(
          restoreSelection,
          password ?? '',
        );
        if (alive.current && epoch.current === token) {
          setRestorePreview(preview);
          setRestoreSelection(null);
        }
      } else if (kind === 'restoring' && restorePreview) {
        const workspace = await restores.confirm(restorePreview.restore_id);
        if (alive.current && epoch.current === token) {
          setRestorePreview(null);
          setRestoreSelection(null);
          setRestoredWorkspaceId(workspace.id);
          setNotice(
            'Restauração concluída. O espaço restaurado está disponível nos espaços locais.',
          );
        }
      }
    } catch (reason) {
      if (alive.current && epoch.current === token)
        setError(restoreMessage(reason));
    } finally {
      if (alive.current && epoch.current === token) {
        try {
          const next = await gateway.status();
          if (alive.current && epoch.current === token) {
            accept(next);
            if (next.locked && kind !== 'selecting') {
              setRestoreSelection(null);
              setRestorePreview(null);
            }
          }
        } catch {
          if (alive.current && epoch.current === token) setStatus(null);
        }
      }
      if (epoch.current === token) {
        pending.current = false;
        restorePending.current = false;
        restorePickerPending.current = false;
        if (alive.current) {
          setRestoreBusy(null);
          setBusy(false);
        }
      }
    }
  }
  async function helloOperation(enabled?: boolean) {
    if (!gateway || pending.current || !current.current?.enabled) return;
    const token = ++epoch.current,
      old = pin;
    pending.current = true;
    helloPending.current = true;
    accept({ ...current.current, locked: true });
    clearPins();
    setSettings(false);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await (enabled === undefined
        ? gateway.unlockHello()
        : gateway.configureHello(old, enabled));
      if (alive.current && epoch.current === token) {
        if (!next.locked && !document.hasFocus()) {
          lockNow();
          return;
        }
        accept(next);
        if (enabled !== undefined)
          setNotice(
            enabled
              ? 'Windows Hello ativado. O PIN do aplicativo continua disponível.'
              : 'Windows Hello desativado. Use o PIN do aplicativo.',
          );
      }
    } catch (reason) {
      if (alive.current && epoch.current === token) {
        setError(privacyMessage(reason));
        try {
          const next = await gateway.status();
          if (alive.current && epoch.current === token) accept(next);
        } catch {
          if (alive.current && epoch.current === token) setStatus(null);
        }
      }
    } finally {
      if (epoch.current === token) {
        pending.current = false;
        helloPending.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  async function operation(
    action: 'unlock' | 'configure' | 'disable',
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!gateway || pending.current) return;
    pending.current = true;
    const token = ++epoch.current;
    const old = pin,
      next = nextPin,
      repeated = confirmation;
    clearPins();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await (action === 'unlock'
        ? gateway.unlock(old)
        : action === 'disable'
          ? gateway.disable(old)
          : gateway.configure(status?.enabled ? old : null, next, repeated));
      if (alive.current && epoch.current === token) {
        accept(result);
        if (action === 'unlock') setSettings(false);
        setNotice(
          action === 'disable'
            ? 'Proteção por PIN desativada.'
            : action === 'configure'
              ? 'PIN configurado.'
              : '',
        );
      }
    } catch (reason) {
      if (alive.current && epoch.current === token) {
        setError(privacyMessage(reason));
        // Authentication and ambiguous writes can close the native session.
        try {
          const result = await gateway.status();
          if (alive.current && epoch.current === token) accept(result);
        } catch {
          if (alive.current && epoch.current === token) setStatus(null);
        }
      }
    } finally {
      if (epoch.current === token) pending.current = false;
      if (alive.current && epoch.current === token) setBusy(false);
    }
  }
  if (!gateway) return <LocalWorkspaceFlow onExit={onExit} />;
  if (backupPending.current) return <LocalBackupPending onCancel={lockNow} />;
  if (restoreBusy)
    return (
      <LocalRestoreFlow
        key={restoreBusy}
        preview={null}
        busy={restoreBusy}
        onPreview={() => {}}
        onConfirm={() => {}}
        onCancel={() => void cancelRestoreFlow()}
      />
    );
  if (status && !status.locked && !settings)
    return (
      <>
        <nav className="privacy-toolbar" aria-label="Proteção local">
          <button
            type="button"
            onClick={() => {
              clearPins();
              setError('');
              setNotice('');
              setSettings(true);
              if (restoreSelection || restorePreview)
                void restores
                  ?.cancel()
                  .catch((reason) => setError(restoreMessage(reason)));
              setRestoreSelection(null);
              setRestorePreview(null);
            }}
          >
            Privacidade local
          </button>
          {status.enabled && (
            <button type="button" onClick={lockNow}>
              Bloquear agora
            </button>
          )}
        </nav>
        {notice && (
          <p className="backup-feedback" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="backup-feedback" role="alert">
            {error}
          </p>
        )}
        {restoreSelection || restorePreview ? (
          <LocalRestoreFlow
            key={restorePreview ? 'preview' : 'password'}
            preview={restorePreview}
            busy={null}
            onPreview={(password) =>
              void restoreOperation('validating', password)
            }
            onConfirm={() => void restoreOperation('restoring')}
            onCancel={() => void cancelRestoreFlow()}
          />
        ) : backupWorkspace ? (
          <LocalBackupFlow
            name={backupWorkspace.display_name}
            onCreate={(password, confirmation) =>
              void createBackup(password, confirmation)
            }
            onBack={() => setBackupWorkspace(null)}
          />
        ) : (
          <LocalWorkspaceFlow
            onExit={() => void leave()}
            initialWorkspaceId={restoredWorkspaceId}
            onLocked={lockNow}
            onRestore={() => void restoreOperation('selecting')}
            onBackup={(workspace) => {
              setRestoredWorkspaceId(null);
              setError('');
              setNotice('');
              setBackupWorkspace(workspace);
            }}
          />
        )}
      </>
    );
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{6,12}"
        minLength={6}
        maxLength={12}
        required
        disabled={busy}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </>
  );
  return (
    <div className="fm-entry">
      <header className="entry-brand">Financial Manager</header>
      <main className="local-main">
        <section
          className="entry-card local-card"
          aria-labelledby="privacy-heading"
        >
          <h1 id="privacy-heading" ref={heading} tabIndex={-1}>
            {!status
              ? 'Verificando proteção local'
              : status.locked
                ? 'Aplicativo bloqueado'
                : 'Privacidade local'}
          </h1>
          {busy && <p role="status">Verificando proteção local…</p>}
          {helloPending.current && (
            <button type="button" onClick={lockNow}>
              Cancelar verificação
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {!status && !busy && (
            <button type="button" onClick={() => void refresh()}>
              Tentar novamente
            </button>
          )}
          {status?.locked ? (
            <>
              <p>
                Digite o PIN deste aplicativo para liberar o acesso aos espaços
                locais desta instalação.
              </p>
              {retryLeft > 0 && (
                <p role="status">
                  Aguarde {retryLeft} segundos e tente novamente.
                </p>
              )}
              <form
                onSubmit={(e) => void operation('unlock', e)}
                aria-busy={busy}
              >
                {field('unlock-pin', 'PIN do aplicativo', pin, setPin)}
                <button
                  className="entry-primary"
                  type="submit"
                  disabled={busy || pin.length < 6 || retryLeft > 0}
                >
                  Desbloquear
                </button>
              </form>
              {status.hello_enabled && (
                <>
                  <p>{helloAvailabilityMessage(status.hello_availability)}</p>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      retryLeft > 0 ||
                      status.hello_availability !== 'AVAILABLE'
                    }
                    onClick={() => void helloOperation()}
                  >
                    Desbloquear com Windows Hello
                  </button>
                  <p>
                    O Windows pode solicitar rosto, digital ou PIN do Windows.
                    Você também pode usar o PIN do aplicativo.
                  </p>
                </>
              )}
              <p>
                Esqueceu o PIN? Não há redefinição nesta etapa. Seus dados não
                serão apagados. O PIN não recupera backups.
              </p>
            </>
          ) : (
            status &&
            settings && (
              <>
                <p>
                  {status.enabled
                    ? 'PIN ativado para todos os espaços locais desta instalação.'
                    : 'PIN opcional desativado. O cofre continua criptografado e a chave protegida pelo Windows.'}
                </p>
                <p>
                  O PIN de 6 a 12 dígitos é deste aplicativo, diferente do PIN
                  do Windows e da senha do backup. Não guardamos o PIN e não há
                  redefinição nesta etapa; anote-o antes de ativar.
                </p>
                <p>
                  Com PIN ativo, o acesso bloqueia ao reiniciar, voltar à
                  entrada ou perder o foco da janela. Você também pode usar
                  Bloquear agora. Após cinco erros, aguarde 30 segundos;
                  reiniciar não zera a espera.
                </p>
                <p>{helloAvailabilityMessage(status.hello_availability)}</p>
                <p>
                  Windows Hello é uma alternativa opcional com rosto, digital ou
                  PIN do Windows. A verificação acontece no Windows. Nenhum dado
                  biométrico ou PIN do Windows é recebido pelo aplicativo. Não
                  recupera backups nem permite alterar o PIN do aplicativo.
                </p>
                {!status.enabled && (
                  <p>
                    Ative primeiro o PIN do aplicativo para habilitar a
                    alternativa Windows Hello.
                  </p>
                )}
                {status.enabled && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void helloOperation(!status.hello_enabled);
                    }}
                    aria-busy={busy}
                  >
                    {field(
                      'hello-pin',
                      'PIN atual para Windows Hello',
                      pin,
                      setPin,
                    )}
                    <button
                      type="submit"
                      disabled={
                        busy ||
                        pin.length < 6 ||
                        (!status.hello_enabled &&
                          status.hello_availability !== 'AVAILABLE')
                      }
                    >
                      {status.hello_enabled
                        ? 'Desativar Windows Hello'
                        : 'Ativar Windows Hello'}
                    </button>
                    <p>
                      Ativar exige o PIN atual e uma confirmação do Windows.
                      Alterar ou desativar o PIN do aplicativo desativa também
                      esta alternativa.
                    </p>
                  </form>
                )}
                <form
                  onSubmit={(e) => void operation('configure', e)}
                  aria-busy={busy}
                >
                  {status.enabled &&
                    field('current-pin', 'PIN atual', pin, setPin)}
                  {field('new-pin', 'Novo PIN', nextPin, setNextPin)}
                  {field(
                    'confirm-pin',
                    'Confirme o novo PIN',
                    confirmation,
                    setConfirmation,
                  )}
                  <button
                    className="entry-primary"
                    type="submit"
                    disabled={
                      busy || nextPin.length < 6 || nextPin !== confirmation
                    }
                  >
                    {status.enabled ? 'Alterar PIN' : 'Ativar PIN'}
                  </button>
                </form>
                {status.enabled && (
                  <form
                    onSubmit={(e) => void operation('disable', e)}
                    aria-busy={busy}
                  >
                    {field(
                      'disable-pin',
                      'PIN atual para desativar',
                      pin,
                      setPin,
                    )}
                    <button
                      className="entry-secondary"
                      type="submit"
                      disabled={busy || pin.length < 6}
                    >
                      Desativar PIN
                    </button>
                  </form>
                )}
                <button
                  className="entry-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    clearPins();
                    setSettings(false);
                  }}
                >
                  Voltar aos espaços locais
                </button>
              </>
            )
          )}
          <button
            className="entry-secondary"
            type="button"
            disabled={busy}
            onClick={() => void leave()}
          >
            Voltar à entrada
          </button>
        </section>
      </main>
    </div>
  );
}
