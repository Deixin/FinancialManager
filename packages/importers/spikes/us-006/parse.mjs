import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import {
  checkContext,
  ImportError,
  limits,
  parserVersion,
} from './contract.mjs';
import { parseCsv } from './csv.mjs';
import { parseOfx } from './ofx.mjs';

export async function parseStatement(
  request,
  {
    consume,
    progress = () => {},
    cancelled = () => false,
    now = () => performance.now(),
  } = {},
) {
  checkContext(request.context);
  if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0)
    throw new ImportError('EMPTY_SOURCE');
  if (request.bytes.byteLength > limits.bytes)
    throw new ImportError('FILE_LIMIT');
  if (
    !['CSV', 'OFX'].includes(request.format) ||
    !['utf-8', 'windows-1252'].includes(request.encoding)
  )
    throw new ImportError('UNSUPPORTED_FORMAT');
  if (
    (request.format === 'CSV' &&
      (request.extension !== '.csv' || request.mime !== 'text/csv')) ||
    (request.format === 'OFX' &&
      (request.extension !== '.ofx' ||
        ![
          'application/x-ofx',
          'application/vnd.intu.qfx',
          'text/plain',
        ].includes(request.mime)))
  )
    throw new ImportError('TYPE_MISMATCH');
  const start = now();
  const checkpoint = () => {
    if (cancelled()) throw new ImportError('CANCELLED');
    if (now() - start > limits.timeoutMs) throw new ImportError('TIME_LIMIT');
  };
  let text;
  try {
    text = new TextDecoder(request.encoding, { fatal: true }).decode(
      request.bytes,
    );
  } catch {
    throw new ImportError('INVALID_ENCODING');
  }
  if (
    text.includes('\u0000') ||
    text.includes('\ufffd') ||
    (request.format === 'CSV' && /^\s*[<{]/.test(text))
  )
    throw new ImportError('INVALID_CONTENT');
  checkpoint();
  const digest = createHash('sha256');
  const identities = new Map();
  const similarities = new Map();
  let rows = 0,
    invalid = 0,
    repeated = 0,
    possible = 0,
    sum = 0n,
    periodStart = null,
    periodEnd = null;
  progress({ phase: 'PARSING', rows: 0 });
  const consumeRow = (row) => {
    checkpoint();
    rows++;
    if (row.disposition === 'INVALID') invalid++;
    else {
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            row.normalized_date,
            row.normalized_amount_minor,
            row.proposed_name,
          ]),
        )
        .digest('hex');
      if (row.source_external_id && identities.has(row.source_external_id)) {
        const match = identities.get(row.source_external_id);
        row.disposition =
          match.fingerprint === fingerprint
            ? 'DUPLICATE'
            : 'POSSIBLE_DUPLICATE';
        row.candidate_row_no = match.row;
        row.warnings.push(
          match.fingerprint === fingerprint
            ? 'SOURCE_ID_MATCH'
            : 'SOURCE_ID_DIVERGENCE',
        );
        if (row.disposition === 'DUPLICATE') repeated++;
        else possible++;
      } else if (
        similarities.has(fingerprint) &&
        (!row.source_external_id || !similarities.get(fingerprint).externalId)
      ) {
        row.disposition = 'POSSIBLE_DUPLICATE';
        row.candidate_row_no = similarities.get(fingerprint).row;
        possible++;
        row.warnings.push('SAME_DATE_AMOUNT_DESCRIPTION');
      }
      if (row.source_external_id && !identities.has(row.source_external_id))
        identities.set(row.source_external_id, {
          fingerprint,
          row: row.row_no,
        });
      if (!similarities.has(fingerprint))
        similarities.set(fingerprint, {
          row: row.row_no,
          externalId: row.source_external_id,
        });
      sum += BigInt(row.normalized_amount_minor);
      if (!periodStart || row.normalized_date < periodStart)
        periodStart = row.normalized_date;
      if (!periodEnd || row.normalized_date > periodEnd)
        periodEnd = row.normalized_date;
    }
    digest.update(JSON.stringify(row) + '\n');
    consume(row);
    if (rows % 250 === 0) progress({ phase: 'PARSING', rows });
  };
  const metadata =
    request.format === 'CSV'
      ? await parseCsv(
          text,
          request.context,
          request.mapping,
          consumeRow,
          checkpoint,
        )
      : await parseOfx(
          text,
          request.context,
          request.encoding,
          consumeRow,
          checkpoint,
        );
  checkpoint();
  const result = {
    ...metadata,
    parser_name: 'us006-bounded-' + request.format.toLowerCase(),
    parser_version: parserVersion,
    file_sha256: createHash('sha256').update(request.bytes).digest('hex'),
    normalized_sha256: digest.digest('hex'),
    rows,
    invalid_rows: invalid,
    duplicate_rows: repeated,
    possible_duplicate_rows: possible,
    // A validation checksum of every valid source row, never a ledger balance.
    source_sum_minor: sum.toString(),
    period_start: periodStart,
    period_end: periodEnd,
  };
  progress({ phase: 'NORMALIZED', rows });
  return result;
}
