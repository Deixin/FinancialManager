import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import { filterTaxonomy } from '@financial-manager/domain/taxonomy';
import type {
  TaxonomyItem,
  TaxonomyCommand,
} from '@financial-manager/domain/taxonomy';
import {
  createLocalTaxonomyGateway,
  captureLocalTaxonomy,
  LocalTaxonomyError,
  localTaxonomyMessage,
} from './local-taxonomy.js';
import type { TaxonomySnapshot } from './local-taxonomy.js';
export function LocalTaxonomyFlow({
  workspaceId,
  onBack,
  onLocked,
}: {
  workspaceId: string;
  onBack: () => void;
  onLocked: () => void;
}) {
  const [gateway] = useState(createLocalTaxonomyGateway),
    [data, setData] = useState<TaxonomySnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [retry, setRetry] = useState(false),
    [mode, setMode] = useState<'list' | 'TAG' | 'SUBCATEGORY'>('list'),
    [base, setBase] = useState<TaxonomyItem | null>(null),
    [name, setName] = useState(''),
    [parent, setParent] = useState(''),
    [kind, setKind] = useState<'ALL' | 'TAG' | 'SUBCATEGORY'>('ALL'),
    [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL'),
    [search, setSearch] = useState('');
  const alive = useRef(true),
    pending = useRef(false),
    intent = useRef<{
      command: TaxonomyCommand;
      base: TaxonomySnapshot;
    } | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const reset = () => {
    setMode('list');
    setBase(null);
    setName('');
    setParent('');
  };
  function failure(e: unknown) {
    if (e instanceof LocalTaxonomyError && e.code === 'LOCAL_LOCKED') {
      setData(null);
      intent.current = null;
      onLocked();
      return;
    }
    setError(localTaxonomyMessage(e));
  }
  async function load() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    intent.current = null;
    setRetry(false);
    setData(null);
    reset();
    try {
      const value = await gateway.read(workspaceId);
      if (alive.current) setData(value);
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
  async function send(command?: TaxonomyCommand) {
    if (!gateway || !data || pending.current) return;
    try {
      if (!intent.current) {
        if (!command) return;
        intent.current = Object.freeze({
          command: captureLocalTaxonomy(command, workspaceId),
          base: data,
        });
      }
    } catch (e) {
      failure(e);
      return;
    }
    const captured = intent.current;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await gateway.apply(
        workspaceId,
        captured.command,
        captured.base,
      );
      if (!alive.current) return;
      setData(
        Object.freeze({
          workspace_id: workspaceId,
          categories: result.categories,
          items: result.items,
        }),
      );
      intent.current = null;
      setRetry(false);
      reset();
      setNotice(
        result.changed
          ? 'Catálogo atualizado.'
          : 'A tentativa já está registrada ou não houve alteração.',
      );
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
  function edit(item: TaxonomyItem) {
    if (busy || retry) return;
    setBase(item);
    setMode(item.kind);
    setName(item.name);
    setParent(item.kind === 'SUBCATEGORY' ? item.category_id : '');
    setError('');
    setNotice('');
  }
  function begin(next: 'TAG' | 'SUBCATEGORY') {
    if (busy || retry) return;
    reset();
    setMode(next);
    setError('');
    setNotice('');
    setParent(data?.categories.find((c) => c.status === 'ACTIVE')?.id ?? '');
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!data || mode === 'list' || busy || retry) return;
    const item: TaxonomyItem = base
      ? { ...base, name }
      : mode === 'TAG'
        ? {
            kind: 'TAG',
            id: createCryptoIdentity(globalThis.crypto, Date.now).newId(),
            workspace_id: workspaceId,
            name,
            status: 'ACTIVE',
          }
        : {
            kind: 'SUBCATEGORY',
            id: createCryptoIdentity(globalThis.crypto, Date.now).newId(),
            workspace_id: workspaceId,
            name,
            status: 'ACTIVE',
            category_id: parent,
            sort_order: data.items.filter(
              (r) =>
                r.kind === 'SUBCATEGORY' &&
                r.category_id === parent &&
                r.status === 'ACTIVE',
            ).length,
          };
    void send(base ? { kind: 'UPDATE', base, item } : { kind: 'CREATE', item });
  }
  function move(item: TaxonomyItem, delta: number) {
    if (!data || item.kind !== 'SUBCATEGORY' || busy || retry) return;
    const bases = filterTaxonomy(
        workspaceId,
        { categories: data.categories, items: data.items },
        {
          kind: 'SUBCATEGORY',
          status: 'ACTIVE',
          category_id: item.category_id,
          search: '',
        },
      ).filter(
        (r): r is Extract<TaxonomyItem, { kind: 'SUBCATEGORY' }> =>
          r.kind === 'SUBCATEGORY',
      ),
      ids = bases.map((r) => r.id),
      index = ids.indexOf(item.id),
      target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void send({
      kind: 'REORDER_SUBCATEGORIES',
      category_id: item.category_id,
      bases,
      ids,
    });
  }
  const parents =
      data?.categories.toSorted(
        (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
      ) ?? [],
    parentRank = new Map(parents.map((c, index) => [c.id, index]));
  const rows = data
      ? filterTaxonomy(
          workspaceId,
          { categories: data.categories, items: data.items },
          {
            kind,
            status,
            category_id: null,
            search,
          },
        ).toSorted((a, b) =>
          a.kind === 'SUBCATEGORY' && b.kind === 'SUBCATEGORY'
            ? (parentRank.get(a.category_id) ?? 0) -
              (parentRank.get(b.category_id) ?? 0)
            : 0,
        )
      : [],
    activeParents = parents.filter((c) => c.status === 'ACTIVE');
  return (
    <section
      className="local-empty account-flow taxonomy-flow"
      aria-busy={busy}
    >
      <div className="taxonomy-heading">
        <h2 tabIndex={-1} ref={heading}>
          Subcategorias e tags
        </h2>
        <button type="button" onClick={onBack} disabled={busy}>
          Voltar às configurações
        </button>
      </div>
      <p>
        Subcategorias organizam uma categoria. Tags podem se sobrepor e não
        representam partes aditivas do orçamento.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!gateway ? (
        <p>
          Abra o aplicativo Desktop para gerenciar o catálogo no cofre local.
        </p>
      ) : (
        <>
          <div className="category-actions">
            <button type="button" onClick={() => void load()} disabled={busy}>
              Atualizar catálogo
            </button>
            <button
              type="button"
              onClick={() => begin('SUBCATEGORY')}
              disabled={!data || busy || retry || !activeParents.length}
            >
              Criar subcategoria
            </button>
            <button
              type="button"
              onClick={() => begin('TAG')}
              disabled={!data || busy || retry}
            >
              Criar tag
            </button>
          </div>
          {retry && (
            <div className="local-categories-retry">
              <p>
                A tentativa foi mantida. Repita exatamente a mesma ação ou
                atualize o catálogo para conferir o resultado antes de editar.
              </p>
              <button type="button" onClick={() => void send()} disabled={busy}>
                Repetir mesma tentativa
              </button>
            </div>
          )}
          {data && !activeParents.length && (
            <p>
              Para criar uma subcategoria, crie ou reative uma categoria em
              Gerenciar categorias.
            </p>
          )}
          {mode !== 'list' && (
            <form onSubmit={submit}>
              <fieldset disabled={busy || retry}>
                <legend>
                  {base ? 'Editar' : 'Criar'}{' '}
                  {mode === 'TAG' ? 'tag' : 'subcategoria'}
                </legend>
                <label>
                  Nome
                  <input
                    aria-label="Nome do item"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </label>
                {mode === 'SUBCATEGORY' &&
                  (base ? (
                    <p>
                      Categoria:{' '}
                      {data?.categories.find((c) => c.id === parent)?.name ??
                        'Categoria indisponível'}
                    </p>
                  ) : (
                    <label>
                      Categoria
                      <select
                        aria-label="Categoria da subcategoria"
                        value={parent}
                        onChange={(e) => setParent(e.target.value)}
                        required
                      >
                        {activeParents.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                <div className="category-actions">
                  <button type="submit">Salvar item</button>
                  <button type="button" onClick={reset}>
                    Cancelar edição
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {data && (
            <>
              <div className="taxonomy-filters">
                <label>
                  Tipo
                  <select
                    aria-label="Filtrar tipo de item"
                    value={kind}
                    disabled={busy || retry}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="ALL">Todos os tipos</option>
                    <option value="SUBCATEGORY">Subcategorias</option>
                    <option value="TAG">Tags</option>
                  </select>
                </label>
                <label>
                  Estado
                  <select
                    aria-label="Filtrar estado dos itens"
                    value={status}
                    disabled={busy || retry}
                    onChange={(e) => setStatus(e.target.value as typeof status)}
                  >
                    <option value="ALL">Todos os estados</option>
                    <option value="ACTIVE">Ativos</option>
                    <option value="ARCHIVED">Arquivados</option>
                  </select>
                </label>
                <label>
                  Pesquisar
                  <input
                    aria-label="Pesquisar subcategorias e tags"
                    value={search}
                    maxLength={120}
                    disabled={busy || retry}
                    onChange={(e) =>
                      setSearch(e.target.value.replace(/\p{Cc}/gu, ''))
                    }
                  />
                </label>
              </div>
              <p role="status">
                {rows.length}{' '}
                {rows.length === 1 ? 'item encontrado' : 'itens encontrados'}.
              </p>
              <ul className="category-list">
                {rows.map((item) => {
                  const siblings =
                      item.kind === 'SUBCATEGORY'
                        ? filterTaxonomy(
                            workspaceId,
                            { categories: data.categories, items: data.items },
                            {
                              kind: 'SUBCATEGORY',
                              status: 'ACTIVE',
                              category_id: item.category_id,
                              search: '',
                            },
                          )
                        : [],
                    index = siblings.findIndex((r) => r.id === item.id),
                    parentRow =
                      item.kind === 'SUBCATEGORY'
                        ? data.categories.find((c) => c.id === item.category_id)
                        : null;
                  return (
                    <li className="category-row" key={item.kind + item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {item.kind === 'TAG'
                            ? 'Tag'
                            : `Subcategoria de ${parentRow?.name ?? 'categoria indisponível'}`}
                          {parentRow?.status === 'ARCHIVED'
                            ? ' · Categoria arquivada'
                            : ''}{' '}
                          · {item.status === 'ACTIVE' ? 'Ativo' : 'Arquivado'}
                        </p>
                      </div>
                      <div className="category-actions">
                        <button
                          type="button"
                          onClick={() => edit(item)}
                          disabled={busy || retry}
                        >
                          Editar {item.name}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void send({
                              kind: 'UPDATE',
                              base: item,
                              item: {
                                ...item,
                                status:
                                  item.status === 'ACTIVE'
                                    ? 'ARCHIVED'
                                    : 'ACTIVE',
                              },
                            })
                          }
                          disabled={
                            busy ||
                            retry ||
                            (item.status === 'ARCHIVED' &&
                              parentRow?.status === 'ARCHIVED')
                          }
                        >
                          {item.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}{' '}
                          {item.name}
                        </button>
                        {item.kind === 'SUBCATEGORY' &&
                          item.status === 'ACTIVE' && (
                            <>
                              <button
                                type="button"
                                aria-label={`Subir ${item.name}`}
                                disabled={busy || retry || index <= 0}
                                onClick={() => move(item, -1)}
                              >
                                Subir
                              </button>
                              <button
                                type="button"
                                aria-label={`Descer ${item.name}`}
                                disabled={
                                  busy ||
                                  retry ||
                                  index < 0 ||
                                  index >= siblings.length - 1
                                }
                                onClick={() => move(item, 1)}
                              >
                                Descer
                              </button>
                            </>
                          )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {!rows.length && <p>Nenhum item corresponde aos filtros.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
