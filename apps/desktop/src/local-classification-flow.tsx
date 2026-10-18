import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ClassificationCommand,
  ClassificationSelection,
} from '@financial-manager/domain/classification';
import type { ClassificationSnapshot } from './local-classification-filters.js';
import { classificationReferenceName } from './local-classification-filters.js';
import {
  classificationEdit,
  newClassificationAllocation,
  createLocalClassificationGateway,
  verifyClassificationRead,
  localClassificationMessage,
} from './local-classification.js';
import { LocalMovementError, movementKindLabel } from './local-movements.js';
import { formatBrlMinor } from './local-accounts.js';
export function LocalClassificationFlow({
  snapshot,
  transactionId,
  onLocked,
  onReviewed,
  onCancel,
}: {
  snapshot: ClassificationSnapshot;
  transactionId: string;
  onLocked: () => void;
  onReviewed: (
    snapshot: ClassificationSnapshot,
    result: 'SAVED' | 'UNCHANGED' | 'REVIEWED',
  ) => void;
  onCancel: () => void;
}) {
  const base = snapshot.movements.transactions.find(
    (r) => r.id === transactionId,
  )!;
  const scope =
    base.content.economic_kind === 'INCOME'
      ? 'INCOME'
      : ['EXPENSE', 'EXPENSE_REVERSAL'].includes(base.content.economic_kind)
        ? 'EXPENSE'
        : 'BOTH';
  const categories = snapshot.catalog.categories.filter(
    (c) =>
      c.status === 'ACTIVE' &&
      (c.category_scope === 'BOTH' || c.category_scope === scope),
  );
  const [gateway] = useState(createLocalClassificationGateway),
    [selection, setSelection] = useState<'KEEP' | 'SET' | 'CLEAR'>('KEEP'),
    [category, setCategory] = useState(
      () =>
        categories.find(
          (c) => c.id === base.content.allocations[0]?.category_id,
        )?.id ??
        categories[0]?.id ??
        '',
    ),
    [subcategory, setSubcategory] = useState(''),
    [tags, setTags] = useState<readonly string[]>(base.content.tag_ids),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const intent = useRef<readonly ClassificationCommand[] | null>(null),
    alive = useRef(true),
    pending = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [busy]);
  const availableTags = snapshot.catalog.items.filter(
      (r) =>
        r.kind === 'TAG' &&
        (r.status === 'ACTIVE' || base.content.tag_ids.includes(r.id)),
    ),
    subs = snapshot.catalog.items.filter(
      (r) =>
        r.kind === 'SUBCATEGORY' &&
        r.category_id === category &&
        r.status === 'ACTIVE',
    ),
    frozen = Boolean(intent.current);
  function failure(e: unknown) {
    setError(localClassificationMessage(e));
    if (e instanceof LocalMovementError && e.code === 'LOCAL_LOCKED')
      onLocked();
  }
  async function save() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!intent.current) {
        const c: ClassificationSelection =
          selection === 'SET'
            ? {
                kind: 'SET',
                allocation_id: newClassificationAllocation(base),
                category_id: category,
                subcategory_id: subcategory || null,
              }
            : { kind: selection };
        intent.current = classificationEdit(snapshot, transactionId, c, tags);
      }
      const entries = await gateway.apply(base.workspace_id, intent.current);
      if (!alive.current) return;
      const next = await gateway.read(base.workspace_id);
      if (!alive.current) return;
      verifyClassificationRead(next, intent.current, entries);
      if (alive.current)
        onReviewed(
          next,
          entries.some((r) => r.changed) ? 'SAVED' : 'UNCHANGED',
        );
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function review() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await gateway.read(base.workspace_id);
      if (alive.current) onReviewed(next, 'REVIEWED');
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void save();
  }
  if (busy)
    return (
      <section className="account-flow classification-editor" aria-busy="true">
        <h2>Registrando ou consultando classificação</h2>
        <p role="status">Aguarde a conclusão da operação no cofre.</p>
      </section>
    );
  return (
    <section
      className="account-flow classification-editor"
      aria-label="Editar classificação e tags"
    >
      <h2 ref={heading} tabIndex={-1}>
        Editar classificação e tags
      </h2>
      <p>
        {base.content.display_name} ·{' '}
        {movementKindLabel(base.content.economic_kind)} ·{' '}
        {formatBrlMinor(base.content.account_amount_minor)} · versão{' '}
        {base.version}.
      </p>
      <p>
        Esta edição altera categorias, subcategoria e tags. O valor, a conta, a
        data e a natureza econômica são preservados. Tags podem se sobrepor e
        não são parcelas aditivas do orçamento.
      </p>
      {base.content.group_id && (
        <p>
          O outro lado da operação agrupada será conferido junto. Somente esta
          movimentação recebe as escolhas abaixo.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {frozen && (
        <>
          <p>
            Os dados desta tentativa estão preservados. Repetir usa a mesma base
            e os mesmos IDs. Se já houve gravação, será informado conflito.
          </p>
          <button type="button" onClick={() => void save()}>
            Repetir mesma tentativa
          </button>
          <button type="button" onClick={() => void review()}>
            Consultar resultado e revisar
          </button>
        </>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={frozen || !gateway}>
          <legend>Classificação da movimentação</legend>
          <label htmlFor="classification-edit-mode">
            Classificação monetária
          </label>
          <select
            id="classification-edit-mode"
            value={selection}
            onChange={(e) => {
              setSelection(e.target.value as 'KEEP' | 'SET' | 'CLEAR');
              const current = base.content.allocations[0];
              setSubcategory(
                e.target.value === 'SET' &&
                  current?.category_id === category &&
                  subs.some((s) => s.id === current.subcategory_id)
                  ? (current.subcategory_id ?? '')
                  : '',
              );
            }}
          >
            <option value="KEEP">Conservar classificação atual</option>
            <option value="SET" disabled={base.content.allocations.length > 1}>
              Escolher classificação única
            </option>
            <option
              value="CLEAR"
              disabled={base.content.allocations.length > 1}
            >
              Remover classificação monetária
            </option>
          </select>
          {base.content.allocations.length > 1 && (
            <p>
              Este registro tem rateio. As parcelas são preservadas; você pode
              editar as tags.
            </p>
          )}
          {selection === 'KEEP' && (
            <p>
              {base.content.allocations.length
                ? base.content.allocations
                    .map(
                      (a) =>
                        classificationReferenceName(
                          snapshot,
                          'CATEGORY',
                          a.category_id,
                        ) +
                        (a.subcategory_id
                          ? ' / ' +
                            classificationReferenceName(
                              snapshot,
                              'SUBCATEGORY',
                              a.subcategory_id,
                            )
                          : ''),
                    )
                    .join('; ')
                : 'Sem classificação monetária.'}
            </p>
          )}
          {selection === 'CLEAR' && (
            <p>
              A classificação monetária será removida. As tags escolhidas abaixo
              permanecem.
            </p>
          )}
          {selection === 'SET' && (
            <>
              <label htmlFor="classification-edit-category">
                Categoria da movimentação
              </label>
              <select
                id="classification-edit-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setSubcategory('');
                }}
                required
              >
                <option value="">Escolha uma categoria ativa</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label htmlFor="classification-edit-subcategory">
                Subcategoria da movimentação
              </label>
              <select
                id="classification-edit-subcategory"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
              >
                <option value="">Sem subcategoria</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {!categories.length && (
                <p>
                  Cadastre ou reative uma categoria compatível em Configurações.
                </p>
              )}
            </>
          )}
          <fieldset>
            <legend>Tags da movimentação</legend>
            {!availableTags.length && (
              <p>
                Nenhuma tag ativa ou já associada. Gerencie tags em
                Configurações.
              </p>
            )}
            {availableTags.map((t) => (
              <label className="backup-ack" key={t.id}>
                <input
                  type="checkbox"
                  checked={tags.includes(t.id)}
                  onChange={(e) =>
                    setTags(
                      e.target.checked
                        ? [...tags, t.id]
                        : tags.filter((id) => id !== t.id),
                    )
                  }
                />
                {t.name}
                {t.status === 'ARCHIVED' ? ' — Arquivada' : ''}
              </label>
            ))}
          </fieldset>
          <button type="submit">Salvar classificação</button>
        </fieldset>
      </form>
      <button type="button" disabled={frozen} onClick={onCancel}>
        Cancelar edição de classificação
      </button>
    </section>
  );
}
