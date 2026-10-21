import {
  importFileLimits as limits,
  rejectFile,
} from './file-validation-policy.js';

export function inspectCsv(
  text: string,
  delimiter: string,
  checkpoint: () => void,
) {
  // CSV has no magic number. Require delimited text, excluding markup/JSON
  // masquerading as CSV, and leave semantic mapping/invalid rows to US-053.
  if (/^\s*[<[{]/.test(text)) rejectFile('TYPE_MISMATCH');
  let state: 'START' | 'TEXT' | 'QUOTED' | 'CLOSED' = 'START';
  let field = 0,
    record = 0,
    columns = 1,
    maximumColumns = 0,
    records = 0;
  const finishField = () => {
    if (field > limits.field_chars) rejectFile('FIELD_LIMIT');
    field = 0;
  };
  const finishRecord = () => {
    finishField();
    if (records === 0 && columns < 2) rejectFile('TYPE_MISMATCH');
    maximumColumns = Math.max(maximumColumns, columns);
    if (++records > limits.records + 1) rejectFile('ROW_LIMIT');
    columns = 1;
    record = 0;
    state = 'START';
  };
  for (let i = 0; i < text.length; i++) {
    if (i % 4096 === 0) checkpoint();
    const char = text[i]!;
    const terminator = state !== 'QUOTED' && (char === '\r' || char === '\n');
    if (!terminator && ++record > limits.record_chars)
      rejectFile('RECORD_LIMIT');
    if (state === 'QUOTED') {
      if (char === '"') state = 'CLOSED';
      else field++;
    } else if (char === '"') {
      if (state === 'START') state = 'QUOTED';
      else if (state === 'CLOSED') {
        state = 'QUOTED';
        field++;
      } else rejectFile('INVALID_CSV');
    } else if (char === delimiter) {
      finishField();
      if (++columns > limits.columns) rejectFile('COLUMN_LIMIT');
      state = 'START';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRecord();
    } else {
      if (state === 'CLOSED') rejectFile('INVALID_CSV');
      state = 'TEXT';
      field++;
    }
    if (field > limits.field_chars) rejectFile('FIELD_LIMIT');
  }
  if (state === 'QUOTED') rejectFile('INVALID_CSV');
  if (record > 0) finishRecord();
  if (records < 2) rejectFile('EMPTY_FILE');
  return { records: records - 1, columns: maximumColumns, depth: null };
}
