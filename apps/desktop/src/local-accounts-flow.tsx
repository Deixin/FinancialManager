import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import { compareAccountBalance } from '@financial-manager/domain';
import type {
  AccountChange,
  AccountKind,
  AccountState,
} from '@financial-manager/domain';
import {
  createLocalAccountsGateway,
  captureLocalAccountChange,
  accountRows,
  accountKinds,
  parseBrlMinor,
  formatBrlMinor,
  todayFinancial,
  LocalAccountsError,
  localAccountsMessage,
} from './local-accounts.js';
import type { AccountsSnapshot } from './local-accounts.js';

export function LocalAccountsFlow({
  workspaceId,
  onLocked,
  onMovements,
}: {
  workspaceId: string;
  onLocked: () => void;
  onMovements?: (
    accountId: string,
    mode: 'list' | 'create' | 'adjust' | 'cards' | 'payment',
  ) => void;
}) {
  const [gateway] = useState(createLocalAccountsGateway),
    [snapshot, setSnapshot] = useState<AccountsSnapshot | null>(null),
    [busy, setBusy] = useState(Boolean(gateway)),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [mode, setMode] = useState<
      'list' | 'detail' | 'create' | 'edit' | 'reference'
    >('list'),
    [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<AccountState | null>(null),
    [asOf, setAsOf] = useState(todayFinancial),
    [archived, setArchived] = useState(false);
  const [name, setName] = useState(''),
    [institution, setInstitution] = useState(''),
    [kind, setKind] = useState<AccountKind>('CHECKING'),
    [nature, setNature] = useState<'ASSET' | 'LIABILITY'>('ASSET'),
    [withReference, setWithReference] = useState(false),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(todayFinancial),
    [position, setPosition] = useState(''),
    [replaces, setReplaces] = useState(''),
    [ack, setAck] = useState(false),
    [observed, setObserved] = useState(''),
    [comparison, setComparison] = useState('');
  const alive = useRef(true),
    pending = useRef(false),
    request = useRef<AccountChange | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const rows = useMemo(
      () => (snapshot ? accountRows(snapshot, asOf) : []),
      [snapshot, asOf],
    ),
    current = rows.find((r) => r.state.account.id === selected);
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
  useEffect(() => {
    setComparison('');
  }, [asOf, selected, snapshot]);
  function failure(reason: unknown) {
    setError(localAccountsMessage(reason));
    setNotice('');
    if (
      reason instanceof LocalAccountsError &&
      reason.code === 'LOCAL_LOCKED'
    ) {
      setSnapshot(null);
      setEditing(null);
      setMode('list');
      setSelected('');
      setName('');
      setInstitution('');
      setAmount('');
      setObserved('');
      setComparison('');
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
        setObserved('');
      }
    } catch (reason) {
      if (alive.current) failure(reason);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function begin(next: 'create' | 'edit' | 'reference') {
    if (busy || !snapshot || request.current) return;
    setError('');
    setNotice('');
    setMode(next);
    setEditing(next === 'create' ? null : (current?.state ?? null));
    setName(next === 'create' ? '' : (current?.state.account.name ?? ''));
    setInstitution(
      next === 'create' ? '' : (current?.state.account.institution_name ?? ''),
    );
    setKind('CHECKING');
    setNature('ASSET');
    setWithReference(false);
    setAmount('');
    setDate(todayFinancial());
    setPosition('');
    setReplaces('');
    setAck(false);
    setObserved('');
    setComparison('');
  }
  async function apply(change: () => AccountChange) {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      request.current ??= captureLocalAccountChange(change(), workspaceId);
      const result = await gateway.apply(workspaceId, request.current);
      const next = await gateway.read(workspaceId);
      if (!next.accounts.some((s) => s.account.id === result.account_id))
        throw new LocalAccountsError('INVALID_RESPONSE');
      if (alive.current) {
        setSnapshot(next);
        setSelected(result.account_id);
        setMode('detail');
        setEditing(null);
        request.current = null;
        setAmount('');
        setObserved('');
        setComparison('');
        setNotice('Alteração registrada.');
      }
    } catch (reason) {
      if (alive.current) failure(reason);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void apply(() => {
      const identity = createCryptoIdentity(globalThis.crypto, Date.now);
      const reference = () => ({
        id: identity.newId(),
        amount_minor: parseBrlMinor(amount),
        reference_date: date,
        day_position: position as 'START_OF_DAY' | 'END_OF_DAY',
      });
      if (mode === 'create')
        return {
          kind: 'CREATE',
          account: {
            id: identity.newId(),
            name,
            institution_name: institution.trim() ? institution : null,
            account_kind: kind,
            balance_nature: nature,
            currency_code: 'BRL',
          },
          reference: withReference ? reference() : null,
        };
      if (!editing) throw new LocalAccountsError('INVALID_ACCOUNT_CHANGE');
      if (mode === 'edit')
        return {
          kind: 'UPDATE',
          base: editing.account,
          name,
          institution_name:
            institution === editing.account.institution_name
              ? institution
              : institution.trim()
                ? institution
                : null,
          status: editing.account.status,
        };
      if (!ack) throw new LocalAccountsError('INVALID_ACCOUNT_CHANGE');
      return {
        kind: 'REFERENCE',
        account_id: editing.account.id,
        reference: reference(),
        replaces_id: replaces || null,
      };
    });
  }
  function statusChange() {
    if (!current) return;
    const base = current.state.account;
    void apply(() => ({
      kind: 'UPDATE',
      base,
      name: base.name,
      institution_name: base.institution_name,
      status: base.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
    }));
  }
  const captured = Boolean(request.current),
    form = mode === 'create' || mode === 'edit' || mode === 'reference';
  if (busy)
    return (
      <section className="local-empty" aria-busy="true">
        <h2 ref={heading} tabIndex={-1}>
          Acessando contas
        </h2>
        <p role="status">Aguarde a leitura ou gravação no cofre local…</p>
      </section>
    );
  return (
    <section className="local-empty account-flow">
      <h2 ref={heading} tabIndex={-1}>
        {mode === 'create'
          ? 'Nova conta'
          : mode === 'edit'
            ? 'Editar conta'
            : mode === 'reference'
              ? 'Saldo de referência'
              : mode === 'detail'
                ? 'Detalhe da conta'
                : 'Suas contas'}
      </h2>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}>
            Recarregar contas
          </button>
          {captured && (
            <button
              type="button"
              onClick={() => void apply(() => request.current!)}
            >
              Repetir a mesma alteração
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!gateway && (
        <p role="status">
          Use o aplicativo Desktop para acessar as contas. Esta visualização não
          salva dados.
        </p>
      )}
      {snapshot && (
        <>
          <label htmlFor="accounts-as-of">Saldo até a data</label>
          <input
            id="accounts-as-of"
            type="date"
            value={asOf}
            min="0001-01-01"
            max="9999-12-31"
            onChange={(e) => {
              if (e.target.value) setAsOf(e.target.value);
            }}
            disabled={form || captured}
          />
          <p>
            Última leitura do cofre:{' '}
            {new Date(snapshot.read_at).toLocaleString('pt-BR')}. Os saldos são
            estimados enquanto a cobertura do histórico não for comprovada.
          </p>
        </>
      )}
      {mode === 'list' && snapshot && (
        <>
          <button
            className="entry-primary"
            type="button"
            onClick={() => begin('create')}
          >
            Nova conta
          </button>
          <button type="button" onClick={() => void refresh()}>
            Atualizar contas
          </button>
          <label className="backup-ack">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Mostrar contas arquivadas
          </label>
          {rows.length === 0 && (
            <p>
              Cadastre a primeira conta para organizar saldos e referências.
              Nenhum saldo inicial será presumido como completo.
            </p>
          )}
          {(['ASSET', 'LIABILITY'] as const).map((n) => (
            <section
              key={n}
              aria-label={
                n === 'ASSET' ? 'Disponibilidades' : 'Cartões e dívidas'
              }
            >
              <h3>
                {n === 'ASSET' ? 'Disponibilidades' : 'Cartões e dívidas'}
              </h3>
              <ul className="local-list">
                {rows
                  .filter(
                    (r) =>
                      r.state.account.balance_nature === n &&
                      (archived || r.state.account.status === 'ACTIVE'),
                  )
                  .map((r) => (
                    <li key={r.state.account.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(r.state.account.id);
                          setMode('detail');
                          setNotice('');
                          setError('');
                        }}
                      >
                        <strong>{r.state.account.name}</strong>
                        <span>
                          {' '}
                          · {accountKinds[r.state.account.account_kind]} ·{' '}
                          {r.state.account.status === 'ACTIVE'
                            ? 'Ativa'
                            : 'Arquivada'}{' '}
                          ·{' '}
                          {r.value
                            ? formatBrlMinor(r.value.balance.amount_minor)
                            : 'Saldo fora do intervalo suportado'}{' '}
                          · Estimado
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {mode === 'detail' && current && (
        <>
          <h3>{current.state.account.name}</h3>
          <p>
            {accountKinds[current.state.account.account_kind]} ·{' '}
            {current.state.account.balance_nature === 'ASSET'
              ? 'Disponibilidade'
              : 'Dívida / passivo'}{' '}
            · BRL ·{' '}
            {current.state.account.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'}
          </p>
          {current.state.account.institution_name && (
            <p>Instituição: {current.state.account.institution_name}</p>
          )}
          <p>
            {current.state.account.balance_nature === 'LIABILITY'
              ? 'Dívida calculada'
              : 'Saldo calculado'}
            :{' '}
            <strong>
              {current.value
                ? formatBrlMinor(current.value.balance.amount_minor)
                : 'Fora do intervalo suportado'}
            </strong>{' '}
            · Estimado
          </p>
          {current.value && (
            <>
              <p>
                Movimentos considerados: {current.value.considered}, até {asOf}.{' '}
                {current.value.reference
                  ? `Referência de ${current.value.reference.reference_date}, ${current.value.reference.day_position === 'START_OF_DAY' ? 'início' : 'fim'} do dia.`
                  : 'Sem referência para esta data; o saldo pode estar incompleto.'}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    const result = compareAccountBalance(
                      current.value!.balance.amount_minor,
                      parseBrlMinor(observed),
                    );
                    setComparison(
                      result.matches
                        ? 'Os saldos conferem.'
                        : 'Diferença: ' +
                            formatBrlMinor(result.difference_minor),
                    );
                  } catch {
                    setComparison(
                      'Informe um saldo válido; a diferença deve caber no intervalo suportado.',
                    );
                  }
                }}
              >
                <label htmlFor="account-observed">Saldo observado (R$)</label>
                <input
                  id="account-observed"
                  maxLength={24}
                  inputMode="decimal"
                  autoComplete="off"
                  value={observed}
                  onChange={(e) => setObserved(e.target.value)}
                  required
                />
                <button type="submit">Conferir saldo</button>
                <p>
                  Conferir não altera movimentos. Use 1000,00, sem separador de
                  milhares.
                </p>
                {comparison && <p role="status">{comparison}</p>}
              </form>
            </>
          )}
          <button
            type="button"
            onClick={() => begin('edit')}
            disabled={captured}
          >
            Editar conta
          </button>
          <button
            type="button"
            onClick={() => begin('reference')}
            disabled={captured || current.state.account.status !== 'ACTIVE'}
          >
            Adicionar ou corrigir referência
          </button>
          <button type="button" onClick={statusChange} disabled={captured}>
            {current.state.account.status === 'ACTIVE'
              ? 'Arquivar conta'
              : 'Reativar conta'}
          </button>
          <p>Arquivar conserva movimentos e referências.</p>
          {onMovements && (
            <div className="movement-actions">
              {current.state.account.account_kind === 'CREDIT_CARD' &&
                current.state.account.balance_nature === 'LIABILITY' && (
                  <>
                    <button
                      type="button"
                      disabled={captured}
                      onClick={() =>
                        onMovements(current.state.account.id, 'cards')
                      }
                    >
                      Ver cartão e pagamentos
                    </button>
                    <button
                      type="button"
                      disabled={
                        captured || current.state.account.status !== 'ACTIVE'
                      }
                      onClick={() =>
                        onMovements(current.state.account.id, 'payment')
                      }
                    >
                      Pagar cartão
                    </button>
                  </>
                )}
              <button
                type="button"
                onClick={() => onMovements(current.state.account.id, 'list')}
                disabled={captured}
              >
                Ver movimentações
              </button>
              <button
                type="button"
                onClick={() => onMovements(current.state.account.id, 'create')}
                disabled={captured || current.state.account.status !== 'ACTIVE'}
              >
                Adicionar movimentação
              </button>
              <button
                type="button"
                onClick={() => onMovements(current.state.account.id, 'adjust')}
                disabled={captured || current.state.account.status !== 'ACTIVE'}
              >
                Registrar ajuste identificado
              </button>
            </div>
          )}
          <h3>Histórico de referências</h3>
          <ul>
            {current.state.references.map((r) => (
              <li key={r.id}>
                {formatBrlMinor(r.amount_minor)} · {r.reference_date} ·{' '}
                {r.day_position === 'START_OF_DAY' ? 'Início' : 'Fim'} do dia ·{' '}
                {r.status === 'ACTIVE' ? 'Ativa' : 'Substituída'}
              </li>
            ))}
          </ul>
        </>
      )}
      {form && (
        <form onSubmit={submit}>
          {mode !== 'reference' && (
            <>
              <label htmlFor="account-name">Nome da conta</label>
              <input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={Math.max(120, editing?.account.name.length ?? 0)}
                required
                disabled={captured}
                autoComplete="off"
              />
              <label htmlFor="account-institution">
                Instituição (opcional)
              </label>
              <input
                id="account-institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                maxLength={Math.max(
                  120,
                  editing?.account.institution_name?.length ?? 0,
                )}
                disabled={captured}
                autoComplete="off"
              />
              {mode === 'edit' && (
                <p>
                  Tipo, natureza e moeda permanecem os de criação. Nomes antigos
                  podem ser preservados; um novo nome deve ter até 120
                  caracteres.
                </p>
              )}
            </>
          )}
          {mode === 'create' && (
            <>
              <label htmlFor="account-kind">Tipo de conta</label>
              <select
                id="account-kind"
                value={kind}
                disabled={captured}
                onChange={(e) => {
                  const k = e.target.value as AccountKind;
                  setKind(k);
                  setNature(
                    k === 'CREDIT_CARD' || k === 'LOAN_SIMPLE'
                      ? 'LIABILITY'
                      : 'ASSET',
                  );
                }}
              >
                {Object.entries(accountKinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <label htmlFor="account-nature">Natureza</label>
              <select
                id="account-nature"
                value={nature}
                onChange={(e) =>
                  setNature(e.target.value as 'ASSET' | 'LIABILITY')
                }
                disabled={captured || kind !== 'OTHER'}
              >
                <option value="ASSET">Disponibilidade / ativo</option>
                <option value="LIABILITY">Dívida / passivo</option>
              </select>
              <p>
                Moeda: BRL. Investimento e dívida simples não calculam
                rentabilidade, parcelas ou juros futuros.
              </p>
              <label className="backup-ack">
                <input
                  type="checkbox"
                  checked={withReference}
                  onChange={(e) => setWithReference(e.target.checked)}
                  disabled={captured}
                />
                Informar saldo de referência
              </label>
            </>
          )}
          {(mode === 'reference' || (mode === 'create' && withReference)) && (
            <>
              {mode === 'reference' && (
                <>
                  <label htmlFor="account-replaces">
                    Referência a substituir
                  </label>
                  <select
                    id="account-replaces"
                    value={replaces}
                    onChange={(e) => setReplaces(e.target.value)}
                    disabled={captured}
                  >
                    <option value="">
                      Adicionar outro ponto, preservando os anteriores
                    </option>
                    {editing?.references
                      .filter((r) => r.status === 'ACTIVE')
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.reference_date} ·{' '}
                          {r.day_position === 'START_OF_DAY' ? 'Início' : 'Fim'}{' '}
                          do dia · {formatBrlMinor(r.amount_minor)}
                        </option>
                      ))}
                  </select>
                  <p>
                    Uma referência substituída permanece no histórico. Esta ação
                    recalcula o saldo e não cria receita ou despesa.
                  </p>
                </>
              )}
              <label htmlFor="account-amount">Saldo de referência (R$)</label>
              <input
                id="account-amount"
                maxLength={24}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                required
                disabled={captured}
                autoComplete="off"
              />
              <p>
                Use 1000,00, sem separador de milhares. Dívida de cartão é
                positiva; crédito pode ser negativo.
              </p>
              <label htmlFor="account-date">Data de referência</label>
              <input
                id="account-date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={captured}
              />
              <label htmlFor="account-position">Posição no dia</label>
              <select
                id="account-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                required
                disabled={captured}
              >
                <option value="">Escolha início ou fim do dia</option>
                <option value="START_OF_DAY">Início do dia</option>
                <option value="END_OF_DAY">Fim do dia</option>
              </select>
              {mode === 'reference' && (
                <label className="backup-ack">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    disabled={captured}
                    required
                  />
                  Reconheço a alteração da referência e a preservação do
                  histórico.
                </label>
              )}
            </>
          )}
          <button
            type="submit"
            className="entry-primary"
            disabled={!gateway || captured || (mode === 'reference' && !ack)}
          >
            {mode === 'create'
              ? 'Criar conta'
              : mode === 'edit'
                ? 'Salvar conta'
                : 'Salvar referência'}
          </button>
        </form>
      )}
      {mode !== 'list' && (
        <button type="button" onClick={() => void refresh()}>
          {form ? 'Cancelar e verificar contas' : 'Voltar às contas'}
        </button>
      )}
    </section>
  );
}
