import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { ImportError, limits, normalizeRow } from './contract.mjs';

export async function parseCsv(text, context, mapping, consume, checkpoint) {
  if (
    !mapping ||
    ![',', ';', '\t'].includes(mapping.delimiter) ||
    !['YYYY-MM-DD', 'DD/MM/YYYY'].includes(mapping.dateFormat) ||
    !['SIGNED_CASH_FLOW', 'ACCOUNT_DELTA', 'DEBIT_CREDIT'].includes(
      mapping.amountMode,
    ) ||
    !['.', ','].includes(mapping.decimal) ||
    ![null, '.', ','].includes(mapping.grouping) ||
    mapping.decimal === mapping.grouping
  )
    throw new ImportError('INVALID_MAPPING');
  const required = [
    'date',
    'description',
    ...(mapping.amountMode === 'DEBIT_CREDIT'
      ? ['debit', 'credit']
      : ['amount']),
  ];
  const selected = [
    ...required,
    ...(mapping.columns?.externalId === undefined ? [] : ['externalId']),
  ];
  if (
    !mapping.columns ||
    selected.some(
      (key) =>
        typeof mapping.columns[key] !== 'string' || !mapping.columns[key],
    ) ||
    new Set(selected.map((key) => mapping.columns[key])).size !==
      selected.length
  )
    throw new ImportError('INVALID_MAPPING');
  let header;
  let count = 0;
  const parser = parse({
    delimiter: mapping.delimiter,
    bom: true,
    cast: false,
    cast_date: false,
    columns: false,
    info: true,
    max_record_size: limits.recordChars,
    relax_column_count: true,
    skip_empty_lines: false,
    skip_records_with_error: false,
  });
  function* chunks() {
    for (let i = 0; i < text.length; i += 16384) yield text.slice(i, i + 16384);
  }
  const input = Readable.from(chunks());
  input.on('error', () => parser.destroy(new ImportError('INVALID_CSV')));
  input.pipe(parser);
  try {
    for await (const { record, info } of parser) {
      checkpoint();
      if (
        record.length > limits.columns ||
        record.some((value) => value.length > limits.fieldChars)
      )
        throw new ImportError('RECORD_LIMIT');
      if (!header) {
        header = record.map((value) => value.trim());
        if (
          new Set(header).size !== header.length ||
          header.some((value) => !value) ||
          selected.some((key) => !header.includes(mapping.columns[key]))
        )
          throw new ImportError('INVALID_HEADER');
        continue;
      }
      count++;
      if (count > limits.rows) throw new ImportError('ROW_LIMIT');
      const raw = {
        row: count,
        locator: `csv:record:${count + 1}:end-line:${info.lines}`,
      };
      for (const key of selected)
        raw[key] = record[header.indexOf(mapping.columns[key])] ?? '';
      const normalized = normalizeRow(raw, {
        ...mapping,
        ...context,
        format: 'CSV',
      });
      if (record.length !== header.length) {
        normalized.disposition = 'INVALID';
        normalized.validation_errors.push({
          field: 'row',
          code: 'COLUMN_COUNT',
        });
      }
      consume(normalized);
      if (count % 250 === 0) await setImmediate();
    }
    if (!header || count === 0) throw new ImportError('EMPTY_SOURCE');
    return {
      layout: 'csv-explicit-mapping-v1',
      rows: count,
      source_account_hash: null,
    };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(
      error.code === 'CSV_MAX_RECORD_SIZE' ? 'RECORD_LIMIT' : 'INVALID_CSV',
    );
  } finally {
    input.destroy();
    parser.destroy();
  }
}
