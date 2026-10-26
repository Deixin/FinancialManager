import { useState } from 'react';
import type { OfxPreview } from './local-ofx-preview.js';
const messages: Readonly<Record<string, string>> = {
  INVALID_DATE: 'Data inválida.',
  INVALID_AMOUNT: 'Valor inválido.',
  AMOUNT_OUT_OF_RANGE: 'Valor fora do limite aceito.',
  ZERO_AMOUNT: 'Valor zero exige correção.',
  INVALID_DESCRIPTION: 'Descrição inválida.',
  INVALID_SOURCE_ID: 'Identificador de origem inválido.',
  UNSUPPORTED_TRANSACTION_TYPE: 'Tipo de operação incompatível.',
  SIGN_TYPE_MISMATCH: 'Sinal do valor incompatível com o tipo.',
  CORRECTION_REQUIRES_REVIEW: 'Correção OFX exige revisão explícita.',
  MISSING_SOURCE_ID: 'Sem identificador de origem.',
  REPEATED_SOURCE_ID: 'Identificador repetido; revisar duplicidade.',
  MOVEMENT_REQUIRES_REVIEW:
    'Revisar transferência ou pagamento separadamente do consumo.',
  DATE_OUTSIDE_SOURCE_PERIOD: 'Data fora do período informado pelo extrato.',
};
function amount(value: string | null) {
  if (value === null) return 'Não interpretado';
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}R$ ${(abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(abs % 100n).toString().padStart(2, '0')}`;
}
export function LocalOfxPreviewFlow({ preview }: { preview: OfxPreview }) {
  const [page, setPage] = useState(0),
    pages = Math.ceil(preview.items.length / 20),
    invalid = preview.items.filter((r) => r.disposition === 'INVALID').length;
  return (
    <section aria-label="Prévia OFX">
      <h2>Prévia OFX</h2>
      <p>
        {preview.items.length} itens: {preview.items.length - invalid} válidos e{' '}
        {invalid} inválidos. Nenhum lançamento foi criado.
      </p>
      <p>
        Moeda: BRL. Período informado: {preview.source.period_start} a{' '}
        {preview.source.period_end}.
      </p>
      {preview.destination.balance_nature === 'LIABILITY' && (
        <p>
          Na conta de cartão, um valor positivo aumenta a dívida e um valor
          negativo a reduz.
        </p>
      )}
      <p>
        Esta prévia não confirma nem descarta itens. A revisão e a confirmação
        financeira estarão disponíveis nos próximos passos.
      </p>
      <p role="status">
        Página {page + 1} de {pages}
      </p>
      {preview.items.slice(page * 20, page * 20 + 20).map((row) => (
        <article key={row.row_no}>
          <h3>
            Item {row.row_no} —{' '}
            {row.disposition === 'INVALID' ? 'Inválido' : 'Válido'}
          </h3>
          <dl>
            <dt>Descrição original</dt>
            <dd>{row.original_description ?? 'Não interpretada'}</dd>
            <dt>Nome proposto</dt>
            <dd>{row.proposed_name ?? 'Não interpretado'}</dd>
            <dt>Data</dt>
            <dd>{row.normalized_date ?? 'Não interpretada'}</dd>
            <dt>Valor na conta</dt>
            <dd>{amount(row.normalized_amount_minor)}</dd>
            <dt>Tipo na origem</dt>
            <dd>{row.source_transaction_type ?? 'Não interpretado'}</dd>
            <dt>Identificador na origem</dt>
            <dd>{row.source_external_id ?? 'Não informado'}</dd>
          </dl>
          {!!row.validation_errors.length && (
            <ul aria-label={`Erros do item ${row.row_no}`}>
              {row.validation_errors.map((e, i) => (
                <li key={i}>{messages[e.code]}</li>
              ))}
            </ul>
          )}
          {!!row.warnings.length && (
            <ul aria-label={`Avisos do item ${row.row_no}`}>
              {row.warnings.map((w) => (
                <li key={w}>{messages[w]}</li>
              ))}
            </ul>
          )}
          <details>
            <summary>Proveniência do item {row.row_no}</summary>
            <p>
              Leitor {row.provenance.parser_name}, versão{' '}
              {row.provenance.parser_version}
            </p>
            <p>Arquivo: {row.provenance.file_hash}</p>
            <p>Origem: {row.provenance.source_locator}</p>
          </details>
        </article>
      ))}
      <nav aria-label="Páginas da prévia OFX">
        <button
          type="button"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          Itens anteriores
        </button>
        <button
          type="button"
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Próximos itens
        </button>
      </nav>
    </section>
  );
}
