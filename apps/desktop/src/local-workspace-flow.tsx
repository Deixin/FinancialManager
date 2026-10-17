import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createShellModel } from '@financial-manager/design-tokens';
import { DesktopShell } from './shell.js';
import { createCryptoIdentity } from '@financial-manager/contracts';
import {
  createLocalWorkspaceGateway,
  localWorkspaceMessage,
} from './local-workspaces.js';
import type { LocalWorkspace, Purpose } from './local-workspaces.js';
import '@financial-manager/ui-dom/styles.css';

export function LocalWorkspaceFlow({
  onExit,
  onBackup,
}: {
  onExit: () => void;
  onBackup?: (workspace: LocalWorkspace) => void;
}) {
  const [gateway] = useState(createLocalWorkspaceGateway);
  const [workspaces, setWorkspaces] = useState<readonly LocalWorkspace[]>([]);
  const [current, setCurrent] = useState<LocalWorkspace | null>(null);
  const [loading, setLoading] = useState(Boolean(gateway));
  const [route, setRoute] = useState<'overview' | 'settings'>('overview');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('PERSONAL');
  const pending = useRef(false),
    alive = useRef(true),
    requestId = useRef<string | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    setCurrent(null);
    try {
      const rows = await gateway.list();
      if (alive.current) setWorkspaces(rows);
    } catch (reason) {
      if (alive.current) setError(localWorkspaceMessage(reason));
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [gateway]);
  useEffect(() => {
    if (!loading) heading.current?.focus();
    document.title = current
      ? 'Financial Manager · ' + current.display_name
      : 'Financial Manager · Primeiro espaço';
  }, [loading, current]);
  async function open(id: string) {
    if (!gateway || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    setCurrent(null);
    try {
      const row = await gateway.open(id);
      if (alive.current) setCurrent(row);
    } catch (reason) {
      if (alive.current) setError(localWorkspaceMessage(reason));
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gateway || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      requestId.current ??= createCryptoIdentity(
        globalThis.crypto,
        Date.now,
      ).newId();
      const row = await gateway.create({
        workspace_id: requestId.current,
        display_name: name.trim(),
        purpose,
      });
      if (alive.current) {
        setWorkspaces((previous) => [
          ...previous.filter((item) => item.id !== row.id),
          row,
        ]);
        setCurrent(row);
      }
    } catch (reason) {
      if (alive.current) setError(localWorkspaceMessage(reason));
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }
  if (current) {
    const summaries = workspaces.map((row) => ({
      id: row.id,
      name: row.display_name,
      mode: 'local' as const,
    }));
    return (
      <DesktopShell
        model={createShellModel({
          surface: 'desktop',
          workspace: {
            id: current.id,
            name: current.display_name,
            mode: 'local',
          },
          route,
          state: 'ready',
          sections: ['overview', 'settings'],
        })}
        workspaces={summaries}
        onWorkspaceChange={(id) => void open(id)}
        onNavigate={(next) =>
          setRoute(next === 'settings' ? 'settings' : 'overview')
        }
        footer={
          <button type="button" onClick={onExit}>
            Voltar à entrada
          </button>
        }
      >
        {route === 'settings' ? (
          <section className="local-empty">
            <h2>Configurações do espaço</h2>
            <p>Nome: {current.display_name}</p>
            <p>
              Finalidade:{' '}
              {current.purpose === 'PERSONAL'
                ? 'Pessoal'
                : current.purpose === 'BUSINESS'
                  ? 'Empresa'
                  : 'Outro'}
            </p>
            <p>
              Armazenamento: Local, neste computador. Nenhuma identidade na
              nuvem está vinculada a este espaço.
            </p>
            {onBackup && (
              <button type="button" onClick={() => onBackup(current)}>
                Backup local
              </button>
            )}
          </section>
        ) : (
          <section className="local-empty">
            <h2 ref={heading} tabIndex={-1}>
              Seu espaço local está pronto
            </h2>
            <p>
              As informações deste espaço ficam neste computador. Você não
              precisa de uma conta na nuvem.
            </p>
            <h3>Nenhuma conta financeira cadastrada</h3>
            <p>
              O cadastro de contas será disponibilizado em uma próxima etapa.
              Seus saldos aparecerão depois de cadastrar uma conta e sua
              referência.
            </p>
            <button type="button" onClick={() => void load()}>
              Ver espaços locais
            </button>
            {onBackup && (
              <button type="button" onClick={() => onBackup(current)}>
                Backup local
              </button>
            )}
          </section>
        )}
      </DesktopShell>
    );
  }
  return (
    <div className="fm-entry">
      <header className="entry-brand">
        <span>Financial Manager</span>
        <span className="entry-badge">Modo local</span>
      </header>
      <main className="local-main">
        <section
          className="entry-card local-card"
          aria-labelledby="local-heading"
        >
          <h1 id="local-heading" ref={heading} tabIndex={-1}>
            {workspaces.length ? 'Seus espaços locais' : 'Primeiro espaço'}
          </h1>
          {loading && <p role="status">Acessando armazenamento local…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load()}
              >
                Verificar espaços locais
              </button>
            </div>
          )}
          {!gateway && (
            <p role="status">
              Para criar e abrir espaços neste computador, use o aplicativo
              Desktop. Esta visualização não salva dados.
            </p>
          )}
          {workspaces.length > 0 ? (
            <ul className="local-list">
              {workspaces.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void open(row.id)}
                  >
                    {row.display_name} <span>Local</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <form onSubmit={(event) => void submit(event)} aria-busy={loading}>
              <p>
                Escolha um nome e uma finalidade. Dados pessoais e fiscais não
                são necessários para começar.
              </p>
              <label htmlFor="workspace-name">Nome do espaço</label>
              <input
                id="workspace-name"
                name="display_name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
                disabled={loading}
                autoComplete="off"
              />
              <label htmlFor="workspace-purpose">Finalidade</label>
              <select
                id="workspace-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as Purpose)}
                disabled={loading}
              >
                <option value="PERSONAL">Pessoal</option>
                <option value="BUSINESS">Empresa</option>
                <option value="OTHER">Outro</option>
              </select>
              <p>
                Armazenamento: <strong>Local — neste computador</strong>
              </p>
              <button
                className="entry-primary"
                type="submit"
                disabled={loading || !gateway || !name.trim()}
              >
                {loading ? 'Criando espaço…' : 'Criar espaço local'}
              </button>
            </form>
          )}
          <button
            type="button"
            className="entry-secondary"
            disabled={loading}
            onClick={onExit}
          >
            Voltar à entrada
          </button>
        </section>
      </main>
    </div>
  );
}
