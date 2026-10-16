import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { runParser } from './coordinator.mjs';
import {
  context,
  mapping,
  csvFixture,
  ofxFixture,
  expectedRows,
  amounts,
} from './fixtures.mjs';
import {
  Staging,
  migration,
  migrationHash,
} from '../../packages/importers/spikes/us-006/staging.mjs';
import { limits } from '../../packages/importers/spikes/us-006/contract.mjs';

export const artifactNames = [
  'source.fixture',
  'staging.sqlite',
  'staging.sqlite-journal',
  'ledger.sqlite',
  'ledger.sqlite-journal',
];
export const cleanup = (directory) => {
  for (const name of artifactNames)
    rmSync(path.join(directory, name), { force: true });
};
export async function homologate(directory, progress) {
  const input = path.join(directory, 'source.fixture'),
    staging = path.join(directory, 'staging.sqlite'),
    ledger = path.join(directory, 'ledger.sqlite');
  const checks = {},
    benchmarks = [];
  let stage = 'setup';
  const step = (name) => {
    stage = name;
    progress(name);
  };
  const passed = () => {
    checks[stage] = true;
  };
  const hash = (file) =>
    createHash('sha256').update(readFileSync(file)).digest('hex');
  cleanup(directory);
  const baseline = new DatabaseSync(ledger);
  baseline.exec(
    'CREATE TABLE synthetic_ledger(id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL);',
  );
  baseline
    .prepare('INSERT INTO synthetic_ledger VALUES(1,?)')
    .run(9007199254740993n);
  baseline.close();
  const ledgerHash = hash(ledger);
  const assertLedger = () => assert.equal(hash(ledger), ledgerHash);
  const readPreview = () => {
    const store = new Staging(staging);
    try {
      return {
        batches: store.db.prepare('SELECT * FROM import_batch').all(),
        rows: store.db
          .prepare('SELECT body FROM import_item ORDER BY row_no')
          .all()
          .map((row) => JSON.parse(row.body)),
      };
    } finally {
      store.close();
    }
  };
  const execute = async (
    text,
    format = 'CSV',
    overrides = {},
    control = {},
  ) => {
    for (const suffix of ['', '-journal'])
      rmSync(staging + suffix, { force: true });
    writeFileSync(
      input,
      typeof text === 'string' ? Buffer.from(text, 'utf8') : text,
      { mode: 0o600 },
    );
    const start = performance.now();
    const result = await runParser({
      input,
      staging,
      request: {
        context,
        format,
        encoding: 'utf-8',
        extension: format === 'CSV' ? '.csv' : '.ofx',
        mime: format === 'CSV' ? 'text/csv' : 'application/x-ofx',
        ...(format === 'CSV' ? { mapping } : {}),
        ...overrides,
      },
      ...control,
    });
    result.wall_ms = Math.ceil(performance.now() - start);
    assert.equal(result.stdout, '');
    for (const value of [
      'SYNTHETIC',
      ...amounts,
      ...expectedRows(5).map((row) => row.minor),
    ])
      assert.equal(result.stderr.includes(value), false);
    assertLedger();
    return result;
  };
  const failure = async (text, format, code, overrides = {}, control = {}) => {
    const result = await execute(text, format, overrides, control);
    assert.equal(result.type, 'failure');
    assert.equal(result.code, code);
    if (existsSync(staging)) {
      const recovered = readPreview();
      assert.equal(recovered.batches.length, 0);
      assert.equal(recovered.rows.length, 0);
    }
    return result;
  };
  try {
    step('atomic_migration_checksum_and_reopen');
    assert.throws(
      () =>
        new Staging(
          staging,
          migration + '\nSELECT nonexistent_synthetic_function();',
        ),
    );
    const raw = new DatabaseSync(staging);
    assert.equal(
      raw
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
        .get().n,
      0,
    );
    raw.close();
    const store = new Staging(staging);
    store.close();
    const reopened = new Staging(staging);
    reopened.close();
    assert.throws(() => new Staging(staging, migration + '\n-- changed'), {
      code: 'MIGRATION_MISMATCH',
    });
    passed();
    step('csv_10k_preview_benchmark');
    const profiles = [
      ['CSV', 'csv-explicit-mapping-v1', csvFixture()],
      ['OFX', 'ofx-102-bank-card-v1', ofxFixture()],
      ['OFX', 'ofx-2xml-bank-card-v1', ofxFixture(10000, { xml: true })],
    ];
    for (const [format, layout, text] of profiles) {
      if (format === 'OFX')
        step(
          layout === 'ofx-102-bank-card-v1'
            ? 'ofx_sgml_10k_preview_benchmark'
            : 'ofx_xml_10k_preview_benchmark',
        );
      const samples = [];
      let maxRss = 0,
        metadata;
      for (let sample = 0; sample < 3; sample++) {
        const result = await execute(text, format);
        assert.equal(result.code, 'OK');
        assert.equal(result.metadata.layout, layout);
        assert.ok(result.wall_ms <= limits.timeoutMs);
        assert.ok(result.peak_rss_kib <= 256 * 1024);
        const preview = readPreview();
        assert.equal(preview.rows.length, 10000);
        assert.equal(preview.batches.length, 1);
        assert.equal(preview.batches[0].status, 'REVIEW');
        assert.equal(preview.batches[0].workspace_id, context.workspace_id);
        assert.equal(preview.batches[0].account_id, context.account_id);
        assert.equal(result.metadata.invalid_rows, 0);
        assert.equal(result.metadata.duplicate_rows, 0);
        assert.equal(result.metadata.possible_duplicate_rows, 0);
        for (const [index, expected] of expectedRows().entries()) {
          const actual = preview.rows[index];
          assert.equal(actual.normalized_date, expected.date);
          assert.equal(actual.normalized_amount_minor, expected.minor);
          assert.equal(actual.original_description, expected.description);
          assert.equal(actual.source_external_id, expected.externalId);
          assert.equal(actual.economic_kind, null);
          assert.equal(actual.provenance.parser_version, '0.1.0');
        }
        const exact = new DatabaseSync(staging, { readOnly: true });
        const statement = exact.prepare(
          'SELECT normalized_amount_minor AS amount FROM import_item ORDER BY row_no LIMIT 5',
        );
        statement.setReadBigInts(true);
        assert.deepEqual(
          statement.all().map((row) => row.amount.toString()),
          expectedRows(5).map((row) => row.minor),
        );
        exact.close();
        if (metadata)
          assert.equal(
            result.metadata.normalized_sha256,
            metadata.normalized_sha256,
          );
        metadata = result.metadata;
        samples.push(result.wall_ms);
        maxRss = Math.max(maxRss, result.peak_rss_kib);
      }
      benchmarks.push({
        layout,
        rows: 10000,
        input_bytes: Buffer.byteLength(text),
        samples_ms: samples,
        peak_rss_kib: maxRss,
        source_sha256: metadata.file_sha256,
        normalized_sha256: metadata.normalized_sha256,
      });
      passed();
    }
    step('exact_normalization_signs_dates_and_provenance');
    const cardText = ofxFixture(5, { xml: true, card: true }).replace(
      '-92233720368547758.08',
      '-92233720368547758.07',
    );
    const card = await execute(cardText, 'OFX', {
      context: { ...context, balance_nature: 'LIABILITY' },
    });
    assert.equal(card.code, 'OK');
    const cardRows = readPreview().rows;
    assert.equal(cardRows[1].normalized_amount_minor, '9223372036854775807');
    assert.equal(cardRows[0].normalized_amount_minor, '-9007199254740993');
    assert.equal(cardRows[0].normalized_date, '2026-10-01');
    assert.equal(cardRows[0].source_fields.type, 'CREDIT');
    assert.ok(card.metadata.source_account_hash);
    passed();
    step('explicit_csv_mapping_debit_credit_and_literal_formulas');
    const splitMapping = {
      ...mapping,
      amountMode: 'DEBIT_CREDIT',
      columns: {
        date: 'Data',
        description: 'Descrição',
        debit: 'Débito',
        credit: 'Crédito',
      },
    };
    const split = await execute(
      'Data;Descrição;Débito;Crédito\n16/10/2026;=SYNTHETIC(1);1.234,56;\n16/10/2026;SYNTHETIC crédito;;7,89\n',
      'CSV',
      { mapping: splitMapping },
    );
    assert.equal(split.code, 'OK');
    const splitRows = readPreview().rows;
    assert.equal(splitRows[0].normalized_amount_minor, '-123456');
    assert.equal(splitRows[1].normalized_amount_minor, '789');
    assert.equal(splitRows[0].original_description, '=SYNTHETIC(1)');
    assert.deepEqual(splitRows[0].warnings, ['FORMULA_LIKE_TEXT']);
    passed();
    step('utf8_bom_and_explicit_windows1252');
    const cpText = ofxFixture(5, { encoding: 'windows-1252' });
    const cp = await execute(Buffer.from(cpText, 'latin1'), 'OFX', {
      encoding: 'windows-1252',
    });
    assert.equal(cp.code, 'OK');
    assert.equal(
      readPreview().rows[0].original_description,
      expectedRows(1)[0].description,
    );
    await failure(Buffer.from([0xc3, 0x28]), 'CSV', 'INVALID_ENCODING');
    await failure(ofxFixture(5), 'OFX', 'ENCODING_MISMATCH', {
      encoding: 'windows-1252',
    });
    passed();
    step('invalid_rows_are_visible_and_preserved');
    const bad = await execute(
      'Data;Descrição;Valor;ID\n31/02/2026;SYNTHETIC;1,234;bad-1\n16/10/2026;SYNTHETIC;1,00;bad-2;extra\n',
      'CSV',
    );
    assert.equal(bad.code, 'OK');
    const rows = readPreview().rows;
    assert.equal(rows.length, 2);
    assert.equal(bad.metadata.invalid_rows, 2);
    assert.ok(rows.every((row) => row.disposition === 'INVALID'));
    assert.ok(
      rows[0].validation_errors.some((error) => error.code === 'INVALID_DATE'),
    );
    assert.ok(
      rows[1].validation_errors.some((error) => error.code === 'COLUMN_COUNT'),
    );
    passed();
    step('duplicates_divergence_and_legitimate_equal_purchases');
    const duplicate = await execute(
      'Data;Descrição;Valor;ID\n16/10/2026;SYNTHETIC compra;1,00;one\n16/10/2026;SYNTHETIC compra;1,00;one\n16/10/2026;SYNTHETIC compra;2,00;one\n16/10/2026;SYNTHETIC compra;1,00;two\n16/10/2026;SYNTHETIC compra;1,00;\n',
      'CSV',
    );
    assert.equal(duplicate.code, 'OK');
    assert.deepEqual(
      readPreview().rows.map((row) => row.disposition),
      ['NEW', 'DUPLICATE', 'POSSIBLE_DUPLICATE', 'NEW', 'POSSIBLE_DUPLICATE'],
    );
    assert.equal(duplicate.metadata.rows, 5);
    passed();
    step('type_structure_and_encoding_rejections');
    await failure(csvFixture(5), 'CSV', 'TYPE_MISMATCH', { extension: '.pdf' });
    await failure(csvFixture(5), 'CSV', 'TYPE_MISMATCH', {
      mime: 'application/pdf',
    });
    await failure(
      'Data;Descrição;Valor;ID\n"unterminated',
      'CSV',
      'INVALID_CSV',
    );
    await failure('Data;Data;Valor;ID\n1;2;3;4', 'CSV', 'INVALID_HEADER');
    await failure(ofxFixture(5).slice(0, -6), 'OFX', 'INVALID_OFX');
    await failure(
      ofxFixture(5).replace('<CURDEF>BRL', '<CURDEF>USD'),
      'OFX',
      'CURRENCY_MISMATCH',
    );
    await failure(ofxFixture(5), 'OFX', 'ACCOUNT_KIND_MISMATCH', {
      context: { ...context, balance_nature: 'LIABILITY' },
    });
    await failure(
      'Data;Descrição;Valor;ID\n1;SYNTHETIC\0;1;id',
      'CSV',
      'INVALID_CONTENT',
    );
    passed();
    step('xxe_entities_and_unknown_ofx_layout_rejected');
    for (const declaration of [
      '<!DOCTYPE OFX [<!ENTITY xxe SYSTEM "file:///SYNTHETIC">]>',
      '<!DOCTYPE OFX [<!ENTITY a "&a;&a;">]>',
    ])
      await failure(
        ofxFixture(5, { xml: true }).replace('<OFX>', declaration + '<OFX>'),
        'OFX',
        'XML_DECLARATION_FORBIDDEN',
      );
    await failure(
      ofxFixture(5, { xml: true }).replace('SYNTHETIC-ID-000001', '&xxe;'),
      'OFX',
      'INVALID_OFX',
    );
    await failure(
      ofxFixture(5).replace('<BANKTRANLIST>', '<INVTRANLIST>'),
      'OFX',
      'UNSUPPORTED_LAYOUT',
    );
    await failure(
      ofxFixture(5).replace('<DTSTART>20261001', '<DTSTART>20261101'),
      'OFX',
      'INVALID_PERIOD',
    );
    passed();
    step('size_row_record_column_and_time_limits');
    await failure(Buffer.alloc(limits.bytes + 1, 65), 'CSV', 'FILE_LIMIT');
    await failure(csvFixture(10001), 'CSV', 'ROW_LIMIT');
    await failure(
      'Data;Descrição;Valor;ID\n16/10/2026;"' +
        'A'.repeat(limits.recordChars + 1) +
        '";1,00;id\n',
      'CSV',
      'RECORD_LIMIT',
    );
    await failure(
      Array.from({ length: 65 }, (_, i) => 'col' + i).join(';'),
      'CSV',
      'RECORD_LIMIT',
    );
    await failure(csvFixture(), 'CSV', 'TIME_LIMIT', {}, { timeoutMs: 1 });
    passed();
    step('progress_and_mid_parse_cancellation_roll_back');
    const cancelled = await failure(
      csvFixture(),
      'CSV',
      'CANCELLED',
      {},
      { cancelAt: 250 },
    );
    assert.ok(cancelled.progress.some((entry) => entry.rows >= 250));
    assert.ok(
      !cancelled.progress.some((entry) => entry.phase === 'PREVIEW_READY'),
    );
    passed();
    step('abrupt_worker_death_recovers_empty_staging');
    await failure(ofxFixture(), 'OFX', 'INTERRUPTED', {}, { killAt: 250 });
    passed();
    step('cancel_completed_500_row_preview_leaves_ledger_unchanged');
    const small = await execute(csvFixture(500));
    assert.equal(small.code, 'OK');
    assert.equal(readPreview().rows.length, 500);
    rmSync(staging, { force: true });
    assertLedger();
    passed();
    step('operational_logs_have_no_source_payload');
    // Every execute inspected both child streams without publishing them.
    passed();
    step('staging_only_and_financial_ledger_byte_identical');
    assertLedger();
    passed();
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'ofx-csv-10k-parser-spike',
      passed: true,
      checks,
      benchmarks,
      migration_sha256: migrationHash,
    };
  } catch {
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'ofx-csv-10k-parser-spike',
      passed: false,
      checks,
      failed_step: stage,
    };
  } finally {
    cleanup(directory);
  }
}
