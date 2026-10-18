import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import { categoryDefaults } from '@financial-manager/domain/categories';
import type {
  Category,
  CategoryCommand,
  CategoryScope,
} from '@financial-manager/domain/categories';
import {
  createLocalCategoriesGateway,
  LocalCategoryError,
  localCategoryMessage,
  captureLocalCategory,
} from './local-categories.js';
import type { CategoriesSnapshot } from './local-categories.js';
const scopeLabel = (s: string) =>
  s === 'INCOME'
    ? 'Receita'
    : s === 'EXPENSE'
      ? 'Despesa'
      : 'Receita e despesa';
export function LocalCategoriesFlow({
  workspaceId,
  onBack,
  onLocked,
}: {
  workspaceId: string;
  onBack: () => void;
  onLocked: () => void;
}) {
  const [gateway] = useState(createLocalCategoriesGateway),
    [data, setData] = useState<CategoriesSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [mode, setMode] = useState<'list' | 'create' | 'edit'>('list'),
    [base, setBase] = useState<Category | null>(null),
    [name, setName] = useState(''),
    [scope, setScope] = useState<CategoryScope>('EXPENSE'),
    [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL'),
    [retry, setRetry] = useState(false);
  const alive = useRef(true),
    pending = useRef(false),
    intent = useRef<{
      command: CategoryCommand;
      base: CategoriesSnapshot;
    } | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  function failure(e: unknown) {
    if (e instanceof LocalCategoryError && e.code === 'LOCAL_LOCKED') {
      setData(null);
      intent.current = null;
      onLocked();
      return;
    }
    setError(localCategoryMessage(e));
  }
  async function load() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    intent.current = null;
    setRetry(false);
    setMode('list');
    setBase(null);
    setName('');
    setNotice('');
    setData(null);
    try {
      const d = await gateway.read(workspaceId);
      if (alive.current) setData(d);
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      intent.current = null;
    };
  }, [workspaceId, gateway]);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [busy, mode]);
  async function send(command?: CategoryCommand) {
    if (!gateway || !data || pending.current) return;
    try {
      if (!intent.current) {
        if (!command) return;
        intent.current = Object.freeze({
          command: captureLocalCategory(command, workspaceId),
          base: data,
        });
      }
    } catch (e) {
      failure(e);
      return;
    }
    const frozen = intent.current;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await gateway.apply(
        workspaceId,
        frozen.command,
        frozen.base,
      );
      if (alive.current) {
        setData(
          Object.freeze({ ...frozen.base, categories: result.categories }),
        );
        intent.current = null;
        setRetry(false);
        setMode('list');
        setBase(null);
        setName('');
        setNotice(
          result.changed
            ? 'Catálogo atualizado. O histórico financeiro foi preservado.'
            : 'Esta tentativa já está refletida no catálogo.',
        );
      }
    } catch (e) {
      if (alive.current) {
        setRetry(true);
        failure(e);
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function begin(row?: Category) {
    if (busy || retry) return;
    setBase(row ?? null);
    setName(row?.name ?? '');
    setScope((row?.category_scope as CategoryScope) ?? 'EXPENSE');
    setError('');
    setNotice('');
    setMode(row ? 'edit' : 'create');
  }
  function update(row: Category, status = row.status) {
    return {
      kind: 'UPDATE' as const,
      base: row,
      name: row.name,
      sort_order: row.sort_order,
      status,
    };
  }
  function move(row: Category, direction: number) {
    if (!data) return;
    const bases = data.categories
        .filter((r) => r.status === 'ACTIVE')
        .toSorted(
          (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
        ),
      index = bases.findIndex((r) => r.id === row.id),
      target = index + direction;
    if (target < 0 || target >= bases.length) return;
    const ids = bases.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void send({ kind: 'REORDER', bases, ids });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy || retry) return;
    if (base) void send({ ...update(base), name });
    else
      void send({
        kind: 'CREATE',
        id: createCryptoIdentity(globalThis.crypto, Date.now).newId(),
        name,
        category_scope: scope,
        sort_order: data.categories.filter((r) => r.status === 'ACTIVE').length,
      });
  }
  const rows =
      data?.categories.toSorted(
        (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
      ) ?? [],
    active = rows.filter((r) => r.status === 'ACTIVE');
  return (
    <section
      className="local-empty account-flow category-flow"
      aria-busy={busy}
    >
      <h2 ref={heading} tabIndex={-1}>
        {mode === 'create'
          ? 'Nova categoria'
          : mode === 'edit'
            ? 'Editar categoria'
            : 'Suas categorias'}
      </h2>
      <p>
        As categorias pertencem a este espaço. Arquivar mantém os vínculos e o
        histórico das movimentações.
      </p>
      {!gateway && (
        <p>
          Abra o aplicativo Desktop para acessar as categorias do cofre local.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Aguarde…</p>}
      {retry && (
        <div className="category-actions">
          <button type="button" disabled={busy} onClick={() => void send()}>
            Repetir mesma tentativa
          </button>
          <button type="button" disabled={busy} onClick={() => void load()}>
            Atualizar catálogo e revisar
          </button>
        </div>
      )}
      {data && mode === 'list' && (
        <>
          <div className="category-actions">
            <button
              type="button"
              disabled={busy || retry}
              onClick={() => begin()}
            >
              Nova categoria
            </button>
            <button type="button" disabled={busy} onClick={() => void load()}>
              Atualizar catálogo
            </button>
          </div>
          {!rows.length && (
            <div>
              <p>
                Este espaço ainda não tem categorias. Você pode criar as suas ou
                usar as sugestões para{' '}
                {data.purpose === 'PERSONAL'
                  ? 'uso pessoal'
                  : data.purpose === 'BUSINESS'
                    ? 'empresa'
                    : 'uso geral'}
                .
              </p>
              <ul>
                {categoryDefaults(data.purpose).map((r) => (
                  <li key={r.name}>
                    {r.name} · {scopeLabel(r.category_scope)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || retry}
                onClick={() => {
                  const identity = createCryptoIdentity(
                    globalThis.crypto,
                    Date.now,
                  );
                  void send({
                    kind: 'SEED',
                    purpose: data.purpose,
                    profile_version: 1,
                    ids: categoryDefaults(data.purpose).map(() =>
                      identity.newId(),
                    ),
                  });
                }}
              >
                Usar categorias sugeridas
              </button>
            </div>
          )}
          {!!rows.length && (
            <>
              <label>
                Exibir categorias
                <select
                  value={filter}
                  disabled={busy}
                  onChange={(e) => setFilter(e.target.value as typeof filter)}
                >
                  <option value="ALL">Todas</option>
                  <option value="ACTIVE">Ativas</option>
                  <option value="ARCHIVED">Arquivadas</option>
                </select>
              </label>
              <ul className="category-list">
                {rows
                  .filter((r) => filter === 'ALL' || r.status === filter)
                  .map((row) => (
                    <li className="category-row" key={row.id}>
                      <strong>{row.name}</strong>
                      <span>
                        {scopeLabel(row.category_scope)} ·{' '}
                        {row.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'} ·{' '}
                        {row.is_seeded ? 'Sugestão inicial' : 'Criada por você'}
                      </span>
                      <div className="category-actions">
                        <button
                          type="button"
                          disabled={busy || retry}
                          aria-label={'Editar ' + row.name}
                          onClick={() => begin(row)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={busy || retry}
                          aria-label={
                            (row.status === 'ACTIVE'
                              ? 'Arquivar '
                              : 'Reativar ') + row.name
                          }
                          onClick={() =>
                            void send(
                              update(
                                row,
                                row.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
                              ),
                            )
                          }
                        >
                          {row.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}
                        </button>
                        {row.status === 'ACTIVE' && (
                          <>
                            <button
                              type="button"
                              aria-label={'Subir ' + row.name}
                              disabled={
                                busy || retry || active[0]?.id === row.id
                              }
                              onClick={() => move(row, -1)}
                            >
                              Subir
                            </button>
                            <button
                              type="button"
                              aria-label={'Descer ' + row.name}
                              disabled={
                                busy || retry || active.at(-1)?.id === row.id
                              }
                              onClick={() => move(row, 1)}
                            >
                              Descer
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}
      {data && mode !== 'list' && (
        <form onSubmit={submit}>
          <fieldset disabled={busy || retry}>
            <label>
              Nome da categoria
              <input
                id="category-name"
                value={name}
                required
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {base ? (
              <p>
                Tipo: {scopeLabel(base.category_scope)}. Origem:{' '}
                {base.is_seeded ? 'Sugestão inicial' : 'Criada por você'}.
              </p>
            ) : (
              <label>
                Tipo da categoria
                <select
                  id="category-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as CategoryScope)}
                >
                  <option value="EXPENSE">Despesa</option>
                  <option value="INCOME">Receita</option>
                  <option value="BOTH">Receita e despesa</option>
                </select>
              </label>
            )}
            <button type="submit" disabled={!name.trim()}>
              Salvar categoria
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('list');
                setBase(null);
                setName('');
                setError('');
              }}
            >
              Cancelar edição
            </button>
          </fieldset>
        </form>
      )}
      <button type="button" disabled={busy} onClick={onBack}>
        Voltar às configurações
      </button>
    </section>
  );
}
