import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LocalWorkspaceFlow } from './local-workspace-flow.js';
import { createPrivacyGateway, privacyMessage } from './local-privacy.js';
import type { LockStatus } from './local-privacy.js';
export function LocalPrivacyFlow({ onExit }: { onExit: () => void }) {
  const [gateway] = useState(createPrivacyGateway);
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
    if (!gateway || !current.current?.enabled) return;
    const token = ++epoch.current;
    pending.current = false;
    // Remove the financial tree immediately; late replies belong to the old epoch.
    accept({ ...current.current, locked: true });
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
    const blur = () => lockNow();
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
        <LocalWorkspaceFlow onExit={() => void leave()} />
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
                <p>Biometria indisponível nesta versão.</p>
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
