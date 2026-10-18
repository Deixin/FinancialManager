import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCryptoIdentity } from '@financial-manager/contracts';
import { filterCounterparties } from '@financial-manager/domain/counterparties';
import type {
  Counterparty,
  CounterpartyCommand,
  CounterpartyAssociationCommand,
  CounterpartyQuery,
} from '@financial-manager/domain/counterparties';
import {
  associationEdit,
  captureLocalCounterparty,
  createLocalCounterpartyGateway,
  localCounterpartyMessage,
  verifyAssociationRead,
} from './local-counterparties.js';
import type { CounterpartySnapshot } from './local-counterparties.js';
import { LocalMovementError } from './local-movements.js';
import { formatBrlMinor } from './local-accounts.js';
const relationship = (v: Counterparty['relationship_hint']) =>
  v === 'CUSTOMER'
    ? 'Cliente'
    : v === 'SUPPLIER'
      ? 'Fornecedor'
      : v === 'OTHER'
        ? 'Outro'
        : 'Não informado';
export function LocalCounterpartiesFlow({
  workspaceId,
  transactionId,
  onBack,
  onLocked,
}: {
  workspaceId: string;
  transactionId?: string;
  onBack: () => void;
  onLocked: () => void;
}) {
  const [gateway] = useState(createLocalCounterpartyGateway),
    [snapshot, setSnapshot] = useState<CounterpartySnapshot | null>(null),
    [busy, setBusy] = useState(Boolean(gateway)),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [query, setQuery] = useState<CounterpartyQuery>({
      status: 'ALL',
      relationship_hint: 'ALL',
      search: '',
    }),
    [base, setBase] = useState<Counterparty | null>(null),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(''),
    [type, setType] = useState<Counterparty['identifier_type']>(null),
    [value, setValue] = useState(''),
    [hint, setHint] = useState<Counterparty['relationship_hint']>(null),
    [status, setStatus] = useState<Counterparty['status']>('ACTIVE'),
    [selection, setSelection] = useState('KEEP');
  const alive = useRef(true),
    pending = useRef(false),
    intent = useRef<
      CounterpartyCommand | readonly CounterpartyAssociationCommand[] | null
    >(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [busy, editing]);
  function failure(e: unknown) {
    setError(localCounterpartyMessage(e));
    if (e instanceof LocalMovementError && e.code === 'LOCAL_LOCKED')
      onLocked();
  }
  async function load() {
    if (!gateway || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setSnapshot(null);
    try {
      const next = await gateway.read(workspaceId, Boolean(transactionId));
      if (alive.current) {
        setSnapshot(next);
        intent.current = null;
        setEditing(false);
        setBase(null);
        setSelection('KEEP');
      }
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function edit(item: Counterparty | null) {
    setBase(item);
    setName(item?.display_name ?? '');
    setType(item?.identifier_type ?? null);
    setValue(item?.identifier_value ?? '');
    setHint(item?.relationship_hint ?? null);
    setStatus(item?.status ?? 'ACTIVE');
    setEditing(true);
    setError('');
    setNotice('');
  }
  async function save() {
    if (!gateway || !snapshot || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!intent.current) {
        if (transactionId)
          intent.current = associationEdit(
            snapshot,
            transactionId,
            selection === 'KEEP' || selection === 'CLEAR'
              ? { kind: selection }
              : { kind: 'SET', counterparty_id: selection },
          );
        else {
          const item: Counterparty = {
            id:
              base?.id ??
              createCryptoIdentity(globalThis.crypto, Date.now).newId(),
            workspace_id: workspaceId,
            display_name: name.trim(),
            identifier_type: type,
            identifier_value: type === null ? null : value.trim(),
            relationship_hint: hint,
            status,
          };
          intent.current = captureLocalCounterparty(
            base ? { kind: 'UPDATE', base, item } : { kind: 'CREATE', item },
            workspaceId,
          );
        }
      }
      const attempt = intent.current;
      if (Array.isArray(attempt)) {
        const commands = attempt as readonly CounterpartyAssociationCommand[],
          entries = await gateway.associate(workspaceId, commands);
        if (!alive.current) return;
        const next = await gateway.read(workspaceId, true);
        if (!alive.current) return;
        verifyAssociationRead(next, commands, entries);
        setSnapshot(next);
        setNotice(
          entries.some((r) => r.changed)
            ? 'Contraparte associada. Histórico atualizado.'
            : 'Associação conservada sem nova revisão.',
        );
      } else {
        const result = await gateway.apply(
          workspaceId,
          attempt as CounterpartyCommand,
          snapshot,
        );
        if (!alive.current) return;
        setSnapshot({ workspace_id: workspaceId, items: result.items });
        setNotice(
          result.changed
            ? 'Cadastro salvo.'
            : 'Cadastro já registrado, sem nova alteração.',
        );
      }
      intent.current = null;
      setBase(null);
      setEditing(false);
      setSelection('KEEP');
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
  const current = snapshot?.movements?.transactions.find(
      (r) => r.id === transactionId,
    ),
    frozen = Boolean(intent.current);
  const label = (id: string | null) =>
    id === null
      ? 'Sem contraparte'
      : (snapshot?.items.find((r) => r.id === id)?.display_name ??
        'Contraparte indisponível');
  if (busy)
    return (
      <section className="account-flow" aria-busy="true">
        <h2>Consultando ou registrando contrapartes</h2>
        <p role="status">Aguarde a conclusão da operação no cofre.</p>
      </section>
    );
  const rows = snapshot
    ? filterCounterparties(workspaceId, snapshot.items, query)
    : [];
  return (
    <section
      className="account-flow"
      aria-label={
        transactionId ? 'Editar contraparte' : 'Gerenciar contrapartes'
      }
    >
      <h2 ref={heading} tabIndex={-1}>
        {transactionId ? 'Editar contraparte' : 'Gerenciar contrapartes'}
      </h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!gateway && <p>Abra o aplicativo Desktop para usar o cofre local.</p>}
      {frozen && (
        <>
          <p>
            Os dados desta tentativa estão preservados. A repetição usa a mesma
            base e os mesmos IDs. Consulte o resultado antes de iniciar uma nova
            alteração.
          </p>
          <button type="button" onClick={() => void save()}>
            Repetir mesma tentativa
          </button>
        </>
      )}
      <button type="button" onClick={() => void load()}>
        Consultar resultado e revisar
      </button>
      {transactionId ? (
        current && (
          <>
            <p>
              {current.content.display_name} ·{' '}
              {formatBrlMinor(current.content.account_amount_minor)} · versão{' '}
              {current.version}.
            </p>
            <p>
              Descrição original:{' '}
              {current.content.original_description ?? 'Não informada'}. Origem:{' '}
              {current.content.origin_kind}.
            </p>
            <p>Contraparte atual: {label(current.content.counterparty_id)}.</p>
            <p>
              Esta escolha vale para esta movimentação. Valor, conta, data,
              parcelas, tags e descrição original são preservados.
            </p>
            {current.content.group_id && (
              <p>
                O outro lado será conferido junto e conservará sua contraparte.
              </p>
            )}
            <form onSubmit={submit}>
              <fieldset
                disabled={frozen || !gateway || current.content.deleted}
              >
                <legend>Contraparte da movimentação</legend>
                <label htmlFor="counterparty-selection">
                  Escolha da contraparte
                </label>
                <select
                  id="counterparty-selection"
                  value={selection}
                  onChange={(e) => setSelection(e.target.value)}
                >
                  <option value="KEEP">Conservar associação atual</option>
                  <option value="CLEAR">Remover associação</option>
                  {snapshot!.items
                    .filter(
                      (r) =>
                        r.status === 'ACTIVE' ||
                        r.id === current.content.counterparty_id,
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.display_name} · {relationship(r.relationship_hint)}
                        {r.identifier_value ? ' · ' + r.identifier_value : ''}
                        {r.status === 'ARCHIVED' ? ' (arquivada)' : ''} · {r.id}
                      </option>
                    ))}
                </select>
                <button type="submit">Salvar contraparte</button>
              </fieldset>
            </form>
            <h3>Histórico da contraparte</h3>
            <ul>
              {snapshot!
                .movements!.history.filter(
                  (r) => r.transaction_id === transactionId,
                )
                .map((r) => (
                  <li key={r.id}>
                    Versão {r.version} · {r.change_source} ·{' '}
                    {r.snapshot
                      ? label(
                          r.snapshot.before?.content.counterparty_id ?? null,
                        ) +
                        ' → ' +
                        label(r.snapshot.after.content.counterparty_id)
                      : 'Registro incompatível para leitura detalhada'}
                  </li>
                ))}
            </ul>
          </>
        )
      ) : (
        <>
          <p>
            Cadastros reutilizáveis neste espaço. Nomes ou identificadores
            iguais permanecem separados; escolha o cadastro pelo ID. CPF e CNPJ
            são verificados apenas quanto ao formato.
          </p>
          {!editing && (
            <button
              type="button"
              disabled={!snapshot || !gateway}
              onClick={() => edit(null)}
            >
              Nova contraparte
            </button>
          )}
          {editing && (
            <form onSubmit={submit}>
              <fieldset disabled={frozen || !gateway}>
                <legend>{base ? 'Editar cadastro' : 'Novo cadastro'}</legend>
                {base && <p>ID: {base.id}</p>}
                <label htmlFor="counterparty-name">Nome da contraparte</label>
                <input
                  id="counterparty-name"
                  value={name}
                  required
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
                <label htmlFor="counterparty-type">Tipo de identificador</label>
                <select
                  id="counterparty-type"
                  value={type ?? ''}
                  onChange={(e) => {
                    setType(
                      (e.target.value as Counterparty['identifier_type']) ||
                        null,
                    );
                    setValue('');
                  }}
                >
                  <option value="">Sem identificador</option>
                  <option value="CPF">CPF</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="OTHER">Outro</option>
                </select>
                {type && (
                  <>
                    <label htmlFor="counterparty-identifier">
                      Identificador
                    </label>
                    <input
                      id="counterparty-identifier"
                      value={value}
                      required
                      maxLength={
                        type === 'CPF' ? 11 : type === 'CNPJ' ? 14 : 120
                      }
                      inputMode={type === 'OTHER' ? 'text' : 'numeric'}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </>
                )}
                <label htmlFor="counterparty-relationship">
                  Relacionamento
                </label>
                <select
                  id="counterparty-relationship"
                  value={hint ?? ''}
                  onChange={(e) =>
                    setHint(
                      (e.target.value as Counterparty['relationship_hint']) ||
                        null,
                    )
                  }
                >
                  <option value="">Não informado</option>
                  <option value="CUSTOMER">Cliente</option>
                  <option value="SUPPLIER">Fornecedor</option>
                  <option value="OTHER">Outro</option>
                </select>
                {base && (
                  <>
                    <label htmlFor="counterparty-status">
                      Estado do cadastro
                    </label>
                    <select
                      id="counterparty-status"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as typeof status)
                      }
                    >
                      <option value="ACTIVE">Ativo</option>
                      <option value="ARCHIVED">Arquivado</option>
                    </select>
                  </>
                )}
                <button type="submit">Salvar cadastro</button>
              </fieldset>
            </form>
          )}
          {editing && !frozen && (
            <button type="button" onClick={() => setEditing(false)}>
              Cancelar edição
            </button>
          )}
          <label htmlFor="counterparty-search">Buscar contraparte</label>
          <input
            id="counterparty-search"
            value={query.search}
            maxLength={120}
            onChange={(e) =>
              setQuery({
                ...query,
                search: e.target.value.replace(/\p{Cc}/gu, ''),
              })
            }
          />
          <label htmlFor="counterparty-filter-status">
            Estado das contrapartes
          </label>
          <select
            id="counterparty-filter-status"
            value={query.status}
            onChange={(e) =>
              setQuery({
                ...query,
                status: e.target.value as CounterpartyQuery['status'],
              })
            }
          >
            <option value="ALL">Todos</option>
            <option value="ACTIVE">Ativos</option>
            <option value="ARCHIVED">Arquivados</option>
          </select>
          <label htmlFor="counterparty-filter-relationship">
            Filtrar relacionamento
          </label>
          <select
            id="counterparty-filter-relationship"
            value={query.relationship_hint ?? ''}
            onChange={(e) =>
              setQuery({
                ...query,
                relationship_hint:
                  (e.target.value as CounterpartyQuery['relationship_hint']) ||
                  null,
              })
            }
          >
            <option value="ALL">Todos</option>
            <option value="">Não informado</option>
            <option value="CUSTOMER">Cliente</option>
            <option value="SUPPLIER">Fornecedor</option>
            <option value="OTHER">Outro</option>
          </select>
          <p role="status">{rows.length} contraparte(s).</p>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <strong>{r.display_name}</strong> ·{' '}
                {relationship(r.relationship_hint)} ·{' '}
                {r.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'}
                {r.identifier_value ? ' · ' + r.identifier_value : ''}
                <p>ID: {r.id}</p>
                <button type="button" disabled={frozen} onClick={() => edit(r)}>
                  Editar {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={onBack}>
        Voltar sem nova gravação
      </button>
    </section>
  );
}
