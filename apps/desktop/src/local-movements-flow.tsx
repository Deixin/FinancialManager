import { LocalTransfersFlow } from './local-transfers-flow.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import type { ManualMovementCommand } from '@financial-manager/domain/manual-movements';
import type { RevisionState } from '@financial-manager/domain/revisions';
import {
  createLocalMovementsGateway,
  captureLocalManualMovement,
  LocalMovementError,
  localMovementMessage,
  movementAccount,
  canEditMovement,
  canToggleMovement,
  editableMinor,
} from './local-movements.js';
import type { MovementsSnapshot } from './local-movements.js';
import {
  accountRows,
  formatBrlMinor,
  parseBrlMinor,
  todayFinancial,
} from './local-accounts.js';
export interface MovementEntry {
  readonly mode: 'list' | 'create' | 'adjust';
  readonly accountId?: string;
}
type Mode =
  'list' | 'detail' | 'create' | 'edit' | 'delete' | 'restore' | 'adjust';
const title = (kind: string) =>
  ({
    INCOME: 'Entrada',
    EXPENSE: 'Gasto',
    ADJUSTMENT: 'Ajuste de saldo',
    TRANSFER: 'Transferência',
    DEBT_SETTLEMENT: 'Liquidação de dívida',
    EXPENSE_REVERSAL: 'Estorno de gasto',
    OTHER: 'Outro',
  })[kind] ?? 'Outro';
export function LocalMovementsFlow({
  workspaceId,
  onLocked,
  entry,
}: {
  workspaceId: string;
  onLocked: () => void;
  entry: MovementEntry;
}) {
  const [transferEntry, setTransferEntry] = useState<{
    mode: 'list' | 'create';
    groupId?: string;
  } | null>(null);
  const [gateway] = useState(createLocalMovementsGateway),
    [snapshot, setSnapshot] = useState<MovementsSnapshot | null>(null),
    [busy, setBusy] = useState(Boolean(gateway)),
    [mode, setMode] = useState<Mode>('list'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<RevisionState | null>(null);
  const [filter, setFilter] = useState(entry.accountId ?? ''),
    [deleted, setDeleted] = useState(false),
    [from, setFrom] = useState(() => todayFinancial().slice(0, 7) + '-01'),
    [to, setTo] = useState(todayFinancial);
  const [accountId, setAccountId] = useState(entry.accountId ?? ''),
    [kind, setKind] = useState<'INCOME' | 'EXPENSE'>('EXPENSE'),
    [date, setDate] = useState(todayFinancial),
    [amount, setAmount] = useState(''),
    [name, setName] = useState(''),
    [original, setOriginal] = useState(''),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false);
  const alive = useRef(true),
    pending = useRef(false),
    first = useRef(true),
    request = useRef<ManualMovementCommand | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const current = snapshot?.transactions.find((s) => s.id === selected),
    accounts = snapshot?.balance.accounts ?? [],
    account = accounts.find((a) => a.account.id === accountId)?.account;
  const rows = useMemo(
    () =>
      snapshot?.transactions
        .filter(
          (s) =>
            (!filter || s.content.account_id === filter) &&
            (deleted || !s.content.deleted) &&
            s.content.financial_date >= from &&
            s.content.financial_date <= to,
        )
        .toSorted(
          (a, b) =>
            b.content.financial_date.localeCompare(a.content.financial_date) ||
            b.id.localeCompare(a.id),
        ) ?? [],
    [snapshot, filter, deleted, from, to],
  );
  const balances = useMemo(
    () => (snapshot ? accountRows(snapshot.balance, todayFinancial()) : []),
    [snapshot],
  );
  const accountName = (id: string) =>
    accounts.find((a) => a.account.id === id)?.account.name ??
    'Conta indisponível';
  const currentAccount =
    current &&
    accounts.find((a) => a.account.id === current.content.account_id)?.account;
  const captured = Boolean(request.current),
    form = ['create', 'edit', 'delete', 'restore', 'adjust'].includes(mode);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [gateway, workspaceId]);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [busy, mode, selected]);
  function failure(value: unknown) {
    setError(localMovementMessage(value));
    setNotice('');
    if (value instanceof LocalMovementError && value.code === 'LOCAL_LOCKED') {
      setSnapshot(null);
      setEditing(null);
      setSelected('');
      setName('');
      setOriginal('');
      setReason('');
      setAmount('');
      request.current = null;
      onLocked();
    }
  }
  async function refresh() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setSnapshot(null);
    setError('');
    setNotice('');
    setMode('list');
    try {
      const next = await gateway.read(workspaceId);
      if (alive.current) {
        setSnapshot(next);
        request.current = null;
        setEditing(null);
        setName('');
        setOriginal('');
        setAmount('');
        setReason('');
        setSelected('');
        if (first.current) {
          setMode(entry.mode);
          setAccountId(entry.accountId ?? '');
          first.current = false;
        } else
          setNotice(
            'Consulta atualizada. Confira o resultado antes de iniciar outra alteração.',
          );
      }
    } catch (error) {
      if (alive.current) failure(error);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function begin(next: Mode) {
    if (!snapshot || busy || request.current) return;
    setError('');
    setNotice('');
    setMode(next);
    setAck(false);
    setAmount('');
    setReason('');
    setOriginal('');
    setDate(todayFinancial());
    setName('');
    setKind('EXPENSE');
    setEditing(
      next === 'create' || next === 'adjust' ? null : (current ?? null),
    );
    setAccountId(
      next === 'create' || next === 'adjust'
        ? filter
        : (current?.content.account_id ?? ''),
    );
    if (next === 'edit' && current) {
      setDate(current.content.financial_date);
      setName(current.content.display_name);
      setKind(current.content.economic_kind as 'INCOME' | 'EXPENSE');
      setAmount(
        editableMinor(current.content.account_amount_minor.replace(/^-/u, '')),
      );
    }
  }
  async function apply(build: () => ManualMovementCommand) {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      request.current ??= captureLocalManualMovement(build(), workspaceId);
      const result = await gateway.apply(workspaceId, request.current);
      const next = await gateway.read(workspaceId);
      if (!next.transactions.some((s) => s.id === result.id))
        throw new LocalMovementError('INVALID_RESPONSE');
      if (alive.current) {
        setSnapshot(next);
        setSelected(result.id);
        setMode('detail');
        setEditing(null);
        request.current = null;
        setAmount('');
        setName('');
        setOriginal('');
        setReason('');
        setNotice(
          'Alteração registrada. O saldo foi recalculado com os dados atuais.',
        );
      }
    } catch (error) {
      if (alive.current) failure(error);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void apply(() => {
      if (mode === 'delete' || mode === 'restore') {
        if (!editing || !ack)
          throw new LocalMovementError('INVALID_MANUAL_MOVEMENT');
        return {
          kind: mode === 'delete' ? 'DELETE' : 'RESTORE',
          base: editing,
        };
      }
      if (!account) throw new LocalMovementError('INVALID_MANUAL_MOVEMENT');
      const descriptor = movementAccount(account),
        identity = createCryptoIdentity(globalThis.crypto, Date.now);
      if (mode === 'adjust') {
        if (!ack) throw new LocalMovementError('INVALID_MANUAL_MOVEMENT');
        return {
          kind: 'ADJUST',
          id: identity.newId(),
          account: descriptor,
          financial_date: date,
          delta_minor: parseBrlMinor(amount),
          reason,
        };
      }
      if (mode === 'edit') {
        if (!editing) throw new LocalMovementError('INVALID_MANUAL_MOVEMENT');
        return {
          kind: 'EDIT',
          base: editing,
          account: descriptor,
          financial_date: date,
          display_name: name,
          amount_minor: parseBrlMinor(amount),
          movement_kind: kind,
        };
      }
      return {
        kind: 'CREATE',
        id: identity.newId(),
        account: descriptor,
        financial_date: date,
        display_name: name,
        amount_minor: parseBrlMinor(amount),
        movement_kind: kind,
        original_description: original || null,
      };
    });
  }
  if (transferEntry)
    return (
      <LocalTransfersFlow
        key={
          workspaceId +
          ':' +
          transferEntry.mode +
          ':' +
          (transferEntry.groupId ?? '')
        }
        workspaceId={workspaceId}
        initialMode={transferEntry.mode}
        {...(transferEntry.groupId ? { groupId: transferEntry.groupId } : {})}
        onLocked={onLocked}
        onClose={() => {
          setTransferEntry(null);
          void refresh();
        }}
      />
    );
  if (busy)
    return (
      <section className="account-flow" aria-busy="true">
        <h2 ref={heading} tabIndex={-1}>
          Acessando movimentações
        </h2>
        <p role="status">Aguarde enquanto o cofre conclui a operação.</p>
      </section>
    );
  const balanceId = current?.content.account_id || filter,
    shown = balances.find((r) => r.state.account.id === balanceId);
  return (
    <section
      className="account-flow movement-flow"
      aria-label="Movimentações locais"
    >
      <h2 ref={heading} tabIndex={-1}>
        {
          {
            list: 'Suas movimentações',
            detail: 'Detalhe da movimentação',
            create: 'Nova movimentação',
            edit: 'Editar movimentação',
            delete: 'Excluir movimentação',
            restore: 'Restaurar movimentação',
            adjust: 'Ajuste identificado',
          }[mode]
        }
      </h2>
      <p>
        Somente neste espaço local. Valores em BRL; entradas e gastos usam
        magnitude positiva. Transferências e pagamentos agrupados terão fluxos
        próprios.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          {captured && (
            <>
              <p>
                Os dados desta tentativa estão preservados. Repetir usa o mesmo
                ID e a mesma base; se já houve gravação, será informado
                conflito.
              </p>
              <button
                type="button"
                onClick={() => void apply(() => request.current!)}
              >
                Repetir a mesma tentativa
              </button>
            </>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <button type="button" onClick={() => void refresh()}>
        Consultar resultado e atualizar
      </button>
      {!gateway && (
        <p>
          Abra o aplicativo Desktop para acessar o cofre. Esta visualização não
          salva dados financeiros.
        </p>
      )}
      {snapshot && (
        <>
          <p>
            Última leitura:{' '}
            {new Date(snapshot.balance.read_at).toLocaleString('pt-BR')}. Os
            saldos permanecem estimados enquanto a cobertura do histórico não
            for comprovada.
          </p>
          {shown && (
            <p>
              Saldo estimado em {todayFinancial()}:{' '}
              {shown.value
                ? formatBrlMinor(shown.value.balance.amount_minor)
                : 'Saldo fora do limite de cálculo. Nenhum total parcial foi apresentado.'}
            </p>
          )}
          {mode === 'list' && (
            <>
              <div className="movement-actions">
                <button
                  type="button"
                  onClick={() => setTransferEntry({ mode: 'create' })}
                  disabled={
                    captured ||
                    accounts.filter(
                      (a) =>
                        a.account.status === 'ACTIVE' &&
                        a.account.balance_nature === 'ASSET',
                    ).length < 2
                  }
                >
                  Nova transferência
                </button>
                <button
                  type="button"
                  onClick={() => setTransferEntry({ mode: 'list' })}
                  disabled={captured}
                >
                  Ver transferências
                </button>
              </div>
              <label htmlFor="movement-filter-account">Filtrar por conta</label>
              <select
                id="movement-filter-account"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">Todas as contas</option>
                {accounts.map((a) => (
                  <option key={a.account.id} value={a.account.id}>
                    {a.account.name}
                    {a.account.status === 'ARCHIVED' ? ' — Arquivada' : ''}
                  </option>
                ))}
              </select>
              <label htmlFor="movement-from">Data inicial</label>
              <input
                id="movement-from"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <label htmlFor="movement-to">Data final</label>
              <input
                id="movement-to"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <label className="backup-ack">
                <input
                  type="checkbox"
                  checked={deleted}
                  onChange={(e) => setDeleted(e.target.checked)}
                />
                Mostrar excluídas
              </label>
              <button
                type="button"
                className="entry-primary"
                onClick={() => begin('create')}
                disabled={
                  captured ||
                  !accounts.some((a) => a.account.status === 'ACTIVE')
                }
              >
                Nova movimentação
              </button>
              {!accounts.length && (
                <p>Cadastre uma conta em Contas e cartões para começar.</p>
              )}
              {from > to ? (
                <p role="alert">Confira a ordem das datas.</p>
              ) : !rows.length ? (
                <p>
                  Nenhuma movimentação neste filtro. Isso não comprova ausência
                  de histórico em outros períodos.
                </p>
              ) : (
                <ul className="local-list">
                  {rows.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(s.id);
                          setMode('detail');
                          setError('');
                          setNotice('');
                        }}
                      >
                        {s.content.display_name} —{' '}
                        {title(s.content.economic_kind)} —{' '}
                        {formatBrlMinor(s.content.account_amount_minor)}
                        <br />
                        {s.content.financial_date} ·{' '}
                        {accountName(s.content.account_id)} · v{s.version}
                        {s.content.deleted ? ' · Excluída' : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {mode === 'detail' && current && (
            <>
              <h3>{current.content.display_name}</h3>
              <p>
                {title(current.content.economic_kind)} ·{' '}
                {accountName(current.content.account_id)} ·{' '}
                {current.content.financial_date}
              </p>
              <p>
                Variação no saldo da conta:{' '}
                <strong>
                  {formatBrlMinor(current.content.account_amount_minor)}
                </strong>
                .{' '}
                {current.content.deleted
                  ? 'Excluída logicamente; não participa do saldo.'
                  : 'Confirmada; o efeito depende da data e da referência da conta.'}
              </p>
              <p>
                Descrição original:{' '}
                {current.content.original_description ?? 'Não informada'}.
                Origem: {current.content.origin_kind}. Versão {current.version}.
              </p>
              <p>
                Classificações: {current.content.allocations.length}. Tags:{' '}
                {current.content.tag_ids.length}. Contraparte:{' '}
                {current.content.counterparty_id
                  ? 'Vínculo preservado'
                  : 'Não vinculada'}
                .
              </p>
              {current.content.allocations.length > 0 && (
                <p>
                  Classificações e observações existentes são preservadas.
                  Gestão de categorias, tags e rateios será integrada nas
                  próximas histórias.
                </p>
              )}
              <button
                type="button"
                disabled={
                  captured ||
                  currentAccount?.status !== 'ACTIVE' ||
                  !canEditMovement(current)
                }
                onClick={() => begin('edit')}
              >
                Editar movimentação
              </button>
              <button
                type="button"
                disabled={
                  captured ||
                  currentAccount?.status !== 'ACTIVE' ||
                  !canToggleMovement(current)
                }
                onClick={() =>
                  begin(current.content.deleted ? 'restore' : 'delete')
                }
              >
                {current.content.deleted
                  ? 'Restaurar movimentação'
                  : 'Excluir movimentação'}
              </button>
              {(!canToggleMovement(current) ||
                currentAccount?.status === 'ARCHIVED') && (
                <p>
                  Registro somente para consulta neste fluxo. Contas arquivadas
                  precisam ser reativadas; outras origens e operações agrupadas
                  usam seus próprios fluxos.
                </p>
              )}
              {current.content.group_id &&
                current.content.economic_kind === 'TRANSFER' && (
                  <button
                    type="button"
                    onClick={() =>
                      setTransferEntry({
                        mode: 'list',
                        groupId: current.content.group_id!,
                      })
                    }
                    disabled={captured}
                  >
                    Ver transferência completa
                  </button>
                )}
              <h3>Histórico de revisões</h3>
              <ol className="movement-history">
                {snapshot.history
                  .filter((r) => r.transaction_id === current.id)
                  .map((r) => (
                    <li key={r.id}>
                      <p>
                        Versão {r.version} ·{' '}
                        {new Date(r.created_at).toLocaleString('pt-BR')} ·{' '}
                        {r.change_source}
                      </p>
                      {r.compatible && r.snapshot ? (
                        <details>
                          <summary>Ver alteração da versão {r.version}</summary>
                          <p>
                            Antes:{' '}
                            {r.snapshot.before
                              ? `${r.snapshot.before.content.display_name} — ${formatBrlMinor(r.snapshot.before.content.account_amount_minor)} — ${r.snapshot.before.content.financial_date}${r.snapshot.before.content.deleted ? ' — Excluída' : ''}`
                              : 'Registro ainda não existia'}
                          </p>
                          <p>
                            Depois: {r.snapshot.after.content.display_name} —{' '}
                            {formatBrlMinor(
                              r.snapshot.after.content.account_amount_minor,
                            )}{' '}
                            — {r.snapshot.after.content.financial_date}
                            {r.snapshot.after.content.deleted
                              ? ' — Excluída'
                              : ''}
                          </p>
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
              {!snapshot.history.some(
                (r) => r.transaction_id === current.id,
              ) && (
                <p>Não há revisões disponíveis para este registro legado.</p>
              )}
            </>
          )}
          {form && (
            <form onSubmit={submit}>
              {mode === 'delete' || mode === 'restore' ? (
                <>
                  <p>
                    {mode === 'delete'
                      ? 'A exclusão retira o registro do cálculo de saldo e dos relatórios, preservando dados e revisões.'
                      : 'A restauração volta a considerar o registro conforme a referência e a data, preservando o histórico.'}{' '}
                    Conta: {editing && accountName(editing.content.account_id)}.
                    Variação registrada:{' '}
                    {editing &&
                      formatBrlMinor(editing.content.account_amount_minor)}
                    .
                  </p>
                  <p>
                    Vínculos atuais são preservados. Nenhuma relação
                    incompatível será criada por aproximação.
                  </p>
                  <label className="backup-ack">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      disabled={captured}
                      required
                    />
                    Confirmo a{' '}
                    {mode === 'delete' ? 'exclusão lógica' : 'restauração'} e
                    seu efeito no saldo.
                  </label>
                </>
              ) : (
                <>
                  <label htmlFor="movement-account">
                    Conta da movimentação
                  </label>
                  <select
                    id="movement-account"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={captured}
                    required
                  >
                    <option value="">Escolha uma conta</option>
                    {accounts.map((a) => (
                      <option
                        key={a.account.id}
                        value={a.account.id}
                        disabled={a.account.status === 'ARCHIVED'}
                      >
                        {a.account.name}
                        {a.account.balance_nature === 'LIABILITY'
                          ? ' — Dívida / passivo'
                          : ''}
                        {a.account.status === 'ARCHIVED' ? ' — Arquivada' : ''}
                      </option>
                    ))}
                  </select>
                  {mode === 'adjust' ? (
                    <p>
                      Ajuste identificado não é receita nem despesa. Valor
                      positivo aumenta o saldo exibido; negativo reduz,
                      inclusive a dívida de um cartão. Nenhum ajuste é criado
                      automaticamente.
                    </p>
                  ) : (
                    <>
                      <label htmlFor="movement-kind">
                        Tipo de movimentação
                      </label>
                      <select
                        id="movement-kind"
                        value={kind}
                        onChange={(e) =>
                          setKind(e.target.value as 'INCOME' | 'EXPENSE')
                        }
                        disabled={captured}
                      >
                        <option value="EXPENSE">Gasto</option>
                        <option value="INCOME">Entrada</option>
                      </select>
                    </>
                  )}
                  <label htmlFor="movement-date">Data financeira</label>
                  <input
                    id="movement-date"
                    type="date"
                    min="0001-01-01"
                    max="9999-12-31"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={captured}
                    required
                  />
                  <label htmlFor="movement-amount">
                    {mode === 'adjust'
                      ? 'Variação no saldo (R$)'
                      : 'Valor positivo (R$)'}
                  </label>
                  <input
                    id="movement-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    maxLength={24}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={captured}
                    required
                  />
                  <p>
                    Use 1000,00 sem separador de milhares. O sinal da conta é
                    calculado pelo tipo da movimentação.
                  </p>
                  {mode === 'adjust' ? (
                    <>
                      <label htmlFor="movement-reason">Motivo do ajuste</label>
                      <input
                        id="movement-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={2000}
                        disabled={captured}
                        required
                        autoComplete="off"
                      />
                      <label className="backup-ack">
                        <input
                          type="checkbox"
                          checked={ack}
                          onChange={(e) => setAck(e.target.checked)}
                          disabled={captured}
                          required
                        />
                        Confirmo o ajuste identificado e seu efeito no saldo.
                      </label>
                    </>
                  ) : (
                    <>
                      <label htmlFor="movement-name">
                        Nome da movimentação
                      </label>
                      <input
                        id="movement-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={Math.max(
                          2000,
                          editing?.content.display_name.length ?? 0,
                        )}
                        autoComplete="off"
                        disabled={captured}
                        required
                      />
                      {mode === 'create' ? (
                        <>
                          <label htmlFor="movement-original">
                            Descrição original (opcional)
                          </label>
                          <input
                            id="movement-original"
                            value={original}
                            onChange={(e) => setOriginal(e.target.value)}
                            maxLength={2000}
                            autoComplete="off"
                            disabled={captured}
                          />
                        </>
                      ) : (
                        <p>
                          A descrição original, as tags e a contraparte serão
                          preservadas.
                        </p>
                      )}
                    </>
                  )}
                  <p>
                    Classificação nova e observação livre de lançamento serão
                    integradas nas histórias de categorias e rateios. Nenhuma
                    informação existente é apagada.
                  </p>
                </>
              )}
              <button
                type="submit"
                className="entry-primary"
                disabled={
                  !gateway ||
                  captured ||
                  (['delete', 'restore', 'adjust'].includes(mode) && !ack) ||
                  (!['delete', 'restore'].includes(mode) &&
                    account?.status !== 'ACTIVE')
                }
              >
                {
                  {
                    create: 'Salvar movimentação',
                    edit: 'Salvar alteração',
                    delete: 'Confirmar exclusão',
                    restore: 'Confirmar restauração',
                    adjust: 'Registrar ajuste',
                  }[mode as 'create' | 'edit' | 'delete' | 'restore' | 'adjust']
                }
              </button>
            </form>
          )}
          {mode !== 'list' && (
            <button type="button" onClick={() => void refresh()}>
              {form
                ? 'Cancelar e consultar resultado'
                : 'Voltar às movimentações'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
