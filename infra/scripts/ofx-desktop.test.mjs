import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOfx,
  validateImportFile,
} from '../../packages/importers/dist/index.js';
import { decodeOfxPreview } from '../../apps/desktop/dist/local-ofx-preview.js';
import {
  createImportFileGateway,
  LocalFileError,
} from '../../apps/desktop/dist/local-import-file.js';
import {
  destination,
  request,
  statement,
  transaction,
} from '../ofx-parser/corpus.mjs';
const target = {
    workspace_id: destination.workspace_id,
    account_id: destination.account_id,
    batch_id: '0199d052-0000-7000-8000-000000000003',
  },
  selection = '0199d052-0000-7000-8000-000000000004',
  options = { encoding: 'utf-8', delimiter: null };
async function fixture() {
  const req = request(
    statement(
      transaction() + transaction({ FITID: 'SYNTHETIC-2', TRNAMT: 'invalid' }),
    ),
  );
  const model = await parseOfx(req, destination);
  return {
    model,
    expected: { ...target, ...model.source, records: model.items.length },
    inspection: validateImportFile(req),
  };
}
test('US-052 Desktop captures complete OFX model as an immutable account-bound preview', async () => {
  const { model, expected } = await fixture();
  const actual = decodeOfxPreview(model, expected);
  assert.deepEqual(actual, model);
  assert.ok(Object.isFrozen(actual.items[0].provenance.fields));
  assert.equal(actual.items[1].disposition, 'INVALID');
});
test('US-052 Desktop rejects malformed scope money counts codes provenance and unknown payload', async () => {
  const { model, expected } = await fixture();
  for (const mutate of [
    (m) => {
      m.destination.workspace_id = target.batch_id;
    },
    (m) => {
      m.destination.account_id = target.batch_id;
    },
    (m) => {
      m.source.file_hash = '0'.repeat(64);
    },
    (m) => {
      m.items.pop();
    },
    (m) => {
      m.items[0].normalized_amount_minor = '1.0';
    },
    (m) => {
      m.items[0].normalized_amount_minor = '9223372036854775808';
    },
    (m) => {
      m.items[0].provenance.fields.amount = 'C:\\SYNTHETIC';
    },
    (m) => {
      m.items[1].disposition = 'NEW';
    },
    (m) => {
      m.items[1].validation_errors[0].code = 'SYNTHETIC_SECRET';
    },
    (m) => {
      m.items[0].row_no = 2;
    },
    (m) => {
      m.items[0].warnings.push('SYNTHETIC_UNKNOWN');
    },
    (m) => {
      m.source.original = 'SYNTHETIC';
    },
    (m) => {
      m.items[0].source_transaction_type = 'EXECUTE';
    },
  ]) {
    const invalid = globalThis.structuredClone(model);
    mutate(invalid);
    assert.throws(() => decodeOfxPreview(invalid, expected));
  }
});
test('US-052 Desktop never forwards client account authority and rejects mismatched model ACK', async () => {
  const { model, inspection } = await fixture();
  let wrong = false;
  const gateway = createImportFileGateway(async (command, args) => {
    assert.equal(command, 'local_import_file');
    assert.deepEqual(Object.keys(args.input).sort(), [
      'action',
      'batch_id',
      'delimiter',
      'encoding',
      'selection_id',
    ]);
    return {
      workspace_id: target.workspace_id,
      batch_id: target.batch_id,
      selection_id: selection,
      result: {
        outcome: 'VALIDATED',
        file_name: model.source.file_name,
        file_hash: model.source.file_hash,
        inspection,
        normalization: wrong
          ? {
              ...model,
              destination: {
                ...model.destination,
                account_id: target.batch_id,
              },
            }
          : model,
      },
    };
  });
  assert.deepEqual(
    (await gateway.validate(target, selection, options)).normalization,
    model,
  );
  wrong = true;
  await assert.rejects(
    gateway.validate(target, selection, options),
    LocalFileError,
  );
});

test('US-052 Desktop rejects missing mandatory source warnings', async () => {
  const req = request(
    statement(
      transaction({ TRNTYPE: 'XFER', DTPOSTED: '20250101' }) +
        transaction() +
        transaction({ FITID: null }),
    ),
  );
  const model = await parseOfx(req, destination),
    expected = { ...target, ...model.source, records: model.items.length };
  assert.deepEqual(decodeOfxPreview(model, expected), model);
  for (let i = 0; i < model.items.length; i++)
    for (let j = 0; j < model.items[i].warnings.length; j++) {
      const changed = globalThis.structuredClone(model);
      changed.items[i].warnings.splice(j, 1);
      assert.throws(() => decodeOfxPreview(changed, expected));
    }
});

test('US-052 Desktop accepts all ten thousand items and canonical credit-card signs', async () => {
  const large = await parseOfx(
    request(
      statement(
        Array.from({ length: 10000 }, (_, i) =>
          transaction({ FITID: 'SYNTHETIC-' + i }),
        ).join(''),
      ),
    ),
    destination,
  );
  const expected = { ...target, ...large.source, records: 10000 };
  const preview = decodeOfxPreview(large, expected);
  assert.equal(preview.items.length, 10000);
  assert.equal(preview.items[9999].row_no, 10000);
  const card = await parseOfx(
    request(
      statement(
        transaction({ TRNTYPE: 'DEBIT', TRNAMT: '-1.23' }) +
          transaction({ TRNTYPE: 'CREDIT', TRNAMT: '1', FITID: 'SYNTHETIC-2' }),
        { card: true },
      ),
    ),
    { ...destination, balance_nature: 'LIABILITY' },
  );
  assert.deepEqual(
    decodeOfxPreview(card, { ...target, ...card.source, records: 2 }).items.map(
      (r) => r.normalized_amount_minor,
    ),
    ['123', '-100'],
  );
});
