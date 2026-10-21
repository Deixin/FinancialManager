import assert from 'node:assert/strict';
import { fixture } from '../fixtures/loader.mjs';
import { ids as revisionIds } from '../revisions/scenarios.mjs';
import { createImportHarness, id, at, request, grant } from './harness.mjs';
import {
  itemDispositions,
  effectActions,
  importStatuses,
} from '../../packages/domain/dist/imports.js';
import { sqliteImportCatalog } from '../../packages/storage-schema/dist/import-migrations.js';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { createDualPool } from '../schema/dual-postgres.mjs';
import { migratePostgresTo, sha256 } from '../schema/postgres-migrations.mjs';
import { postgresImportCatalog } from './migrations.mjs';
import { activeDataUnit } from '../../packages/persistence-postgres/dist/internal/unit-scope.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
export const importCases = Object.freeze([
  'prepare_replay_conflict_and_no_financial_effect',
  'concurrent_prepare_has_one_creation',
  'source_counts_results_and_revision_links_are_batch_scoped',
  'keyset_filters_same_timestamp_and_statuses',
  'restricted_accounts_hide_whole_mixed_batch_and_advance_cursor',
  'authorization_before_connection_and_capture_before_await',
  'workspace_and_account_boundaries',
  'failure_after_insert_rolls_back_and_is_sanitized',
  'close_drains_authorization_and_refuses_new_work',
  'schema_constraints_reject_cross_batch_and_cross_workspace',
  'effects_are_append_only_and_revision_identity_is_checked',
  'invalid_items_preserve_missing_values_without_financial_writes',
]);
export const extraChecks = Object.freeze([
  'migrations_v3_guarded_empty_roundtrip',
  'import_equal_projection_cross_engine',
  'import_nonempty_downgrade_preserves_ledger',
  'sqlite_import_local_without_cloud_identity',
  'sqlite_import_failed_rollback_poisoned_connection',
  'postgres_import_rls_role_and_nested_unit',
  'import_snapshot_is_consistent_during_concurrent_write',
  'postgres_import_period_is_independent_of_process_timezone',
]);
const detail = (id) => ({ id, effect_after: null, effect_limit: 100 });
function batch(w, account, n, status = 'PREPARING') {
  return {
    id: id(n),
    workspace_id: w,
    target_account_id: account,
    batch_kind: 'IMPORT',
    status,
    reverses_batch_id: null,
    created_by_member_id: id(90),
    created_at: at,
    committed_at: ['COMMITTED', 'REVERSED', 'PARTIALLY_REVERSED'].includes(
      status,
    )
      ? at
      : null,
    version: '1',
    failure_code: status === 'FAILED' ? 'SYNTHETIC_REJECTED' : null,
  };
}
async function seed(h, w, account) {
  for (let n = 0; n < importStatuses.length; n++)
    await h.insert(
      'import_batch',
      batch(w, account, 100 + n, importStatuses[n]),
    );
  const source = {
    id: id(200),
    workspace_id: w,
    batch_id: id(103),
    file_name: 'SYNTHETIC-CENTRAL.ofx',
    file_hash: 'a'.repeat(64),
    format: 'OFX',
    parser_name: 'synthetic',
    parser_version: '1',
    detected_currency: 'BRL',
    period_start: '2026-10-01',
    period_end: '2026-10-20',
    imported_at: at,
  };
  await h.insert('import_source', source);
  for (let n = 0; n < itemDispositions.length; n++)
    await h.insert('import_item', {
      id: id(300 + n),
      workspace_id: w,
      batch_id: id(103),
      source_id: source.id,
      row_no: String(n + 1),
      source_external_id: 'SYNTHETIC-' + n,
      normalized_date: ['INVALID', 'SKIPPED'].includes(itemDispositions[n])
        ? null
        : '2026-10-20',
      normalized_amount_minor: ['INVALID', 'SKIPPED'].includes(
        itemDispositions[n],
      )
        ? null
        : '-9223372036854775808',
      original_description: 'SYNTHETIC PRIVATE IMPORT DESCRIPTION',
      disposition: itemDispositions[n],
      validation_errors: '[]',
      provenance: '{}',
      version: '1',
    });
  const revisions = await h.query(
    'SELECT id,transaction_id FROM transaction_revision WHERE workspace_id=? ORDER BY transaction_id,version',
    [w],
  );
  const transaction = revisions.find(
      (r) =>
        revisions.filter((x) => x.transaction_id === r.transaction_id).length >=
        2,
    )?.transaction_id,
    history = revisions.filter((r) => r.transaction_id === transaction);
  assert.ok(history.length >= 2);
  for (let n = 0; n < effectActions.length; n++)
    await h.insert('import_effect', {
      id: id(400 + n),
      workspace_id: w,
      batch_id: id(103),
      import_item_id: id(306),
      transaction_id: transaction,
      action: effectActions[n],
      before_revision_id: effectActions[n] === 'CREATE' ? null : history[0].id,
      after_revision_id: history[1].id,
      created_at: at,
    });
  return { source, transaction, history };
}
async function cases(h, step) {
  const w = fixture.workspace_a,
    req = request(w),
    financial = await h.snapshot(w),
    account = financial.financial_account.find((a) => a.status === 'ACTIVE').id;
  const otherAccount = financial.financial_account.find(
    (a) => a.id !== account,
  ).id;
  const service = h.make(w);
  await step(importCases[0], async () => {
    const command = { id: id(1), target_account_id: account },
      first = await service.prepare(req, command);
    assert.equal(first.created, true);
    assert.equal(first.batch.status, 'PREPARING');
    assert.equal(first.counts.total_items, '0');
    const replay = await service.prepare(req, command);
    assert.equal(replay.created, false);
    assert.deepEqual(replay.batch, first.batch);
    await assert.rejects(
      service.prepare(req, { ...command, target_account_id: otherAccount }),
      { code: 'IMPORT_BASE_CONFLICT' },
    );
    await assert.rejects(
      h
        .make(w, {
          authorize: async (r) => ({ ...grant(r), member_id: id(91) }),
        })
        .prepare(req, command),
      { code: 'IMPORT_BASE_CONFLICT' },
    );
    await assert.rejects(
      service.prepare(req, { id: id(2), target_account_id: id(9999) }),
      { code: 'IMPORT_ACCOUNT_UNAVAILABLE' },
    );
    assert.deepEqual(await h.snapshot(w), financial);
  });
  await step(importCases[1], async () => {
    const command = { id: id(3), target_account_id: account },
      results = await Promise.all([
        service.prepare(req, command),
        service.prepare(req, command),
      ]);
    assert.deepEqual(results.map((r) => r.created).sort(), [false, true]);
  });
  const seeded = await seed(h, w, account);
  await step(importCases[2], async () => {
    const result = await service.detail(req, detail(id(103)));
    assert.equal(result.batch.id, id(103));
    assert.equal(result.sources.length, 1);
    assert.deepEqual(result.sources[0], seeded.source);
    assert.equal(result.counts.total_items, '7');
    assert.equal(result.counts.total_effects, '6');
    for (const key of itemDispositions)
      assert.equal(result.counts.items[key], '1');
    for (const key of effectActions)
      assert.equal(result.counts.effects[key], '1');
    assert.equal(result.effects.length, 6);
    assert.ok(
      result.effects.every(
        (e) =>
          e.transaction_id === seeded.transaction &&
          e.after_revision_id === seeded.history[1].id,
      ),
    );
    assert.equal(
      JSON.stringify(result).includes('PRIVATE IMPORT DESCRIPTION'),
      false,
    );
    const empty = await service.detail(req, detail(id(102)));
    assert.equal(empty.counts.total_items, '0');
    assert.deepEqual(empty.sources, []);
    const page = await service.detail(req, {
      ...detail(id(103)),
      effect_limit: 2,
    });
    assert.equal(page.effects.length, 2);
    assert.equal(page.next_effect_cursor, id(401));
    const next = await service.detail(req, {
      ...detail(id(103)),
      effect_after: page.next_effect_cursor,
      effect_limit: 2,
    });
    assert.deepEqual(
      next.effects.map((e) => e.id),
      [id(402), id(403)],
    );
    await assert.rejects(service.detail(req, detail(id(999))), {
      code: 'IMPORT_NOT_FOUND',
    });
  });
  await step(importCases[3], async () => {
    const ids = [];
    let cursor = null;
    do {
      const page = await service.list(req, {
        statuses: [],
        account_id: null,
        cursor,
        limit: 2,
      });
      ids.push(...page.items.map((r) => r.batch.id));
      cursor = page.next_cursor;
    } while (cursor);
    assert.equal(new Set(ids).size, 9);
    assert.deepEqual(ids, [...ids].sort().reverse());
    for (const status of importStatuses) {
      const r = await service.list(req, {
        statuses: [status],
        account_id: account,
        cursor: null,
        limit: 100,
      });
      assert.ok(r.items.length >= 1);
      assert.ok(r.items.every((i) => i.batch.status === status));
    }
    assert.deepEqual(
      (
        await service.list(req, {
          statuses: [],
          account_id: otherAccount,
          cursor: null,
          limit: 5,
        })
      ).items,
      [],
    );
  });
  await step(importCases[4], async () => {
    await h.insert('import_batch', batch(w, account, 500));
    await h.insert('import_batch', batch(w, null, 501));
    await h.insert('import_item', {
      id: id(502),
      workspace_id: w,
      batch_id: id(500),
      disposition: 'SKIPPED',
    });
    const tx = (
      await h.query(
        'SELECT id FROM financial_transaction WHERE workspace_id=? AND account_id=? ORDER BY id',
        [w, otherAccount],
      )
    )[0];
    assert.ok(tx);
    await h.insert('import_effect', {
      id: id(503),
      workspace_id: w,
      batch_id: id(500),
      import_item_id: id(502),
      transaction_id: tx.id,
      action: 'LINK',
      before_revision_id: null,
      after_revision_id: null,
      created_at: at,
    });
    const scoped = h.make(w, {
      authorize: async (r) => ({ ...grant(r), account_ids: [account] }),
    });
    const first = await scoped.list(req, {
      statuses: [],
      account_id: null,
      cursor: null,
      limit: 1,
    });
    assert.deepEqual(first.items, []);
    assert.deepEqual(first.next_cursor, { id: id(500), created_at: at });
    const next = await scoped.list(req, {
      statuses: [],
      account_id: null,
      cursor: first.next_cursor,
      limit: 100,
    });
    assert.ok(next.items.length);
    assert.ok(
      next.items.every((i) => i.batch.id !== id(500) && i.batch.id !== id(501)),
    );
    await assert.rejects(scoped.detail(req, detail(id(500))), {
      code: 'IMPORT_NOT_FOUND',
    });
    await assert.rejects(scoped.detail(req, detail(id(501))), {
      code: 'IMPORT_NOT_FOUND',
    });
    await assert.rejects(
      scoped.prepare(req, { id: id(500), target_account_id: account }),
      { code: 'IMPORT_NOT_FOUND' },
    );
    await assert.rejects(
      scoped.list(req, {
        statuses: [],
        account_id: otherAccount,
        cursor: null,
        limit: 2,
      }),
      { code: 'ACCESS_DENIED' },
    );
    assert.deepEqual(
      (
        await h
          .make(w, {
            authorize: async (r) => ({ ...grant(r), account_ids: [] }),
          })
          .list(req)
      ).items,
      [],
    );
  });
  await step(importCases[5], async () => {
    let release, entered;
    const wait = new Promise((r) => (release = r)),
      start = new Promise((r) => (entered = r));
    const mutable = request(w),
      command = { id: id(600), target_account_id: account };
    const unit = h.make(w, {
      authorize: async (r) => {
        assert.ok(Object.isFrozen(r));
        entered();
        await wait;
        return grant(r);
      },
    });
    const pending = unit.prepare(mutable, command);
    await start;
    mutable.workspace_id = fixture.workspace_b;
    command.target_account_id = otherAccount;
    release();
    const result = await pending;
    assert.equal(result.batch.workspace_id, w);
    assert.equal(result.batch.target_account_id, account);
    for (const value of [
      null,
      { ...grant(req), workspace_id: fixture.workspace_b },
      { ...grant(req), can_read: false },
      { ...grant(req), can_prepare: false },
    ])
      await assert.rejects(
        h
          .make(w, { authorize: async () => value })
          .prepare(req, { id: id(601), target_account_id: account }),
        { code: 'ACCESS_DENIED' },
      );
  });
  await step(importCases[6], async () => {
    const foreign = (await h.snapshot(fixture.workspace_b)).financial_account[0]
      .id;
    await assert.rejects(
      service.prepare(req, { id: id(610), target_account_id: foreign }),
      { code: 'IMPORT_ACCOUNT_UNAVAILABLE' },
    );
    const foreignService = h.make(fixture.workspace_b);
    await assert.rejects(
      foreignService.detail(request(fixture.workspace_b), detail(id(103))),
      { code: 'IMPORT_NOT_FOUND' },
    );
    assert.deepEqual(
      (await foreignService.list(request(fixture.workspace_b))).items,
      [],
    );
    await h.query(
      "UPDATE financial_account SET status='ARCHIVED' WHERE workspace_id=? AND id=?",
      [w, account],
    );
    try {
      await assert.rejects(
        service.prepare(req, { id: id(611), target_account_id: account }),
        { code: 'IMPORT_ACCOUNT_UNAVAILABLE' },
      );
      assert.equal(
        (await service.prepare(req, { id: id(1), target_account_id: account }))
          .created,
        false,
      );
    } finally {
      await h.query(
        "UPDATE financial_account SET status='ACTIVE' WHERE workspace_id=? AND id=?",
        [w, account],
      );
    }
  });
  await step(importCases[7], async () => {
    await assert.rejects(
      h
        .make(w, { fail_after_insert: true })
        .prepare(req, { id: id(620), target_account_id: account }),
      { code: 'DATA_ACCESS_FAILED', message: 'DATA_ACCESS_FAILED' },
    );
    assert.deepEqual(
      await h.query('SELECT id FROM import_batch WHERE id=?', [id(620)]),
      [],
    );
  });
  await step(importCases[8], async () => {
    let release, entered;
    const wait = new Promise((r) => (release = r)),
      start = new Promise((r) => (entered = r));
    const unit = h.make(w, {
        authorize: async (r) => {
          entered();
          await wait;
          return grant(r);
        },
      }),
      pending = unit.list(req);
    await start;
    let ended = false;
    const closing = unit.close().then(() => (ended = true));
    await Promise.resolve();
    assert.equal(ended, false);
    await assert.rejects(unit.list(req), { code: 'CLOSED' });
    release();
    await pending;
    await closing;
    await unit.close();
  });
  await step(importCases[9], async () => {
    const foreign = (await h.snapshot(fixture.workspace_b)).financial_account[0]
      .id;
    await assert.rejects(h.insert('import_batch', batch(w, foreign, 630)));
    await assert.rejects(
      h.insert('import_item', {
        id: id(631),
        workspace_id: w,
        batch_id: id(100),
        source_id: id(200),
        disposition: 'SKIPPED',
      }),
    );
    await assert.rejects(
      h.insert('import_effect', {
        id: id(632),
        workspace_id: w,
        batch_id: id(100),
        import_item_id: id(306),
        transaction_id: seeded.transaction,
        action: 'LINK',
        created_at: at,
      }),
    );
    await assert.rejects(
      h.insert('import_batch', {
        ...batch(w, account, 633),
        status: 'COMMITTED',
      }),
    );
    await assert.rejects(
      h.insert('import_batch', {
        ...batch(w, account, 634),
        batch_kind: 'REVERSAL',
      }),
    );
    await assert.rejects(
      h.insert('import_source', {
        ...seeded.source,
        id: id(635),
        file_hash: 'x'.repeat(64),
      }),
    );
    await assert.rejects(
      h.insert('import_source', {
        ...seeded.source,
        id: id(636),
        period_start: '2026-02-30',
      }),
    );
  });
  await step(importCases[10], async () => {
    await assert.rejects(
      h.query("UPDATE import_effect SET action='UNLINK' WHERE id=?", [id(400)]),
    );
    await assert.rejects(
      h.query('DELETE FROM import_effect WHERE id=?', [id(400)]),
    );
    const foreignRevision = (
      await h.query(
        'SELECT id FROM transaction_revision WHERE workspace_id=? AND transaction_id<>? ORDER BY id',
        [w, seeded.transaction],
      )
    )[0];
    assert.ok(foreignRevision);
    await assert.rejects(
      h.insert('import_effect', {
        id: id(640),
        workspace_id: w,
        batch_id: id(103),
        import_item_id: id(306),
        transaction_id: seeded.transaction,
        action: 'CREATE',
        after_revision_id: foreignRevision.id,
        created_at: at,
      }),
    );
  });
  await step(importCases[11], async () => {
    await assert.rejects(
      h.insert('import_item', {
        id: id(650),
        workspace_id: w,
        batch_id: id(100),
        disposition: 'NEW',
      }),
    );
    await h.insert('import_item', {
      id: id(651),
      workspace_id: w,
      batch_id: id(100),
      disposition: 'INVALID',
      validation_errors: '["SYNTHETIC_DATE_INVALID"]',
    });
    assert.equal(
      (await service.detail(req, detail(id(100)))).counts.items.INVALID,
      '1',
    );
    assert.deepEqual(await h.snapshot(w), financial);
  });
  return { service, req, account };
}
export async function runImportProtocol(
  sqlite,
  pools,
  admin,
  step,
  { credentials },
) {
  const local = createImportHarness('sqlite', { sqlite }),
    cloud = createImportHarness('postgresql', { pools, admin });
  try {
    const a = await cases(local, (n, run) => step('sqlite_import_' + n, run)),
      b = await cases(cloud, (n, run) => step('postgresql_import_' + n, run));
    await step('import_equal_projection_cross_engine', async () => {
      assert.deepEqual(
        await a.service.list(a.req),
        await b.service.list(b.req),
      );
      // Revision IDs are generated independently by each real engine protocol.
      // Compare their persisted versions; each exact ID was checked in its engine case.
      async function versions(h, result) {
        const rows = await h.query(
          'SELECT id,CAST(version AS TEXT) AS version FROM transaction_revision WHERE workspace_id=?',
          [fixture.workspace_a],
        );
        const map = new Map(rows.map((r) => [r.id, r.version]));
        return {
          ...result,
          effects: result.effects.map((e) => ({
            ...e,
            before_revision_id:
              e.before_revision_id === null
                ? null
                : map.get(e.before_revision_id),
            after_revision_id:
              e.after_revision_id === null
                ? null
                : map.get(e.after_revision_id),
          })),
        };
      }
      assert.deepEqual(
        await versions(local, await a.service.detail(a.req, detail(id(103)))),
        await versions(cloud, await b.service.detail(b.req, detail(id(103)))),
      );
    });
    await step(
      'postgres_import_period_is_independent_of_process_timezone',
      async () => {
        const previous = process.env.TZ;
        try {
          for (const zone of [
            'UTC',
            'Asia/Tokyo',
            'Pacific/Kiritimati',
            'America/Fortaleza',
          ]) {
            process.env.TZ = zone;
            const result = await b.service.detail(b.req, detail(id(103)));
            assert.equal(result.sources[0].period_start, '2026-10-01');
            assert.equal(result.sources[0].period_end, '2026-10-20');
            assert.equal(result.batch.created_at, at);
          }
        } finally {
          if (previous === undefined) delete process.env.TZ;
          else process.env.TZ = previous;
        }
      },
    );
    await step('import_nonempty_downgrade_preserves_ledger', async () => {
      const before = await a.service.list(a.req);
      await assert.rejects(
        migrateSqliteTo(sqlite.db, {
          sha256,
          catalog: sqliteImportCatalog,
          target: 2,
        }),
      );
      assert.deepEqual(await a.service.list(a.req), before);
      const migrator = createDualPool(
        'fm_schema_migrator',
        credentials.migrator,
      );
      try {
        await assert.rejects(
          migratePostgresTo(migrator, {
            catalog: await postgresImportCatalog(),
            target: 2,
          }),
        );
      } finally {
        await migrator.end();
      }
      assert.deepEqual(await b.service.list(b.req), before);
      assert.ok(
        (
          await admin.query(
            "SELECT relforcerowsecurity FROM pg_class WHERE oid IN ('fm.import_batch'::regclass,'fm.import_source'::regclass,'fm.import_item'::regclass,'fm.import_effect'::regclass)",
          )
        ).rows.every((r) => r.relforcerowsecurity),
      );
    });
    await step('sqlite_import_local_without_cloud_identity', async () => {
      const unit = local.make(revisionIds.local, {
        authorize: async (r) => ({
          ...grant(r),
          authority: 'LOCAL',
          member_id: null,
        }),
      });
      const result = await unit.prepare(
        { workspace_id: revisionIds.local },
        { id: id(700), target_account_id: revisionIds.localAccount },
      );
      assert.equal(result.batch.created_by_member_id, null);
      await assert.rejects(unit.list(request(revisionIds.local)), {
        code: 'ACCESS_DENIED',
      });
    });
    await step('postgres_import_rls_role_and_nested_unit', async () => {
      const unit = cloud.make(fixture.workspace_a, { role: 'b' });
      await assert.rejects(unit.list(request(fixture.workspace_a)), {
        code: 'ACCESS_DENIED',
      });
      await assert.rejects(
        unit.prepare(request(fixture.workspace_a), {
          id: id(710),
          target_account_id: b.account,
        }),
        { code: 'ACCESS_DENIED' },
      );
      await assert.rejects(
        cloud
          .make(fixture.workspace_a, { expected_role: 'us021_b' })
          .list(b.req),
        { code: 'CONFIGURATION_INVALID' },
      );
      await activeDataUnit.run(true, () =>
        assert.rejects(b.service.list(b.req), { code: 'NESTED_UNIT' }),
      );
      const client = await pools.b.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.workspace_id',$1,true)", [
          fixture.workspace_a,
        ]);
        assert.equal(
          (await client.query('SELECT id FROM fm.import_batch')).rowCount,
          0,
        );
        await assert.rejects(
          client.query(
            "INSERT INTO fm.import_batch(id,workspace_id,target_account_id,batch_kind,status,created_at) VALUES($1,$2,$3,'IMPORT','PREPARING',$4)",
            [id(711), fixture.workspace_a, b.account, at],
          ),
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    await step(
      'import_snapshot_is_consistent_during_concurrent_write',
      async () => {
        // PostgreSQL snapshot established by workspace read; fixture writer commits between parent and counts.
        let written = false;
        const unit = cloud.make(fixture.workspace_a, {
          after_query: async (text) => {
            if (
              !written &&
              text.includes('"import_batch"') &&
              text.startsWith('select')
            ) {
              written = true;
              await cloud.insert('import_item', {
                id: id(720),
                workspace_id: fixture.workspace_a,
                batch_id: id(100),
                disposition: 'SKIPPED',
              });
            }
          },
        });
        assert.equal(
          (await unit.detail(b.req, detail(id(100)))).counts.total_items,
          '1',
        );
        assert.equal(written, true);
        assert.equal(
          (await b.service.detail(b.req, detail(id(100)))).counts.total_items,
          '2',
        );
        await sqlite.db.exec('PRAGMA journal_mode=WAL');
        const file = (await sqlite.db.rows('PRAGMA database_list')).find(
          (r) => r.name === 'main',
        ).file;
        const writer = openProbeDatabase(file);
        let saved = false;
        try {
          await writer.db.exec('PRAGMA foreign_keys=ON');
          const reader = local.make(fixture.workspace_a, {
            after_query: async (text) => {
              if (!saved && /FROM import_batch WHERE/i.test(text)) {
                saved = true;
                await writer.db.run(
                  "INSERT INTO import_item(id,workspace_id,batch_id,disposition) VALUES(?,?,?,'SKIPPED')",
                  [id(721), fixture.workspace_a, id(100)],
                );
              }
            },
          });
          assert.equal(
            (await reader.detail(a.req, detail(id(100)))).counts.total_items,
            '1',
          );
          assert.equal(saved, true);
          assert.equal(
            (await a.service.detail(a.req, detail(id(100)))).counts.total_items,
            '2',
          );
        } finally {
          writer.close();
          await sqlite.db.exec('PRAGMA journal_mode=DELETE');
        }
      },
    );
    await step(
      'sqlite_import_failed_rollback_poisoned_connection',
      async () => {
        const unit = local.make(fixture.workspace_a, {
          fail_after_insert: true,
          fail_rollback: true,
        });
        try {
          await assert.rejects(
            unit.prepare(a.req, { id: id(730), target_account_id: a.account }),
            { code: 'DATA_ACCESS_FAILED' },
          );
          await assert.rejects(unit.list(a.req), {
            code: 'DATA_ACCESS_FAILED',
          });
        } finally {
          await sqlite.db.exec('ROLLBACK');
        }
        assert.deepEqual(
          await local.query('SELECT id FROM import_batch WHERE id=?', [
            id(730),
          ]),
          [],
        );
      },
    );
  } finally {
    await local.close();
    await cloud.close();
  }
}
