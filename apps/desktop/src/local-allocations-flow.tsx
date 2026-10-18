import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AllocationCommand,
  AllocationSelection,
} from '@financial-manager/domain/classification';
import type { ClassificationSnapshot } from './local-classification-filters.js';
import { classificationReferenceName } from './local-classification-filters.js';
import {
  allocationEdit,
  newAllocationId,
  createLocalAllocationGateway,
  verifyAllocationRead,
  localAllocationMessage,
} from './local-allocations.js';
import { LocalMovementError, movementKindLabel } from './local-movements.js';
import { parseBrlMinor, formatBrlMinor } from './local-accounts.js';
import type { RevisionAllocation } from '@financial-manager/domain/revisions';
interface Draft {
  id: string;
  category_id: string;
  subcategory_id: string | null;
  amount: string;
  note: string | null;
}
function decimal(n: bigint) {
  const d = n.toString().padStart(3, '0');
  return d.slice(0, -2) + ',' + d.slice(-2);
}
function formatted(n: bigint) {
  return (
    'R$ ' +
    (n < 0n ? '-' : '') +
    decimal(n < 0n ? -n : n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  );
}
export function LocalAllocationsFlow({
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
    )!,
    expected =
      BigInt(base.content.account_amount_minor) < 0n
        ? -BigInt(base.content.account_amount_minor)
        : BigInt(base.content.account_amount_minor);
  const [gateway] = useState(createLocalAllocationGateway),
    [mode, setMode] = useState<'KEEP' | 'CLEAR' | 'REPLACE'>('KEEP'),
    [rows, setRows] = useState<readonly Draft[]>(() =>
      base.content.allocations.map((a) => ({
        id: a.id,
        category_id: a.category_id,
        subcategory_id: a.subcategory_id,
        amount: decimal(BigInt(a.amount_minor)),
        note: a.note,
      })),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const intent = useRef<readonly AllocationCommand[] | null>(null),
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
  const scope =
    base.content.economic_kind === 'INCOME'
      ? 'INCOME'
      : ['EXPENSE', 'EXPENSE_REVERSAL'].includes(base.content.economic_kind)
        ? 'EXPENSE'
        : 'BOTH';
  let total = 0n,
    validAmounts = true;
  for (const r of rows)
    try {
      const n = BigInt(parseBrlMinor(r.amount));
      if (n <= 0n) validAmounts = false;
      total += n;
    } catch {
      validAmounts = false;
    }
  const ready =
      validAmounts &&
      rows.length > 0 &&
      rows.length <= 1000 &&
      total === expected &&
      rows.every((r) => Boolean(r.category_id)),
    frozen = Boolean(intent.current);
  function patch(id: string, fields: Partial<Draft>) {
    setRows((current) =>
      current.map((r) => (r.id === id ? { ...r, ...fields } : r)),
    );
  }
  function failure(e: unknown) {
    setError(localAllocationMessage(e));
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
        const allocation: AllocationSelection =
          mode === 'REPLACE'
            ? {
                kind: 'REPLACE',
                allocations: rows.map((r): RevisionAllocation => ({
                  id: r.id,
                  category_id: r.category_id,
                  subcategory_id: r.subcategory_id,
                  amount_minor: parseBrlMinor(r.amount),
                  note: r.note,
                })),
              }
            : { kind: mode };
        intent.current = allocationEdit(snapshot, transactionId, allocation);
      }
      const entries = await gateway.apply(base.workspace_id, intent.current);
      if (!alive.current) return;
      const next = await gateway.read(base.workspace_id);
      if (!alive.current) return;
      verifyAllocationRead(next, intent.current, entries);
      onReviewed(next, entries.some((r) => r.changed) ? 'SAVED' : 'UNCHANGED');
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
        <h2>Registrando ou consultando rateio</h2>
        <p role="status">Aguarde a conclusão da operação no cofre.</p>
      </section>
    );
  return (
    <section
      className="account-flow classification-editor allocation-editor"
      aria-label="Editar rateio"
    >
      <h2 ref={heading} tabIndex={-1}>
        Editar rateio
      </h2>
      <p>
        {base.content.display_name} ·{' '}
        {movementKindLabel(base.content.economic_kind)} ·{' '}
        {formatBrlMinor(base.content.account_amount_minor)} · versão{' '}
        {base.version}.
      </p>
      <p>
        Distribua o total entre categorias. Valor, conta, data, origem e tags da
        movimentação são preservados. Não há ajuste automático da diferença.
      </p>
      {base.content.group_id && (
        <p>O outro lado será conferido junto e conservará suas parcelas.</p>
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
          <legend>Parcelas da movimentação</legend>
          <label htmlFor="allocation-edit-mode">Ação sobre o rateio</label>
          <select
            id="allocation-edit-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="KEEP">Conservar parcelas atuais</option>
            <option value="REPLACE">Editar parcelas</option>
            <option value="CLEAR">Remover todas as parcelas</option>
          </select>
          {mode === 'KEEP' && (
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
                        ' — ' +
                        formatBrlMinor(a.amount_minor),
                    )
                    .join('; ')
                : 'Sem classificação monetária.'}
            </p>
          )}
          {mode === 'CLEAR' && (
            <p>
              Todas as parcelas serão removidas. A movimentação ficará sem
              classificação monetária; suas tags permanecem.
            </p>
          )}
          {mode === 'REPLACE' && (
            <>
              <p role="status" aria-live="polite">
                Total da movimentação: {formatted(expected)}.{' '}
                {validAmounts ? (
                  <>
                    Soma das parcelas: {formatted(total)}. Diferença:{' '}
                    {formatted(expected - total)}.
                  </>
                ) : (
                  'Informe valores positivos válidos, com até duas casas decimais.'
                )}
              </p>
              {rows.map((r, index) => {
                const previous = base.content.allocations.find(
                    (a) => a.id === r.id,
                  ),
                  categories = snapshot.catalog.categories.filter(
                    (c) =>
                      (c.status === 'ACTIVE' &&
                        (c.category_scope === 'BOTH' ||
                          c.category_scope === scope)) ||
                      c.id === previous?.category_id,
                  ),
                  subs = snapshot.catalog.items.filter(
                    (s) =>
                      s.kind === 'SUBCATEGORY' &&
                      s.category_id === r.category_id &&
                      (s.status === 'ACTIVE' ||
                        (previous?.category_id === r.category_id &&
                          s.id === previous.subcategory_id)),
                  );
                return (
                  <fieldset key={r.id}>
                    <legend>Parcela {index + 1}</legend>
                    <label htmlFor={'allocation-category-' + r.id}>
                      Categoria da parcela {index + 1}
                    </label>
                    <select
                      id={'allocation-category-' + r.id}
                      value={r.category_id}
                      required
                      onChange={(e) =>
                        patch(r.id, {
                          category_id: e.target.value,
                          subcategory_id: null,
                        })
                      }
                    >
                      <option value="">Escolha uma categoria</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.status === 'ARCHIVED' ? ' (arquivada)' : ''}
                        </option>
                      ))}
                    </select>
                    <label htmlFor={'allocation-subcategory-' + r.id}>
                      Subcategoria da parcela {index + 1}
                    </label>
                    <select
                      id={'allocation-subcategory-' + r.id}
                      value={r.subcategory_id ?? ''}
                      onChange={(e) =>
                        patch(r.id, { subcategory_id: e.target.value || null })
                      }
                    >
                      <option value="">Sem subcategoria</option>
                      {subs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.status === 'ARCHIVED' ? ' (arquivada)' : ''}
                        </option>
                      ))}
                    </select>
                    <label htmlFor={'allocation-amount-' + r.id}>
                      Valor da parcela {index + 1}
                    </label>
                    <input
                      id={'allocation-amount-' + r.id}
                      inputMode="decimal"
                      value={r.amount}
                      required
                      maxLength={24}
                      onChange={(e) => patch(r.id, { amount: e.target.value })}
                    />
                    <label htmlFor={'allocation-note-' + r.id}>
                      Nota da parcela {index + 1}
                    </label>
                    <input
                      id={'allocation-note-' + r.id}
                      value={r.note ?? ''}
                      maxLength={20000}
                      onChange={(e) =>
                        patch(r.id, { note: e.target.value || null })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((a) => a.id !== r.id),
                        )
                      }
                    >
                      Remover parcela {index + 1}
                    </button>
                  </fieldset>
                );
              })}
              <button
                type="button"
                disabled={rows.length >= 1000}
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    {
                      id: newAllocationId(),
                      category_id: '',
                      subcategory_id: null,
                      amount: '',
                      note: null,
                    },
                  ])
                }
              >
                Adicionar parcela
              </button>
              <p>
                Use valores positivos sem separador de milhares, por exemplo
                12,50. Cada parcela precisa de categoria; a soma deve fechar
                exatamente.
              </p>
            </>
          )}
          <button type="submit" disabled={mode === 'REPLACE' && !ready}>
            Salvar rateio
          </button>
        </fieldset>
      </form>
      <button type="button" onClick={onCancel}>
        Voltar sem nova gravação
      </button>
    </section>
  );
}
