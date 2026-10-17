import { LocalAccountsFlow } from './local-accounts-flow.js';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createShellModel } from '@financial-manager/design-tokens';
import { DesktopShell } from './shell.js';
import { createCryptoIdentity } from '@financial-manager/contracts';
import {
  createLocalWorkspaceGateway,
  localWorkspaceMessage,
  LocalWorkspaceError,
} from './local-workspaces.js';
import type {
  LocalWorkspace,
  Purpose,
  CreateLocalWorkspace,
} from './local-workspaces.js';
import '@financial-manager/ui-dom/styles.css';

export function LocalWorkspaceFlow({
  onExit,
  onBackup,
  onRestore,
  initialWorkspaceId,
  onLocked,
}: {
  onExit: () => void;
  onBackup?: (workspace: LocalWorkspace) => void;
  onRestore?: () => void;
  initialWorkspaceId?: string | null;
  onLocked?: () => void;
}) {
  const [gateway] = useState(createLocalWorkspaceGateway);
  const [workspaces, setWorkspaces] = useState<readonly LocalWorkspace[]>([]);
  const [current, setCurrent] = useState<LocalWorkspace | null>(null);
  const [loading, setLoading] = useState(Boolean(gateway));
  const [route, setRoute] = useState<'overview' | 'accounts' | 'settings'>(
    'overview',
  );
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('PERSONAL');
  const [creating, setCreating] = useState(false),
    [catalogReady, setCatalogReady] = useState(false),
    [filter, setFilter] = useState<'local' | 'cloud'>('local');
  const pending = useRef(false),
    alive = useRef(true),
    request = useRef<CreateLocalWorkspace | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function failure(reason: unknown) {
    setError(localWorkspaceMessage(reason));
    if (
      reason instanceof LocalWorkspaceError &&
      reason.code === 'LOCAL_LOCKED'
    ) {
      setCurrent(null);
      setWorkspaces([]);
      setCatalogReady(false);
      onLocked?.();
    }
  }
  function beginCreate() {
    if (loading || !gateway || !catalogReady) return;
    setCurrent(null);
    setRoute('overview');
    setCreating(true);
    setFilter('local');
    setName('');
    setPurpose('PERSONAL');
    setError('');
    request.current = null;
  }
  async function load(initialId?: string) {
    if (!gateway || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    setCurrent(null);
    setWorkspaces([]);
    setCatalogReady(false);
    setCreating(false);
    setFilter('local');
    setRoute('overview');
    try {
      const rows = await gateway.list();
      if (alive.current) {
        setWorkspaces(rows);
        setCatalogReady(true);
        request.current = null;
        if (initialId) {
          if (!rows.some((row) => row.id === initialId))
            throw new LocalWorkspaceError('INVALID_RESPONSE');
          const row = await gateway.open(initialId);
          if (alive.current) setCurrent(row);
        }
      }
    } catch (reason) {
      if (alive.current) failure(reason);
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load(initialWorkspaceId ?? undefined);
  }, [gateway, initialWorkspaceId]);
  useEffect(() => {
    if (!loading) heading.current?.focus();
    document.title = current
      ? 'Financial Manager · ' + current.display_name
      : creating
        ? 'Financial Manager · Novo espaço local'
        : workspaces.length || (gateway && !catalogReady)
          ? 'Financial Manager · Espaços locais'
          : 'Financial Manager · Primeiro espaço';
  }, [loading, current, creating, workspaces.length, gateway, catalogReady]);
  async function open(id: string) {
    if (!gateway || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    setCurrent(null);
    setRoute('overview');
    setCreating(false);
    try {
      const row = await gateway.open(id);
      if (alive.current) setCurrent(row);
    } catch (reason) {
      if (alive.current) failure(reason);
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
      request.current ??= Object.freeze({
        workspace_id: createCryptoIdentity(globalThis.crypto, Date.now).newId(),
        display_name: name.trim(),
        purpose,
      });
      const row = await gateway.create(request.current);
      if (alive.current) {
        setWorkspaces((previous) => [
          ...previous.filter((item) => item.id !== row.id),
          row,
        ]);
        setCurrent(row);
        setRoute('overview');
        setCreating(false);
        request.current = null;
      }
    } catch (reason) {
      if (
        reason instanceof LocalWorkspaceError &&
        reason.code === 'INVALID_WORKSPACE'
      )
        request.current = null;
      if (alive.current) failure(reason);
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
      detail:
        row.purpose === 'PERSONAL'
          ? 'Pessoal'
          : row.purpose === 'BUSINESS'
            ? 'Empresa'
            : 'Outro',
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
          sections: ['overview', 'accounts', 'settings'],
        })}
        workspaces={summaries}
        workspaceActions={
          <>
            <button type="button" onClick={beginCreate}>
              Criar outro espaço local
            </button>
            <button type="button" onClick={() => void load()}>
              Gerenciar espaços locais
            </button>
          </>
        }
        onWorkspaceChange={(id) => void open(id)}
        onNavigate={(next) =>
          setRoute(
            next === 'settings'
              ? 'settings'
              : next === 'accounts'
                ? 'accounts'
                : 'overview',
          )
        }
        footer={
          <button type="button" onClick={onExit}>
            Voltar à entrada
          </button>
        }
      >
        {route === 'accounts' ? (
          <LocalAccountsFlow
            key={current.id}
            workspaceId={current.id}
            onLocked={() => failure(new LocalWorkspaceError('LOCAL_LOCKED'))}
          />
        ) : route === 'settings' ? (
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
            <h3>Contas e movimentações</h3>
            <p>
              Cadastre contas e referências em Contas e cartões. Os dados ficam
              no cofre local, com saldos estimados até confirmar a cobertura do
              histórico. Movimentações serão integradas na próxima etapa.
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
            {creating
              ? 'Novo espaço local'
              : gateway && !catalogReady
                ? 'Espaços locais'
                : workspaces.length
                  ? 'Seus espaços locais'
                  : 'Primeiro espaço'}
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
          {catalogReady && !creating && workspaces.length > 0 && (
            <>
              <p>
                Seus espaços locais são independentes e não têm limite comercial
                de quantidade.
              </p>
              <label htmlFor="workspace-filter">Armazenamento</label>
              <select
                id="workspace-filter"
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as 'local' | 'cloud')
                }
                disabled={loading}
              >
                <option value="local">Local — neste computador</option>
                <option value="cloud">Nuvem</option>
              </select>
              {filter === 'cloud' && (
                <p role="status">
                  Espaços na nuvem exigem conta e estão indisponíveis nesta
                  versão. Seus espaços locais continuam disponíveis sem conta.
                </p>
              )}
            </>
          )}
          {catalogReady &&
          !creating &&
          workspaces.length > 0 &&
          filter === 'local' ? (
            <ul className="local-list">
              {workspaces.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void open(row.id)}
                  >
                    {row.display_name} <span>Local</span>
                    <span>
                      {' '}
                      ·{' '}
                      {row.purpose === 'PERSONAL'
                        ? 'Pessoal'
                        : row.purpose === 'BUSINESS'
                          ? 'Empresa'
                          : 'Outro'}
                    </span>
                    <span>
                      {' '}
                      · Criado em{' '}
                      {new Date(row.created_at).toLocaleString('pt-BR')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : creating ||
            (catalogReady && workspaces.length === 0) ||
            !gateway ? (
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
                disabled={loading || Boolean(request.current)}
                autoComplete="off"
              />
              <label htmlFor="workspace-purpose">Finalidade</label>
              <select
                id="workspace-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as Purpose)}
                disabled={loading || Boolean(request.current)}
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
          ) : null}
          {request.current && error && (
            <p role="status">
              Repita a mesma solicitação ou verifique os espaços locais antes de
              iniciar outra criação.
            </p>
          )}
          {catalogReady &&
            !creating &&
            workspaces.length > 0 &&
            filter === 'local' && (
              <button
                className="entry-primary"
                type="button"
                onClick={beginCreate}
                disabled={loading}
              >
                Criar outro espaço local
              </button>
            )}
          {creating && (
            <button
              type="button"
              className="entry-secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              Cancelar criação
            </button>
          )}
          <button
            type="button"
            className="entry-secondary"
            disabled={loading}
            onClick={onExit}
          >
            Voltar à entrada
          </button>
          {gateway && onRestore && (
            <button
              type="button"
              className="entry-secondary"
              disabled={loading}
              onClick={onRestore}
            >
              Restaurar backup
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
