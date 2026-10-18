import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ClassificationFilter } from '@financial-manager/domain/classification';
import type { RevisionState } from '@financial-manager/domain/revisions';
import {
  LocalMovementError,
  localMovementMessage,
  movementKindLabel,
} from './local-movements.js';
import { formatBrlMinor } from './local-accounts.js';
const LocalClassificationFlow = lazy(() =>
  import('./local-classification-flow.js').then((m) => ({
    default: m.LocalClassificationFlow,
  })),
);
import {
  classificationRows,
  classificationReferenceName,
  createLocalClassificationFiltersGateway,
  emptyClassificationFilter,
} from './local-classification-filters.js';
import type { ClassificationSnapshot } from './local-classification-filters.js';
export function LocalClassificationFiltersFlow({
  workspaceId,
  onLocked,
  onClose,
  initialTransactionId = '',
}: {
  workspaceId: string;
  onLocked: () => void;
  onClose: () => void;
  initialTransactionId?: string;
}) {
  const [editing, setEditing] = useState(false),
    [notice, setNotice] = useState('');
  const [gateway] = useState(createLocalClassificationFiltersGateway),
    [snapshot, setSnapshot] = useState<ClassificationSnapshot | null>(null),
    [busy, setBusy] = useState(Boolean(gateway)),
    [error, setError] = useState(''),
    [query, setQuery] = useState<ClassificationFilter>(
      emptyClassificationFilter,
    ),
    [accountId, setAccountId] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [selected, setSelected] = useState<RevisionState | null>(null);
  const alive = useRef(true),
    first = useRef(true),
    pending = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [workspaceId, gateway]);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [busy, selected]);
  const result = useMemo(() => {
    if (!snapshot || (from && to && from > to)) return [];
    return classificationRows(
      workspaceId,
      snapshot,
      query,
      accountId,
      from,
      to,
    );
  }, [workspaceId, snapshot, query, accountId, from, to]);
  async function refresh() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setSnapshot(null);
    setError('');
    setSelected(null);
    setNotice('');
    try {
      const next = await gateway.read(workspaceId);
      if (alive.current) {
        setSnapshot(next);
        setQuery(emptyClassificationFilter);
        setAccountId('');
        setFrom('');
        setTo('');
        if (first.current && initialTransactionId)
          setSelected(
            next.movements.transactions.find(
              (r) => r.id === initialTransactionId && !r.content.deleted,
            ) ?? null,
          );
        first.current = false;
      }
    } catch (failure) {
      if (alive.current) {
        setError(
          failure instanceof LocalMovementError &&
            ['LOCAL_LOCKED', 'MOVEMENT_LIMIT', 'KEY_MISSING'].includes(
              failure.code,
            )
            ? localMovementMessage(failure)
            : 'Não foi possível consultar a classificação. Atualize a consulta para tentar novamente.',
        );
        if (
          failure instanceof LocalMovementError &&
          failure.code === 'LOCAL_LOCKED'
        )
          onLocked();
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const catalog = snapshot?.catalog,
    categories = catalog?.categories ?? [],
    subcategories =
      catalog?.items.filter(
        (r) =>
          r.kind === 'SUBCATEGORY' &&
          (!query.category_id || r.category_id === query.category_id),
      ) ?? [],
    tags = catalog?.items.filter((r) => r.kind === 'TAG') ?? [],
    name = (kind: 'CATEGORY' | 'SUBCATEGORY' | 'TAG', id: string) =>
      classificationReferenceName(snapshot, kind, id),
    accountName = (id: string) =>
      snapshot?.movements.balance.accounts.find((r) => r.account.id === id)
        ?.account.name ?? 'Conta indisponível';
  const historySummary = (state: RevisionState) =>
    (state.content.allocations
      .map(
        (a) =>
          name('CATEGORY', a.category_id) +
          (a.subcategory_id
            ? ' / ' + name('SUBCATEGORY', a.subcategory_id)
            : '') +
          ' — ' +
          formatBrlMinor(a.amount_minor) +
          (a.note ? ' · ' + a.note : ''),
      )
      .join('; ') || 'Sem classificação monetária') +
    ' · Tags: ' +
    (state.content.tag_ids.map((id) => name('TAG', id)).join(', ') ||
      'sem tags');
  if (editing && snapshot && selected)
    return (
      <Suspense
        fallback={
          <section className="account-flow" aria-busy="true">
            <h2>Abrindo editor de classificação</h2>
            <p role="status">Aguarde.</p>
          </section>
        }
      >
        <LocalClassificationFlow
          key={workspaceId + ':' + selected.id + ':' + selected.version}
          snapshot={snapshot}
          transactionId={selected.id}
          onLocked={onLocked}
          onCancel={() => setEditing(false)}
          onReviewed={(next, result) => {
            setSnapshot(next);
            setSelected(
              next.movements.transactions.find(
                (r) => r.id === selected.id && !r.content.deleted,
              ) ?? null,
            );
            setEditing(false);
            setNotice(
              result === 'SAVED'
                ? 'Classificação registrada. Valores e saldos foram preservados.'
                : result === 'UNCHANGED'
                  ? 'A classificação já confere.'
                  : 'Consulta atualizada. Confira o resultado antes de iniciar outra alteração.',
            );
          }}
        />
      </Suspense>
    );
  return (
    <section
      className="account-flow classification-filters-flow"
      aria-label="Filtros de classificação"
      aria-busy={busy}
    >
      <h2 ref={heading} tabIndex={-1}>
        {selected
          ? 'Classificação da movimentação'
          : 'Filtrar movimentações por classificação'}
      </h2>
      <p>
        Consulte transações inteiras. Tags podem se sobrepor; seus resultados
        não são partes aditivas do orçamento. Transferências e pagamentos
        continuam com sua natureza econômica.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && (
        <p role="status">Lendo movimentações e catálogo do espaço local.</p>
      )}
      {!gateway && (
        <p>Abra o aplicativo Desktop para consultar o cofre local.</p>
      )}
      <button
        type="button"
        disabled={busy || !gateway}
        onClick={() => void refresh()}
      >
        Atualizar consulta de classificação
      </button>
      {snapshot && (
        <>
          <p>
            Leitura completa deste espaço local em{' '}
            {new Date(snapshot.movements.balance.read_at).toLocaleString(
              'pt-BR',
            )}
            . A leitura abrange todos os períodos; os critérios delimitam os
            resultados. Registros excluídos são omitidos. Limites excedidos
            recusam a consulta inteira.
          </p>
          {selected ? (
            <>
              <h3>{selected.content.display_name}</h3>
              <p>
                {selected.content.financial_date} ·{' '}
                {accountName(selected.content.account_id)} ·{' '}
                {movementKindLabel(selected.content.economic_kind)} · versão{' '}
                {selected.version}
              </p>
              <p>
                Variação na conta:{' '}
                {formatBrlMinor(selected.content.account_amount_minor)}. Origem:{' '}
                {selected.content.origin_kind}.
              </p>
              <p>
                Descrição original:{' '}
                {selected.content.original_description ?? 'Não informada'}.
              </p>
              <h3>Classificação monetária</h3>
              {!selected.content.allocations.length ? (
                <p>Sem classificação monetária.</p>
              ) : (
                <ul>
                  {selected.content.allocations.map((a) => (
                    <li key={a.id}>
                      {name('CATEGORY', a.category_id)}
                      {a.subcategory_id
                        ? ' / ' + name('SUBCATEGORY', a.subcategory_id)
                        : ''}
                      : {formatBrlMinor(a.amount_minor)}
                      {a.note ? ' · ' + a.note : ''}
                    </li>
                  ))}
                </ul>
              )}
              <h3>Tags</h3>
              {!selected.content.tag_ids.length ? (
                <p>Sem tags.</p>
              ) : (
                <ul>
                  {selected.content.tag_ids.map((id) => (
                    <li key={id}>{name('TAG', id)}</li>
                  ))}
                </ul>
              )}
              <p>Volte aos resultados para consultar outras classificações.</p>
              <button
                type="button"
                onClick={() => {
                  setNotice('');
                  setEditing(true);
                }}
              >
                Editar classificação e tags
              </button>
              <h3>Histórico da movimentação</h3>
              <ol className="movement-history">
                {snapshot.movements.history
                  .filter((r) => r.transaction_id === selected.id)
                  .map((r) => (
                    <li key={r.id}>
                      <p>
                        Versão {r.version} ·{' '}
                        {new Date(r.created_at).toLocaleString('pt-BR')} ·{' '}
                        {r.change_source}
                      </p>
                      {r.compatible && r.snapshot ? (
                        <details>
                          <summary>
                            Ver classificação da versão {r.version}
                          </summary>
                          <p>
                            Antes:{' '}
                            {r.snapshot.before
                              ? historySummary(r.snapshot.before)
                              : 'Registro ainda não existia'}
                          </p>
                          <p>Depois: {historySummary(r.snapshot.after)}</p>
                        </details>
                      ) : (
                        <p>
                          Histórico legado preservado; este formato não é
                          interpretado nesta versão.
                        </p>
                      )}
                    </li>
                  ))}
              </ol>
              {!snapshot.movements.history.some(
                (r) => r.transaction_id === selected.id,
              ) && <p>Nenhuma revisão disponível nesta consulta.</p>}
              <button type="button" onClick={() => setSelected(null)}>
                Voltar aos resultados
              </button>
            </>
          ) : (
            <>
              <fieldset>
                <legend>Critérios da consulta</legend>
                <label htmlFor="classification-account">
                  Conta da consulta
                </label>
                <select
                  id="classification-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Todas as contas</option>
                  {snapshot.movements.balance.accounts.map((r) => (
                    <option key={r.account.id} value={r.account.id}>
                      {r.account.name}
                      {r.account.status === 'ARCHIVED' ? ' — Arquivada' : ''}
                    </option>
                  ))}
                </select>
                <label htmlFor="classification-from">A partir de</label>
                <input
                  type="date"
                  id="classification-from"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <label htmlFor="classification-to">Até a data</label>
                <input
                  type="date"
                  id="classification-to"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <label className="backup-ack">
                  <input
                    type="checkbox"
                    checked={query.unclassified_only}
                    onChange={(e) =>
                      setQuery({
                        ...query,
                        unclassified_only: e.target.checked,
                        category_id: null,
                        subcategory_id: null,
                      })
                    }
                  />
                  Somente sem classificação monetária
                </label>
                <label htmlFor="classification-category">
                  Categoria da consulta
                </label>
                <select
                  id="classification-category"
                  disabled={query.unclassified_only}
                  value={query.category_id ?? ''}
                  onChange={(e) =>
                    setQuery({
                      ...query,
                      category_id: e.target.value || null,
                      subcategory_id: null,
                    })
                  }
                >
                  <option value="">Todas as categorias</option>
                  {categories.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.status === 'ARCHIVED' ? ' — Arquivada' : ''}
                    </option>
                  ))}
                </select>
                <label htmlFor="classification-subcategory">
                  Subcategoria da consulta
                </label>
                <select
                  id="classification-subcategory"
                  disabled={query.unclassified_only}
                  value={query.subcategory_id ?? ''}
                  onChange={(e) =>
                    setQuery({
                      ...query,
                      subcategory_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">Todas as subcategorias</option>
                  {subcategories.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {!query.category_id && r.kind === 'SUBCATEGORY'
                        ? ' / ' + name('CATEGORY', r.category_id)
                        : ''}
                      {r.status === 'ARCHIVED' ? ' — Arquivada' : ''}
                    </option>
                  ))}
                </select>
                <label htmlFor="classification-tag-match">
                  Combinação de tags
                </label>
                <select
                  id="classification-tag-match"
                  value={query.tag_match}
                  onChange={(e) =>
                    setQuery({
                      ...query,
                      tag_match: e.target.value as 'ANY' | 'ALL',
                    })
                  }
                >
                  <option value="ANY">Qualquer tag selecionada</option>
                  <option value="ALL">Todas as tags selecionadas</option>
                </select>
                <fieldset>
                  <legend>Tags da consulta</legend>
                  {!tags.length && <p>Nenhuma tag cadastrada neste espaço.</p>}
                  {tags.map((r) => (
                    <label className="backup-ack" key={r.id}>
                      <input
                        type="checkbox"
                        checked={query.tag_ids.includes(r.id)}
                        onChange={(e) =>
                          setQuery({
                            ...query,
                            tag_ids: e.target.checked
                              ? [...query.tag_ids, r.id]
                              : query.tag_ids.filter((id) => id !== r.id),
                          })
                        }
                      />
                      {r.name}
                      {r.status === 'ARCHIVED' ? ' — Arquivada' : ''}
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(emptyClassificationFilter);
                    setAccountId('');
                    setFrom('');
                    setTo('');
                  }}
                >
                  Limpar critérios
                </button>
              </fieldset>
              {from && to && from > to ? (
                <p role="alert">Confira a ordem das datas.</p>
              ) : (
                <>
                  <p role="status">
                    {result.length} movimentações encontradas. Cada transação
                    aparece uma vez, mesmo com várias parcelas ou tags.
                  </p>
                  {!result.length && (
                    <p>Nenhuma movimentação corresponde aos critérios.</p>
                  )}
                  <ul className="local-list classification-results">
                    {result.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => setSelected(s)}>
                          {s.content.display_name} —{' '}
                          {formatBrlMinor(s.content.account_amount_minor)}
                          <br />
                          {s.content.financial_date} ·{' '}
                          {accountName(s.content.account_id)} ·{' '}
                          {movementKindLabel(s.content.economic_kind)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
      <button type="button" onClick={onClose}>
        Voltar às movimentações
      </button>
    </section>
  );
}
