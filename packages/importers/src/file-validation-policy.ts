export const importFileLimits = Object.freeze({
  bytes: 16 * 1024 * 1024,
  records: 10000,
  columns: 64,
  field_chars: 2048,
  record_chars: 8192,
  lines: 200000,
  depth: 32,
  nodes: 500000,
  time_ms: 30000,
});

export type ImportFileErrorCode =
  | 'INVALID_REQUEST'
  | 'EMPTY_FILE'
  | 'FILE_LIMIT'
  | 'UNSUPPORTED_FORMAT'
  | 'TYPE_MISMATCH'
  | 'ENCODING_MISMATCH'
  | 'INVALID_ENCODING'
  | 'INVALID_CONTENT'
  | 'LINE_LIMIT'
  | 'ROW_LIMIT'
  | 'COLUMN_LIMIT'
  | 'FIELD_LIMIT'
  | 'RECORD_LIMIT'
  | 'INVALID_CSV'
  | 'INVALID_OFX'
  | 'UNSUPPORTED_LAYOUT'
  | 'ACTIVE_CONTENT'
  | 'DEPTH_LIMIT'
  | 'NODE_LIMIT'
  | 'TIME_LIMIT'
  | 'CANCELLED';

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(code);
    this.name = 'ImportFileError';
  }
}
export function rejectFile(code: ImportFileErrorCode): never {
  throw new ImportFileError(code);
}
