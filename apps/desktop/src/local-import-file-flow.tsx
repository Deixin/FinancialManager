import { useEffect, useRef, useState } from 'react';
import type { FileOptions, InspectedFile } from './local-import-file.js';
export function LocalImportFileFlow({
  busy,
  selected,
  result,
  error,
  onValidate,
  onCancel,
}: {
  busy: 'selecting' | 'validating' | null;
  selected: boolean;
  result: InspectedFile | null;
  error: string;
  onValidate: (options: FileOptions) => void;
  onCancel: () => void;
}) {
  const [encoding, setEncoding] = useState<FileOptions['encoding']>('utf-8'),
    [format, setFormat] = useState('CSV'),
    [delimiter, setDelimiter] = useState<FileOptions['delimiter']>(',');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [busy, selected, result, error]);
  return (
    <main className="local-main">
      <section
        className="entry-card local-card local-imports"
        aria-busy={!!busy}
      >
        <h1 tabIndex={-1} ref={heading}>
          Validar arquivo de importação
        </h1>
        {busy ? (
          <p role="status">
            {busy === 'selecting'
              ? 'Escolha um extrato no diálogo do Windows. Com PIN ativo, será necessário desbloquear novamente.'
              : 'Validando o arquivo localmente…'}
          </p>
        ) : result ? (
          <>
            <h2>Estrutura validada</h2>
            <p>{result.file_name}</p>
            <dl>
              <dt>Formato</dt>
              <dd>{result.inspection.format}</dd>
              <dt>Registros identificados</dt>
              <dd>{result.inspection.records}</dd>
              <dt>Tamanho em bytes</dt>
              <dd>{result.inspection.byte_length}</dd>
            </dl>
            <p>
              O arquivo ainda não foi importado. Nenhum lançamento foi criado.
            </p>
          </>
        ) : selected ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onValidate({
                encoding,
                delimiter: format === 'OFX' ? null : delimiter,
              });
            }}
          >
            <p>
              Confira as opções usadas na exportação. A validação não altera
              saldos ou movimentações.
            </p>
            <label htmlFor="file-format">Formato exportado</label>
            <select
              id="file-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="CSV">CSV</option>
              <option value="OFX">OFX</option>
            </select>
            <label htmlFor="file-encoding">Encoding do arquivo</label>
            <select
              id="file-encoding"
              value={encoding}
              onChange={(e) =>
                setEncoding(e.target.value as FileOptions['encoding'])
              }
            >
              <option value="utf-8">UTF-8</option>
              <option value="windows-1252">Windows-1252</option>
            </select>
            {format === 'CSV' && (
              <>
                <label htmlFor="file-delimiter">Separador de colunas</label>
                <select
                  id="file-delimiter"
                  value={delimiter ?? ','}
                  onChange={(e) =>
                    setDelimiter(e.target.value as FileOptions['delimiter'])
                  }
                >
                  <option value=",">Vírgula</option>
                  <option value=";">Ponto e vírgula</option>
                  <option value={'\t'}>Tabulação</option>
                </select>
              </>
            )}
            <button type="submit">Validar arquivo</button>
          </form>
        ) : !error ? (
          <p role="status">Seleção cancelada. Nenhum lançamento foi criado.</p>
        ) : null}
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={onCancel}>
          {busy ? 'Cancelar validação' : 'Voltar às importações'}
        </button>
      </section>
    </main>
  );
}
