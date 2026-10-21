import { inspectCsv } from './file-validation-csv.js';
import { inspectOfx } from './file-validation-ofx.js';
import {
  ImportFileError,
  importFileLimits,
  rejectFile,
} from './file-validation-policy.js';
export { ImportFileError, importFileLimits };
export type { ImportFileErrorCode } from './file-validation-policy.js';

export interface ImportFileRequest {
  readonly file_name: string;
  readonly mime: string;
  readonly encoding: 'utf-8' | 'windows-1252';
  readonly delimiter: ',' | ';' | '\t' | null;
  readonly bytes: Uint8Array;
}

export interface ImportFileResult {
  readonly policy_version: '1';
  readonly format: 'CSV' | 'OFX';
  readonly encoding: 'utf-8' | 'windows-1252';
  readonly byte_length: number;
  readonly records: number;
  readonly columns: number | null;
  readonly depth: number | null;
}

// Metadata is only a hint. A bounded snapshot is decoded and inspected before
// success. No file, network, DOM, archive expansion or financial write port.
export function validateImportFile(
  request: ImportFileRequest,
  signal?: AbortSignal,
): Readonly<ImportFileResult> {
  if (
    !request ||
    typeof request !== 'object' ||
    Object.keys(request).sort().join(',') !==
      'bytes,delimiter,encoding,file_name,mime' ||
    typeof request.file_name !== 'string' ||
    request.file_name.length > 255 ||
    !request.file_name ||
    request.file_name.trim() !== request.file_name ||
    /[\p{Cc}\p{Cf}\\/:]/u.test(request.file_name) ||
    /[. ]$/.test(request.file_name) ||
    typeof request.mime !== 'string' ||
    request.mime.length > 128 ||
    !['utf-8', 'windows-1252'].includes(request.encoding) ||
    ![null, ',', ';', '\t'].includes(request.delimiter)
  )
    rejectFile('INVALID_REQUEST');
  if (
    !(request.bytes instanceof Uint8Array) ||
    !(request.bytes.buffer instanceof ArrayBuffer)
  )
    rejectFile('INVALID_REQUEST');
  if (request.bytes.byteLength === 0) rejectFile('EMPTY_FILE');
  if (request.bytes.byteLength > importFileLimits.bytes)
    rejectFile('FILE_LIMIT');
  const started = performance.now();
  const checkpoint = () => {
    if (signal?.aborted) rejectFile('CANCELLED');
    if (performance.now() - started > importFileLimits.time_ms)
      rejectFile('TIME_LIMIT');
  };
  checkpoint();
  const extension = request.file_name
    .slice(request.file_name.lastIndexOf('.') + 1)
    .toLowerCase();
  // Containers, PDF and fiscal XML stay closed until their bounded readers
  // are integrated. Even a tiny ZIP is never inflated by this gate.
  if (
    request.file_name.lastIndexOf('.') < 1 ||
    !['csv', 'ofx'].includes(extension)
  )
    rejectFile('UNSUPPORTED_FORMAT');
  const format = extension === 'csv' ? 'CSV' : 'OFX';
  if ((format === 'CSV') !== (request.delimiter !== null))
    rejectFile('INVALID_REQUEST');
  const mime =
    /^([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:\s*;\s*charset=(utf-8|windows-1252))?$/i.exec(
      request.mime,
    );
  const allowed =
    format === 'CSV'
      ? ['text/csv', 'text/plain', 'application/octet-stream']
      : [
          'application/x-ofx',
          'application/vnd.intu.qfx',
          'text/plain',
          'application/octet-stream',
        ];
  if (
    request.mime !== '' &&
    (!mime ||
      !allowed.includes(mime[1]!.toLowerCase()) ||
      (mime[2] && mime[2].toLowerCase() !== request.encoding))
  )
    rejectFile('TYPE_MISMATCH');
  const bytes = new Uint8Array(request.bytes);
  // Refuse common binary signatures even when their bytes are valid text.
  const prefix = Array.from(bytes.subarray(0, 8));
  const begins = (...values: number[]) =>
    values.every((value, i) => prefix[i] === value);
  if (
    begins(0x50, 0x4b) ||
    begins(0x25, 0x50, 0x44, 0x46) ||
    begins(0x4d, 0x5a) ||
    begins(0x7f, 0x45, 0x4c, 0x46) ||
    begins(0xd0, 0xcf) ||
    begins(0x1f, 0x8b) ||
    begins(0x89, 0x50, 0x4e, 0x47) ||
    begins(0xff, 0xd8)
  )
    rejectFile('TYPE_MISMATCH');
  if (
    begins(0xff, 0xfe) ||
    begins(0xfe, 0xff) ||
    (request.encoding !== 'utf-8' && begins(0xef, 0xbb, 0xbf))
  )
    rejectFile('ENCODING_MISMATCH');
  let text: string;
  try {
    text = new TextDecoder(request.encoding, { fatal: true }).decode(bytes);
  } catch {
    rejectFile('INVALID_ENCODING');
  }
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (i % 4096 === 0) checkpoint();
    const code = text.charCodeAt(i);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0xfffd ||
      code === 0xfffe ||
      code === 0xffff
    )
      rejectFile('INVALID_CONTENT');
    if (code === 10 || (code === 13 && text[i + 1] !== '\n')) lines++;
    if (lines > importFileLimits.lines) rejectFile('LINE_LIMIT');
  }
  checkpoint();
  const inspection =
    format === 'CSV'
      ? inspectCsv(text, request.delimiter!, checkpoint)
      : inspectOfx(text, request.encoding, checkpoint);
  checkpoint();
  return Object.freeze({
    policy_version: '1',
    format,
    encoding: request.encoding,
    byte_length: bytes.length,
    ...inspection,
  });
}
