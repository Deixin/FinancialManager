import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import type {
  CardPaymentCommand,
  CardPaymentBase,
} from '@financial-manager/domain/card-payments';
import {
  createLocalCardPaymentsGateway,
  captureLocalCardPayment,
  cardPaymentBase,
  localCardPaymentMessage,
  LocalCardPaymentError,
} from './local-card-payments.js';
import type { CardPaymentsSnapshot } from './local-card-payments.js';
import { movementAccount, editableMinor } from './local-movements.js';
import {
  formatBrlMinor,
  parseBrlMinor,
  todayFinancial,
  accountRows,
} from './local-accounts.js';
type Mode = 'list' | 'create' | 'detail' | 'edit' | 'delete' | 'restore';
export function LocalCardPaymentsFlow({
  workspaceId,
  initialMode,
  groupId,
  cardId,
  onClose,
  onLocked,
}: {
  workspaceId: string;
  initialMode: 'list' | 'create';
  groupId?: string;
  cardId?: string;
  onClose: () => void;
  onLocked: () => void;
}) {
  const [gateway] = useState(createLocalCardPaymentsGateway),
    [data, setData] = useState<CardPaymentsSnapshot | null>(null),
    [mode, setMode] = useState<Mode>('list'),
    [busy, setBusy] = useState(Boolean(gateway)),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState(groupId ?? ''),
    [editing, setEditing] = useState<CardPaymentBase | null>(null);
  const [sourceId, setSource] = useState(''),
    [targetId, setTarget] = useState(cardId ?? ''),
    [date, setDate] = useState(todayFinancial),
    [amount, setAmount] = useState(''),
    [name, setName] = useState(''),
    [original, setOriginal] = useState(''),
    [ack, setAck] = useState(false);
  const alive = useRef(true),
    pending = useRef(false),
    first = useRef(true),
    intent = useRef<CardPaymentCommand | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const accounts = data?.movements.balance.accounts ?? [],
    source = accounts.find((a) => a.account.id === sourceId)?.account,
    target = accounts.find((a) => a.account.id === targetId)?.account,
    current = data?.groups.find((g) => g.id === selected),
    base = data && current ? cardPaymentBase(data, current.id) : null;
  const members = current
      ? (data?.movements.transactions.filter((s) =>
          current.member_ids.includes(s.id),
        ) ?? [])
      : [],
    captured = Boolean(intent.current),
    form = ['create', 'edit', 'delete', 'restore'].includes(mode),
    toggle = mode === 'delete' || mode === 'restore';
  const balances = useMemo(
    () => (data ? accountRows(data.movements.balance, todayFinancial()) : []),
    [data],
  );
  const accountName = (id: string) =>
    accounts.find((a) => a.account.id === id)?.account.name ??
    'Conta indisponível';
  const available = (id: string, card = false) =>
    accounts.some(
      (a) =>
        a.account.id === id &&
        a.account.status === 'ACTIVE' &&
        (card
          ? a.account.balance_nature === 'LIABILITY' &&
            a.account.account_kind === 'CREDIT_CARD'
          : a.account.balance_nature === 'ASSET'),
    );
  const writable = Boolean(
    base &&
    available(base.source.content.account_id) &&
    available(base.target.content.account_id, true),
  );
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
  function failure(e: unknown) {
    setError(localCardPaymentMessage(e));
    setNotice('');
    if (e instanceof LocalCardPaymentError && e.code === 'LOCAL_LOCKED') {
      setData(null);
      setEditing(null);
      intent.current = null;
      setAmount('');
      setName('');
      setOriginal('');
      setSelected('');
      onLocked();
    }
  }
  async function refresh() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setData(null);
    setError('');
    setNotice('');
    try {
      const next = await gateway.read(workspaceId);
      if (alive.current) {
        setData(next);
        intent.current = null;
        setEditing(null);
        setAmount('');
        setName('');
        setOriginal('');
        setAck(false);
        if (first.current) {
          setMode(groupId ? 'detail' : initialMode);
          first.current = false;
        } else {
          setSelected('');
          setMode('list');
          setNotice(
            'Consulta atualizada. Confira os dois lados antes de iniciar outra alteração.',
          );
        }
      }
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function begin(next: Mode) {
    if (busy || captured) return;
    setError('');
    setNotice('');
    setAck(false);
    setMode(next);
    setEditing(next === 'create' ? null : base);
    setDate(
      next === 'create'
        ? todayFinancial()
        : (base?.source.content.financial_date ?? todayFinancial()),
    );
    setAmount(
      next === 'create'
        ? ''
        : editableMinor(
            (base?.target.content.account_amount_minor ?? '0').replace(
              /^-/u,
              '',
            ),
          ),
    );
    setName(next === 'create' ? '' : (base?.source.content.display_name ?? ''));
    setOriginal('');
    setSource(next === 'create' ? '' : (base?.source.content.account_id ?? ''));
    setTarget(
      next === 'create'
        ? (cardId ?? '')
        : (base?.target.content.account_id ?? ''),
    );
  }
  async function apply(build: () => CardPaymentCommand) {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      intent.current ??= captureLocalCardPayment(build(), workspaceId);
      const result = await gateway.apply(workspaceId, intent.current);
      const next = await gateway.read(workspaceId);
      if (!next.groups.some((g) => g.id === result.group_id))
        throw new LocalCardPaymentError('INVALID_RESPONSE');
      if (alive.current) {
        setData(next);
        setSelected(result.group_id);
        setMode('detail');
        setEditing(null);
        intent.current = null;
        setAmount('');
        setName('');
        setOriginal('');
        setAck(false);
        setNotice(
          result.entries.some((r) => r.changed)
            ? 'Pagamento de cartão registrada com os dois lados e suas revisões.'
            : 'Os dois lados foram conferidos; nenhuma alteração era necessária.',
        );
      }
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void apply(() => {
      if (!ack) throw new LocalCardPaymentError('INVALID_CARD_PAYMENT');
      if (mode === 'delete' || mode === 'restore') {
        if (!editing) throw new LocalCardPaymentError('INVALID_CARD_PAYMENT');
        return {
          kind: mode === 'delete' ? 'DELETE' : 'RESTORE',
          base: editing,
        };
      }
      if (!source || !target)
        throw new LocalCardPaymentError('INVALID_CARD_PAYMENT');
      const fields = {
        source_account: movementAccount(source),
        target_account: movementAccount(target),
        financial_date: date,
        amount_minor: parseBrlMinor(amount),
        display_name: name,
      };
      if (mode === 'edit') {
        if (!editing) throw new LocalCardPaymentError('INVALID_CARD_PAYMENT');
        return { kind: 'EDIT', base: editing, ...fields };
      }
      const ids = createCryptoIdentity(globalThis.crypto, Date.now);
      return {
        kind: 'CREATE',
        id: ids.newId(),
        source_entry_id: ids.newId(),
        target_entry_id: ids.newId(),
        original_description: original || null,
        ...fields,
      };
    });
  }
  if (busy)
    return (
      <section className="account-flow" aria-busy="true">
        <h2 ref={heading} tabIndex={-1}>
          Acessando pagamentos de cartão
        </h2>
        <p role="status">Aguarde a operação conjunta no cofre.</p>
      </section>
    );
  return (
    <section
      className="account-flow card-payment-flow"
      aria-label="Pagamentos de cartão locais"
    >
      <h2 ref={heading} tabIndex={-1}>
        {
          {
            list: 'Seus pagamentos de cartão',
            create: 'Novo pagamento de cartão',
            detail: 'Detalhe do pagamento de cartão',
            edit: 'Editar pagamento de cartão',
            delete: 'Excluir pagamento de cartão',
            restore: 'Restaurar pagamento de cartão',
          }[mode]
        }
      </h2>
      <p>
        O pagamento reduz o saldo da conta de origem e a dívida do cartão,
        juntos, em BRL. A compra representa consumo; pagar a fatura não cria
        outro gasto.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          {captured && (
            <>
              <p>
                Esta tentativa mantém o mesmo grupo, os mesmos lançamentos e as
                mesmas bases. Se já foi registrada, repetir informará conflito.
              </p>
              <button
                type="button"
                onClick={() => void apply(() => intent.current!)}
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
          Abra o Desktop para acessar o cofre. Esta visualização não salva dados
          financeiros.
        </p>
      )}
      {data && (
        <>
          <p>
            Última leitura:{' '}
            {new Date(data.movements.balance.read_at).toLocaleString('pt-BR')}.
            Saldos estimados até comprovar a cobertura do histórico.
          </p>
          {mode === 'list' && (
            <>
              <h3>Seus cartões</h3>
              {!accounts.some(
                (a) =>
                  a.account.account_kind === 'CREDIT_CARD' &&
                  a.account.balance_nature === 'LIABILITY',
              ) && (
                <p>
                  Nenhum cartão neste espaço. Cadastre um cartão em Contas para
                  registrar compras e pagamentos.
                </p>
              )}
              <ul className="local-list">
                {accounts
                  .filter(
                    (a) =>
                      a.account.account_kind === 'CREDIT_CARD' &&
                      a.account.balance_nature === 'LIABILITY' &&
                      (!cardId || a.account.id === cardId),
                  )
                  .map((a) => {
                    const balance = balances.find(
                        (b) => b.state.account.id === a.account.id,
                      ),
                      amount = balance?.value?.balance.amount_minor;
                    const entries = data.movements.transactions.filter(
                      (s) =>
                        s.content.account_id === a.account.id &&
                        !s.content.deleted,
                    );
                    return (
                      <li key={a.account.id}>
                        <h3>
                          {a.account.name}
                          {a.account.status === 'ARCHIVED'
                            ? ' · Arquivado'
                            : ''}
                        </h3>
                        <p>
                          {amount && BigInt(amount) < 0n
                            ? 'Crédito no cartão'
                            : 'Dívida calculada'}
                          :{' '}
                          {amount
                            ? formatBrlMinor(amount).replace('R$ -', 'R$ ')
                            : 'Fora do intervalo suportado'}{' '}
                          · Estimado, em {todayFinancial()}.
                        </p>
                        <p>
                          Compras e créditos listados conforme o histórico
                          disponível. Fatura/período e conciliação de itens
                          ainda não estão disponíveis neste fluxo. Não
                          projetamos parcelas ou juros.
                        </p>
                        <ul>
                          {entries
                            .filter(
                              (s) =>
                                s.content.economic_kind !== 'DEBT_SETTLEMENT',
                            )
                            .map((s) => (
                              <li key={s.id}>
                                {s.content.financial_date} ·{' '}
                                {s.content.display_name} ·{' '}
                                {s.content.economic_kind === 'EXPENSE'
                                  ? 'Compra/gasto'
                                  : s.content.economic_kind ===
                                      'EXPENSE_REVERSAL'
                                    ? 'Estorno'
                                    : 'Outro movimento'}{' '}
                                ·{' '}
                                {formatBrlMinor(s.content.account_amount_minor)}
                              </li>
                            ))}
                        </ul>
                        <button
                          type="button"
                          disabled={captured || a.account.status !== 'ACTIVE'}
                          onClick={() => {
                            begin('create');
                            setTarget(a.account.id);
                          }}
                        >
                          Pagar este cartão
                        </button>
                      </li>
                    );
                  })}
              </ul>

              <button
                type="button"
                className="entry-primary"
                onClick={() => begin('create')}
                disabled={
                  captured ||
                  accounts.filter(
                    (a) =>
                      a.account.status === 'ACTIVE' &&
                      a.account.balance_nature === 'ASSET',
                  ).length < 1 ||
                  !accounts.some(
                    (a) =>
                      a.account.status === 'ACTIVE' &&
                      a.account.account_kind === 'CREDIT_CARD' &&
                      a.account.balance_nature === 'LIABILITY',
                  )
                }
              >
                Novo pagamento de cartão
              </button>
              {!data.groups.some((g) => g.group_type === 'CARD_PAYMENT') ? (
                <p>Nenhum pagamento de cartão neste espaço.</p>
              ) : (
                <ul className="local-list">
                  {data.groups
                    .filter((g) => g.group_type === 'CARD_PAYMENT')
                    .map((g) => {
                      const s = data.movements.transactions.find(
                        (s) => s.id === g.member_ids[0],
                      );
                      return (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(g.id);
                              setMode('detail');
                              setError('');
                              setNotice('');
                            }}
                          >
                            {s?.content.display_name ??
                              'Pagamento de cartão incompleta'}
                            {s?.content.deleted ? ' · Excluída' : ''}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </>
          )}
          {mode === 'detail' && current && (
            <>
              <p>
                Pagamento de cartão sem detalhamento. Este fluxo não concilia
                automaticamente compras e pagamentos.
              </p>
              <h3>
                {members[0]?.content.display_name ??
                  'Pagamento de cartão incompleta'}
              </h3>
              <p>
                Vínculo:{' '}
                {
                  {
                    ACTIVE: 'Íntegro',
                    BROKEN: 'Incompleto',
                    VOIDED: 'Anulado',
                  }[current.state]
                }
                . Os dois lançamentos conservam sua identidade e histórico.
              </p>
              {members.map((s) => {
                const balance = balances.find(
                  (b) => b.state.account.id === s.content.account_id,
                );
                return (
                  <div key={s.id}>
                    <h3>
                      {accounts.find(
                        (a) => a.account.id === s.content.account_id,
                      )?.account.balance_nature === 'ASSET'
                        ? 'Saída da conta'
                        : 'Redução da dívida'}{' '}
                      · {accountName(s.content.account_id)}
                    </h3>
                    <p>
                      Variação: {formatBrlMinor(s.content.account_amount_minor)}{' '}
                      · {s.content.financial_date} · Versão {s.version}
                      {s.content.deleted ? ' · Excluída' : ''}.
                    </p>
                    <p>
                      Descrição original:{' '}
                      {s.content.original_description ?? 'Não informada'}.
                      Origem: {s.content.origin_kind}. Classificações:{' '}
                      {s.content.allocations.length}. Tags:{' '}
                      {s.content.tag_ids.length}.
                    </p>
                    <p>
                      Saldo estimado atual:{' '}
                      {balance?.value
                        ? formatBrlMinor(balance.value.balance.amount_minor)
                        : 'Fora do limite de cálculo; nenhum total parcial foi apresentado.'}
                    </p>
                    <details>
                      <summary>Histórico deste lado</summary>
                      <ol className="movement-history">
                        {data.movements.history
                          .filter((h) => h.transaction_id === s.id)
                          .map((h) => (
                            <li key={h.id}>
                              Versão {h.version} ·{' '}
                              {new Date(h.created_at).toLocaleString('pt-BR')} ·{' '}
                              {h.change_source}
                              {h.compatible && h.snapshot ? (
                                <>
                                  <p>
                                    Antes:{' '}
                                    {h.snapshot.before
                                      ? `${accountName(h.snapshot.before.content.account_id)} · ${formatBrlMinor(h.snapshot.before.content.account_amount_minor)} · ${h.snapshot.before.content.display_name}${h.snapshot.before.content.deleted ? ' · Excluída' : ''}`
                                      : 'Ainda não existia'}
                                  </p>
                                  <p>
                                    Depois:{' '}
                                    {accountName(
                                      h.snapshot.after.content.account_id,
                                    )}{' '}
                                    ·{' '}
                                    {formatBrlMinor(
                                      h.snapshot.after.content
                                        .account_amount_minor,
                                    )}{' '}
                                    · {h.snapshot.after.content.display_name}
                                    {h.snapshot.after.content.deleted
                                      ? ' · Excluída'
                                      : ''}
                                  </p>
                                </>
                              ) : (
                                <p>
                                  Histórico legado preservado; formato não
                                  interpretado nesta versão.
                                </p>
                              )}
                            </li>
                          ))}
                      </ol>
                    </details>
                  </div>
                );
              })}
              {!writable && (
                <p>
                  Somente consulta. A alteração conjunta exige um grupo íntegro,
                  dois lançamentos manuais compatíveis e origem de ativo e
                  cartão de crédito ativos. Vínculos incompletos, outras origens
                  e contas arquivadas precisam de seus próprios fluxos.
                </p>
              )}
              <button
                type="button"
                onClick={() => begin('edit')}
                disabled={captured || !writable || base?.source.content.deleted}
              >
                Editar pagamento de cartão
              </button>
              <button
                type="button"
                onClick={() =>
                  begin(base?.source.content.deleted ? 'restore' : 'delete')
                }
                disabled={captured || !writable}
              >
                {base?.source.content.deleted
                  ? 'Restaurar pagamento de cartão'
                  : 'Excluir pagamento de cartão'}
              </button>
            </>
          )}
          {form && (
            <form onSubmit={submit}>
              {toggle ? (
                <>
                  <p>
                    {mode === 'delete'
                      ? 'A exclusão lógica retira os dois lados do cálculo de saldo e preserva grupo, vínculos e histórico.'
                      : 'A restauração volta a considerar os dois lados conforme datas e referências, preservando o histórico.'}
                  </p>
                  <p>
                    Origem:{' '}
                    {editing && accountName(editing.source.content.account_id)}.
                    Destino:{' '}
                    {editing && accountName(editing.target.content.account_id)}.
                    Valor:{' '}
                    {editing &&
                      formatBrlMinor(
                        editing.target.content.account_amount_minor,
                      ).replace('R$ -', 'R$ ')}
                    .
                  </p>
                  <p>
                    Conciliações e outros vínculos existentes são preservados;
                    nenhuma relação incompatível é ressuscitada automaticamente.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="card-payment-source">Conta de origem</label>
                  <select
                    id="card-payment-source"
                    value={sourceId}
                    onChange={(e) => setSource(e.target.value)}
                    disabled={captured}
                    required
                  >
                    <option value="">Escolha a origem</option>
                    {accounts
                      .filter((a) => a.account.balance_nature === 'ASSET')
                      .map((a) => (
                        <option
                          key={a.account.id}
                          value={a.account.id}
                          disabled={a.account.status !== 'ACTIVE'}
                        >
                          {a.account.name}
                          {a.account.status !== 'ACTIVE' ? ' — Arquivada' : ''}
                        </option>
                      ))}
                  </select>
                  <label htmlFor="card-payment-target">Cartão de crédito</label>
                  <select
                    id="card-payment-target"
                    value={targetId}
                    onChange={(e) => setTarget(e.target.value)}
                    disabled={captured}
                    required
                  >
                    <option value="">Escolha o cartão</option>
                    {accounts
                      .filter(
                        (a) =>
                          a.account.balance_nature === 'LIABILITY' &&
                          a.account.account_kind === 'CREDIT_CARD',
                      )
                      .map((a) => (
                        <option
                          key={a.account.id}
                          value={a.account.id}
                          disabled={
                            a.account.status !== 'ACTIVE' ||
                            a.account.id === sourceId
                          }
                        >
                          {a.account.name}
                          {a.account.status !== 'ACTIVE' ? ' — Arquivada' : ''}
                        </option>
                      ))}
                  </select>
                  <p>
                    Pagamento parcial é permitido. Um valor acima da dívida pode
                    deixar crédito no cartão; não calculamos juros futuros.
                  </p>
                  <label htmlFor="card-payment-date">Data do pagamento</label>
                  <input
                    id="card-payment-date"
                    type="date"
                    min="0001-01-01"
                    max="9999-12-31"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={captured}
                    required
                  />
                  <label htmlFor="card-payment-amount">
                    Valor a pagar (R$)
                  </label>
                  <input
                    id="card-payment-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    maxLength={24}
                    autoComplete="off"
                    disabled={captured}
                    required
                  />
                  <p>
                    Informe valor positivo, como 1000,00, sem separador de
                    milhares. O mesmo valor reduz a origem e a dívida exibida do
                    cartão.
                  </p>
                  <label htmlFor="card-payment-name">Nome do pagamento</label>
                  <input
                    id="card-payment-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={Math.max(
                      2000,
                      editing?.source.content.display_name.length ?? 0,
                    )}
                    autoComplete="off"
                    disabled={captured}
                    required
                  />
                  {mode === 'create' ? (
                    <>
                      <label htmlFor="card-payment-original">
                        Descrição original (opcional)
                      </label>
                      <input
                        id="card-payment-original"
                        value={original}
                        onChange={(e) => setOriginal(e.target.value)}
                        maxLength={2000}
                        autoComplete="off"
                        disabled={captured}
                      />
                    </>
                  ) : (
                    <p>
                      O nome informado será usado nos dois lados. Descrições
                      originais, contraparte, tags e classificações existentes
                      são preservadas; rateios múltiplos podem exigir revisão
                      própria.
                    </p>
                  )}
                  <p>
                    Origem: {source ? accountName(source.id) : 'Não escolhida'}.
                    Destino: {target ? accountName(target.id) : 'Não escolhido'}
                    . O efeito no saldo respeita a data e a referência de cada
                    conta.
                  </p>
                </>
              )}
              <label className="backup-ack">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  required
                  disabled={captured}
                />
                {toggle
                  ? `Confirmo a ${mode === 'delete' ? 'exclusão lógica' : 'restauração'} dos dois lados.`
                  : 'Confirmo os dois lados deste pagamento de cartão.'}
              </label>
              <button
                type="submit"
                className="entry-primary"
                disabled={
                  !gateway ||
                  captured ||
                  !ack ||
                  (!toggle &&
                    (!available(sourceId) ||
                      !available(targetId, true) ||
                      sourceId === targetId))
                }
              >
                {
                  {
                    create: 'Confirmar pagamento de cartão',
                    edit: 'Salvar pagamento de cartão',
                    delete: 'Confirmar exclusão conjunta',
                    restore: 'Confirmar restauração conjunta',
                  }[mode as 'create' | 'edit' | 'delete' | 'restore']
                }
              </button>
            </form>
          )}
          {mode !== 'list' && (
            <button type="button" onClick={() => void refresh()}>
              {form
                ? 'Cancelar e consultar resultado'
                : 'Voltar aos pagamentos de cartão'}
            </button>
          )}
        </>
      )}
      <button type="button" onClick={onClose}>
        Voltar às movimentações
      </button>
    </section>
  );
}
