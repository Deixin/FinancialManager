import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImportFileGateway,
  decodeInspectedFile,
  LocalFileError,
  fileMessage,
} from '../../apps/desktop/dist/local-import-file.js';
const target = {
    workspace_id: '0199d051-0000-7000-8000-000000000001',
    batch_id: '0199d051-0000-7000-8000-000000000002',
  },
  selection = '0199d051-0000-7000-8000-000000000003',
  options = { encoding: 'utf-8', delimiter: ',' };
const result = {
  outcome: 'VALIDATED',
  file_name: 'SYNTHETIC.csv',
  file_hash: 'a'.repeat(64),
  inspection: {
    policy_version: '1',
    format: 'CSV',
    encoding: 'utf-8',
    byte_length: 7,
    records: 1,
    columns: 2,
    depth: null,
  },
};
test('US-051 Desktop rejects paths and unknown fields before IPC', async () => {
  let calls = 0;
  const gateway = createImportFileGateway(async () => {
    calls++;
    return null;
  });
  await assert.rejects(
    gateway.select({ ...target, path: 'C:\\synthetic.csv' }),
    LocalFileError,
  );
  await assert.rejects(
    gateway.validate(target, selection, { ...options, max_bytes: 999999999 }),
    LocalFileError,
  );
  await assert.rejects(
    gateway.validate(target, 'invalid', options),
    LocalFileError,
  );
  assert.equal(calls, 0);
});
test('US-051 Desktop binds validation acknowledgement to captured workspace batch and selection', async () => {
  let complete;
  const request = { ...target },
    config = { ...options };
  const gateway = createImportFileGateway(async (command, args) => {
    assert.equal(command, 'local_import_file');
    assert.equal(args.input.action, 'VALIDATE');
    await new Promise((resolve) => {
      complete = resolve;
    });
    return { ...target, selection_id: selection, result };
  });
  const pending = gateway.validate(request, selection, config);
  request.workspace_id = selection;
  config.delimiter = ';';
  complete();
  assert.deepEqual(await pending, {
    file_name: result.file_name,
    file_hash: result.file_hash,
    inspection: result.inspection,
  });
  for (const change of [
    { workspace_id: selection },
    { batch_id: selection },
    { selection_id: target.workspace_id },
  ]) {
    const invalid = createImportFileGateway(async () => ({
      ...target,
      selection_id: selection,
      result,
      ...change,
    }));
    await assert.rejects(invalid.validate(target, selection, options), {
      code: 'INVALID_RESPONSE',
    });
  }
});
test('US-051 Desktop rejects malformed metadata and never shows host payload in errors', () => {
  for (const change of [
    { file_name: '../private.csv' },
    { file_name: '.csv' },
    { file_name: 'SYNTHETIC\ud800.csv' },
    { file_hash: 'invalid' },
    { path: 'C:\\private.csv' },
    { inspection: { ...result.inspection, records: 10001 } },
    { inspection: { ...result.inspection, records: 0 } },
    { inspection: { ...result.inspection, format: 'XLSX' } },
    { inspection: { ...result.inspection, encoding: 'windows-1252' } },
  ])
    assert.throws(
      () => decodeInspectedFile({ ...result, ...change }, options),
      { code: 'INVALID_RESPONSE' },
    );
  const valid = decodeInspectedFile(result, options);
  assert.ok(Object.isFrozen(valid) && Object.isFrozen(valid.inspection));
  const error = new LocalFileError('SYNTHETIC private payload');
  assert.equal(error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(fileMessage(error).includes('payload'), false);
});
test('US-051 Desktop validates rejection and cancellation contracts', async () => {
  const gateway = createImportFileGateway(async (_command, args) =>
    args.input.action === 'CANCEL'
      ? { cancelled: true }
      : args.input.action === 'SELECT'
        ? { selection_id: null }
        : {
            ...target,
            selection_id: selection,
            result: { outcome: 'REJECTED', code: 'ACTIVE_CONTENT' },
          },
  );
  assert.equal(await gateway.select(target), null);
  await gateway.cancel(target);
  await assert.rejects(gateway.validate(target, selection, options), {
    code: 'ACTIVE_CONTENT',
  });
});
