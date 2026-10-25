import {
  validateImportFile,
  ImportFileError,
  importFileLimits,
} from './file-validation.js';
import type { ImportFileRequest } from './file-validation.js';
import { ofxParser, OfxParseError } from './ofx-contract.js';
import type { OfxDestination, OfxItem, OfxResult } from './ofx-contract.js';
import { readOfx } from './ofx-reader.js';
import { normalizeOfxRow } from './ofx-normalization.js';
export { ofxParser, OfxParseError };
export type {
  OfxDestination,
  OfxItem,
  OfxResult,
  OfxProvenance,
  OfxRowError,
  OfxRowErrorCode,
  OfxWarning,
  OfxErrorCode,
  OfxTransactionType,
} from './ofx-contract.js';

function captureDestination(raw: OfxDestination): Readonly<OfxDestination> {
  const id = (s: unknown) =>
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      s,
    );
  if (
    !raw ||
    typeof raw !== 'object' ||
    Object.keys(raw).sort().join(',') !==
      'account_id,balance_nature,currency,workspace_id' ||
    !id(raw.workspace_id) ||
    !id(raw.account_id) ||
    !['ASSET', 'LIABILITY'].includes(raw.balance_nature) ||
    raw.currency !== 'BRL'
  )
    throw new OfxParseError('INVALID_DESTINATION');
  return Object.freeze({ ...raw });
}
export async function parseOfx(
  request: ImportFileRequest,
  target: OfxDestination,
  signal?: AbortSignal,
): Promise<Readonly<OfxResult>> {
  const destination = captureDestination(target),
    started = performance.now();
  const checkpoint = () => {
    if (signal?.aborted) throw new ImportFileError('CANCELLED');
    if (performance.now() - started > importFileLimits.time_ms)
      throw new ImportFileError('TIME_LIMIT');
  };
  checkpoint();
  if (
    !request ||
    !(request.bytes instanceof Uint8Array) ||
    !(request.bytes.buffer instanceof ArrayBuffer)
  )
    throw new ImportFileError('INVALID_REQUEST');
  if (request.bytes.byteLength > importFileLimits.bytes)
    throw new ImportFileError('FILE_LIMIT');
  const snapshot = { ...request, bytes: new Uint8Array(request.bytes) };
  const inspected = validateImportFile(snapshot, signal);
  if (inspected.format !== 'OFX')
    throw new ImportFileError('UNSUPPORTED_FORMAT');
  const text = new TextDecoder(snapshot.encoding, { fatal: true }).decode(
    snapshot.bytes,
  );
  const rows: OfxItem[] = [];
  const statement = readOfx(
    text,
    snapshot.encoding,
    checkpoint,
    (fields, locator) =>
      rows.push(normalizeOfxRow(fields, destination, rows.length + 1, locator)),
  );
  if (statement.currency !== destination.currency)
    throw new OfxParseError('CURRENCY_MISMATCH');
  if (statement.liability !== (destination.balance_nature === 'LIABILITY'))
    throw new OfxParseError('ACCOUNT_KIND_MISMATCH');
  if (rows.length !== inspected.records)
    throw new OfxParseError('INVALID_OFX_STRUCTURE');
  const hash = async (bytes: Uint8Array<ArrayBuffer>) => {
    checkpoint();
    let digest: ArrayBuffer;
    try {
      digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    } catch {
      throw new OfxParseError('HASH_UNAVAILABLE');
    }
    checkpoint();
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  };
  const fileHash = await hash(snapshot.bytes);
  const accountHash = await hash(
    new TextEncoder().encode(
      JSON.stringify([
        'OFX',
        statement.liability ? 'CCSTMTRS' : 'STMTRS',
        statement.account.BANKID ?? '',
        statement.account.BRANCHID ?? '',
        statement.account.ACCTID,
        statement.account.ACCTTYPE ?? 'CREDIT_CARD',
      ]),
    ),
  );
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.source_external_id)
      counts.set(
        row.source_external_id,
        (counts.get(row.source_external_id) ?? 0) + 1,
      );
  const items = rows.map((row) => {
    checkpoint();
    const warnings = [...row.warnings];
    if (row.source_external_id && counts.get(row.source_external_id)! > 1)
      warnings.push('REPEATED_SOURCE_ID');
    if (
      row.normalized_date &&
      (row.normalized_date < statement.period_start ||
        row.normalized_date > statement.period_end)
    )
      warnings.push('DATE_OUTSIDE_SOURCE_PERIOD');
    return Object.freeze({
      ...row,
      validation_errors: Object.freeze(
        row.validation_errors.map((e) => Object.freeze(e)),
      ),
      warnings: Object.freeze(warnings),
      provenance: Object.freeze({
        ...row.provenance,
        file_hash: fileHash,
        parser_name: ofxParser.name,
        parser_version: ofxParser.version,
        fields: Object.freeze(row.provenance.fields),
      }),
    });
  });
  checkpoint();
  return Object.freeze({
    model_version: '1',
    destination,
    source: Object.freeze({
      file_name: snapshot.file_name,
      file_hash: fileHash,
      format: 'OFX',
      parser_name: ofxParser.name,
      parser_version: ofxParser.version,
      layout: statement.layout,
      detected_currency: 'BRL',
      period_start: statement.period_start,
      period_end: statement.period_end,
      source_account_hash: accountHash,
    }),
    items: Object.freeze(items),
  });
}
