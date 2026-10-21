import { useEffect, useRef, useState } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import {
  defaultImportQuery,
  importStatuses,
} from '@financial-manager/domain/imports';
import type {
  ImportQuery,
  ImportStatus,
} from '@financial-manager/domain/imports';
import { createLocalAccountsGateway } from './local-accounts.js';
import type { AccountsSnapshot } from './local-accounts.js';
import {
  createLocalImportsGateway,
  importStatusLabels,
  LocalImportError,
  localImportMessage,
} from './local-imports.js';
import type {
  ImportPage,
  ImportDetail,
  PrepareImport,
} from './local-imports.js';
export function LocalImportsFlow({
  workspaceId,
  onLocked,
  onMovement,
}: {
  workspaceId: string;
  onLocked: () => void;
  onMovement: (id: string) => void;
}) {
  const [gateway] = useState(createLocalImportsGateway),
    [accountsGateway] = useState(createLocalAccountsGateway);
  const [accounts, setAccounts] = useState<AccountsSnapshot | null>(null),
    [page, setPage] = useState<ImportPage | null>(null),
    [detail, setDetail] = useState<ImportDetail | null>(null);
  const [query, setQuery] = useState<ImportQuery>(defaultImportQuery),
    [account, setAccount] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<PrepareImport | null>(null);
  const alive = useRef(true),
    ticket = useRef(0),
    working = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ticket.current++;
      working.current = false;
    };
  }, []);
  function fail(e: unknown) {
    if (!alive.current) return;
    setError(localImportMessage(e));
    if (
      (e instanceof LocalImportError && e.code === 'LOCAL_LOCKED') ||
      (e instanceof Error && 'code' in e && e.code === 'LOCAL_LOCKED')
    ) {
      setPage(null);
      setAccounts(null);
      setDetail(null);
      setPending(null);
      onLocked();
    }
  }
  async function run(action: (token: number) => Promise<void>) {
    if (working.current) return;
    const token = ++ticket.current;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await action(token);
    } catch (e) {
      if (token === ticket.current) fail(e);
    } finally {
      if (token === ticket.current) {
        working.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  async function load(q: ImportQuery) {
    if (!gateway || !accountsGateway) return;
    await run(async (t) => {
      const [p, a] = await Promise.all([
        gateway.list(workspaceId, q),
        accountsGateway.read(workspaceId),
      ]);
      if (alive.current && t === ticket.current) {
        setPage(p);
        setAccounts(a);
        setQuery(q);
        setDetail(null);
      }
    });
  }
  useEffect(() => {
    void load(defaultImportQuery);
  }, []);
  async function open(id: string, after: string | null = null) {
    if (!gateway) return;
    await run(async (t) => {
      const d = await gateway.detail(workspaceId, {
        id,
        effect_after: after,
        effect_limit: 50,
      });
      if (alive.current && t === ticket.current) setDetail(d);
    });
  }
  async function prepare() {
    if (!gateway || working.current || (!account && !pending)) return;
    let c: PrepareImport;
    try {
      c =
        pending ??
        Object.freeze({
          id: createCryptoIdentity(globalThis.crypto, Date.now).newId(),
          target_account_id: account,
        });
    } catch (error) {
      fail(error);
      return;
    }
    setPending(c);
    await run(async (t) => {
      const result = await gateway.prepare(workspaceId, c);
      if (!alive.current || t !== ticket.current) return;
      setPending(null);
      const d = await gateway.detail(workspaceId, {
        id: result.batch.id,
        effect_after: null,
        effect_limit: 50,
      });
      if (alive.current && t === ticket.current) setDetail(d);
    });
  }
  const name = (id: string | null) =>
    accounts?.accounts.find((a) => a.account.id === id)?.account.name ??
    (id ? 'Conta indisponível' : 'Todas as contas');
  return (
    <section className="local-empty local-imports" aria-busy={busy}>
      <h2>Importações</h2>
      {!gateway && (
        <p role="status">
          Use o aplicativo Desktop para consultar e preparar importações locais.
        </p>
      )}
      {busy && <p role="status">Consultando importações…</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <p role="status">
          Pedido pendente de confirmação. Repita o mesmo pedido antes de iniciar
          outra preparação.
        </p>
      )}
      <button
        type="button"
        disabled={busy || !gateway}
        onClick={() => void load({ ...query, cursor: null })}
      >
        Atualizar histórico
      </button>
      {detail ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDetail(null);
              void load({ ...query, cursor: null });
            }}
          >
            Voltar aos lotes
          </button>
          <h3>Detalhes do lote</h3>
          <p>
            {importStatusLabels[detail.batch.status]} ·{' '}
            {name(detail.batch.target_account_id)}
          </p>
          <dl>
            <dt>Lote</dt>
            <dd>{detail.batch.id}</dd>
            <dt>Criado em</dt>
            <dd>{new Date(detail.batch.created_at).toLocaleString('pt-BR')}</dd>
            <dt>Autor</dt>
            <dd>
              {detail.batch.created_by_member_id ?? 'Local, sem conta na nuvem'}
            </dd>
            <dt>Versão</dt>
            <dd>{detail.batch.version}</dd>
            <dt>Itens</dt>
            <dd>{detail.counts.total_items}</dd>
            <dt>Efeitos</dt>
            <dd>{detail.counts.total_effects}</dd>
          </dl>
          {detail.batch.failure_code && (
            <p>Falha: {detail.batch.failure_code}</p>
          )}
          {detail.batch.reverses_batch_id && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void open(detail.batch.reverses_batch_id!)}
            >
              Consultar lote de origem
            </button>
          )}
          <h3>Fontes</h3>
          {!detail.sources.length ? (
            <p>Arquivo ainda não selecionado.</p>
          ) : (
            <ul>
              {detail.sources.map((s) => (
                <li key={s.id}>
                  <strong>{s.file_name}</strong>
                  <p>
                    {s.format} · {s.parser_name ?? 'Leitor pendente'}{' '}
                    {s.parser_version ?? ''}
                  </p>
                  <p>
                    Período: {s.period_start ?? 'não informado'} a{' '}
                    {s.period_end ?? 'não informado'}
                  </p>
                  <p>Identificador do arquivo: {s.file_hash}</p>
                </li>
              ))}
            </ul>
          )}
          <h3>Resultados</h3>
          <dl>
            {Object.entries(detail.counts.items).map(([k, v]) => (
              <div key={k}>
                <dt>
                  {
                    (
                      {
                        NEW: 'Novos',
                        DUPLICATE: 'Duplicados',
                        POSSIBLE_DUPLICATE: 'Possíveis duplicados',
                        UPDATE: 'Atualizações',
                        INVALID: 'Inválidos',
                        SKIPPED: 'Ignorados',
                        COMMITTED: 'Confirmados',
                      } as Record<string, string>
                    )[k]
                  }
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h3>Movimentações afetadas</h3>
          {!detail.effects.length ? (
            <p>Nenhuma movimentação nesta página.</p>
          ) : (
            <ul>
              {detail.effects.map((e) => (
                <li key={e.id}>
                  <p>
                    {
                      {
                        CREATE: 'Criação',
                        UPDATE: 'Atualização',
                        LINK: 'Vínculo',
                        UNLINK: 'Remoção de vínculo',
                        RESTORE: 'Restauração',
                        DELETE: 'Exclusão',
                      }[e.action]
                    }
                  </p>
                  <button
                    type="button"
                    onClick={() => onMovement(e.transaction_id)}
                  >
                    Ver movimentação e histórico
                  </button>
                  <p>
                    Revisão anterior: {e.before_revision_id ?? 'nenhuma'} ·
                    Revisão resultante: {e.after_revision_id ?? 'nenhuma'}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {detail.next_effect_cursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void open(detail.batch.id, detail.next_effect_cursor)
              }
            >
              Próximos efeitos
            </button>
          )}
        </>
      ) : (
        <>
          <label htmlFor="import-account-filter">Conta do histórico</label>
          <select
            id="import-account-filter"
            disabled={busy}
            value={query.account_id ?? ''}
            onChange={(e) =>
              void load({
                ...query,
                account_id: e.target.value || null,
                cursor: null,
              })
            }
          >
            <option value="">Todas as contas</option>
            {accounts?.accounts.map((a) => (
              <option key={a.account.id} value={a.account.id}>
                {a.account.name}
                {a.account.status === 'ARCHIVED' ? ' (arquivada)' : ''}
              </option>
            ))}
          </select>
          <label htmlFor="import-status-filter">Estado do lote</label>
          <select
            id="import-status-filter"
            disabled={busy}
            value={query.statuses[0] ?? ''}
            onChange={(e) =>
              void load({
                ...query,
                statuses: e.target.value
                  ? [e.target.value as ImportStatus]
                  : [],
                cursor: null,
              })
            }
          >
            <option value="">Todos os estados</option>
            {importStatuses.map((s) => (
              <option key={s} value={s}>
                {importStatusLabels[s]}
              </option>
            ))}
          </select>
          {page && !page.items.length && (
            <p>Nenhum lote encontrado para estes filtros.</p>
          )}
          <ul>
            {page?.items.map((s) => (
              <li key={s.batch.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void open(s.batch.id)}
                >
                  {importStatusLabels[s.batch.status]} ·{' '}
                  {name(s.batch.target_account_id)} ·{' '}
                  {s.sources[0]?.file_name ?? 'Arquivo ainda não selecionado'}
                </button>
                <p>
                  {s.counts.total_items} itens · {s.counts.total_effects}{' '}
                  efeitos ·{' '}
                  {new Date(s.batch.created_at).toLocaleString('pt-BR')}
                </p>
              </li>
            ))}
          </ul>
          {page?.next_cursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void load({ ...query, cursor: page.next_cursor })}
            >
              Próximos lotes
            </button>
          )}
          <h3>Preparar importação</h3>
          <p>
            Escolha a conta de destino. A seleção e a revisão de arquivos serão
            disponibilizadas na próxima etapa.
          </p>
          <label htmlFor="import-target-account">Conta de destino</label>
          <select
            id="import-target-account"
            disabled={busy || !!pending}
            value={pending?.target_account_id ?? account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Selecione uma conta ativa</option>
            {accounts?.accounts
              .filter((a) => a.account.status === 'ACTIVE')
              .map((a) => (
                <option key={a.account.id} value={a.account.id}>
                  {a.account.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy || !gateway || (!pending && !account)}
            onClick={() => void prepare()}
          >
            {pending ? 'Repetir mesmo pedido' : 'Preparar lote'}
          </button>
        </>
      )}
    </section>
  );
}
