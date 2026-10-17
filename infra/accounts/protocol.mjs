import assert from 'node:assert/strict';
import {
  createPostgresAccountService,
  createPostgresReadUnit,
} from '../../packages/persistence-postgres/dist/index.js';
import { createSqliteAccountService } from '../../packages/storage-schema/dist/index.js';
import { readCalculatedAccountBalance } from '../../packages/finance-ports/dist/index.js';
import {
  decodeAccountState,
  AccountChangeError,
} from '../../packages/domain/dist/index.js';
import {
  fixture,
  tables,
  postgresFixtureConnection,
} from '../fixtures/loader.mjs';
export const accountCases = Object.freeze([
  'create_reference_and_replay',
  'metadata_conflict_archive_reactivate',
  'reference_history_and_stale_replacement',
  'i64_optional_reference_and_invalid_atomic',
  'reference_insert_failure_rolls_back_account',
  'reference_conflict_rolls_back_supersede',
  'workspace_and_account_authorization',
  'concurrent_base_conflict',
]);
const id = (n) => '0199d040-0000-7000-8000-' + String(n).padStart(12, '0'),
  now = '2026-10-17T12:00:00.000Z';
const create = (n = 2, reference = true) => ({
  kind: 'CREATE',
  account: {
    id: id(n),
    name: 'SYNTHETIC US040 ACCOUNT',
    institution_name: null,
    account_kind: 'CHECKING',
    balance_nature: 'ASSET',
    currency_code: 'BRL',
  },
  reference: reference
    ? {
        id: id(n + 1000),
        amount_minor: '100000',
        reference_date: '2026-10-01',
        day_position: 'START_OF_DAY',
      }
    : null,
});
const reject = (work, code) =>
  assert.rejects(
    work,
    (e) =>
      e instanceof AccountChangeError &&
      e.code === code &&
      e.message === code &&
      !('cause' in e),
  );
export async function runAccountProtocol(sqlite, pools, admin, step) {
  const all = [],
    states = [];
  const workspace = fixture.workspace_a,
    other = fixture.workspace_b,
    request = { workspace_id: workspace, principal_id: id(800) };
  const grant = () => ({
    workspace_id: workspace,
    authority: 'CLOUD',
    can_write: true,
    can_create: true,
    account_ids: null,
  });
  const snapshot = async (engine, w = workspace) => {
    if (engine === 'sqlite')
      return await readAccountSnapshot(sqlite.db, engine, w);
    const db = await postgresFixtureConnection(
      w === workspace ? pools.a : pools.b,
      w,
    );
    try {
      return await readAccountSnapshot(db, engine, w);
    } finally {
      await db.close();
    }
  };
  const state = async (engine, accountId = id(2)) => {
    const snap = await snapshot(engine),
      account = snap.financial_account.find((r) => r.id === accountId);
    return account
      ? decodeAccountState(
          {
            account,
            references: snap.balance_reference.filter(
              (r) => r.account_id === accountId,
            ),
          },
          workspace,
        )
      : null;
  };
  function make(engine, overrides = {}) {
    const options = {
      authorize: overrides.authorize ?? (async () => grant()),
      identity: { nowInstant: () => now },
    };
    const service =
      engine === 'sqlite'
        ? createSqliteAccountService({
            ...options,
            connection: overrides.connection ?? sqlite.db,
          })
        : createPostgresAccountService({
            ...options,
            pool: pools.a,
            expected_role: 'us021_a',
          });
    all.push(service);
    return service;
  }
  try {
    for (const engine of ['sqlite', 'postgresql']) {
      const service = make(engine),
        apply = (change) => service.apply(request, change);
      await step(engine + '_accounts_create_reference_and_replay', async () => {
        assert.equal((await apply(create())).changed, true);
        assert.equal((await apply(create())).changed, false);
        const stored = await state(engine);
        assert.equal(stored.references.length, 1);
        assert.equal(stored.references[0].amount_minor, '100000');
      });
      await step(
        engine + '_accounts_metadata_conflict_archive_reactivate',
        async () => {
          const base = (await state(engine)).account;
          const update = {
            kind: 'UPDATE',
            base,
            name: 'SYNTHETIC US040 RENAMED',
            institution_name: 'SYNTHETIC BANK',
            status: 'ACTIVE',
          };
          await apply(update);
          assert.equal((await apply(update)).changed, false);
          await reject(
            apply({ ...update, name: 'SYNTHETIC STALE' }),
            'STALE_ACCOUNT',
          );
          await apply({
            ...update,
            base: (await state(engine)).account,
            status: 'ARCHIVED',
          });
          await reject(
            apply({
              kind: 'REFERENCE',
              account_id: id(2),
              replaces_id: null,
              reference: {
                ...create().reference,
                id: id(103),
                reference_date: '2026-10-02',
              },
            }),
            'ACCOUNT_ARCHIVED',
          );
          await apply({
            ...update,
            base: (await state(engine)).account,
            status: 'ACTIVE',
          });
          assert.equal((await state(engine)).references.length, 1);
        },
      );
      await step(
        engine + '_accounts_reference_history_and_stale_replacement',
        async () => {
          const original = (await state(engine)).references[0],
            change = {
              kind: 'REFERENCE',
              account_id: id(2),
              replaces_id: original.id,
              reference: {
                id: id(103),
                amount_minor: '9007199254740993',
                reference_date: '2026-10-02',
                day_position: 'END_OF_DAY',
              },
            };
          await apply(change);
          assert.equal((await apply(change)).changed, false);
          const stored = await state(engine);
          assert.deepEqual(
            stored.references.find((r) => r.id === original.id),
            { ...original, status: 'SUPERSEDED' },
          );
          await reject(
            apply({
              ...change,
              reference: { ...change.reference, id: id(104) },
            }),
            'STALE_ACCOUNT',
          );
        },
      );
      await step(
        engine + '_accounts_i64_optional_reference_and_invalid_atomic',
        async () => {
          for (const [n, amount] of [
            [3, '9223372036854775807'],
            [4, '-9223372036854775808'],
          ]) {
            const c = create(n);
            c.reference.amount_minor = amount;
            await apply(c);
            assert.equal(
              (await state(engine, id(n))).references[0].amount_minor,
              amount,
            );
          }
          await apply(create(5, false));
          assert.equal((await state(engine, id(5))).references.length, 0);
          const before = await snapshot(engine);
          const bad = create(8);
          bad.reference.day_position = null;
          await reject(apply(bad), 'INVALID_ACCOUNT_CHANGE');
          assert.deepEqual(await snapshot(engine), before);
        },
      );
      await step(
        engine + '_accounts_reference_insert_failure_rolls_back_account',
        async () => {
          let broken;
          if (engine === 'sqlite')
            broken = make(engine, {
              connection: {
                ...sqlite.db,
                async rows(sql, values) {
                  if (sql.startsWith('INSERT INTO balance_reference'))
                    throw Error('SYNTHETIC_PRIVATE');
                  return sqlite.db.rows(sql, values);
                },
              },
            });
          else {
            await admin.query(
              `CREATE FUNCTION us021_test.us040_fail_reference() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id='${id(1009)}' THEN RAISE EXCEPTION 'SYNTHETIC_US040_FAILURE'; END IF; RETURN NEW; END$$;CREATE TRIGGER us040_fail_reference BEFORE INSERT ON fm.balance_reference FOR EACH ROW EXECUTE FUNCTION us021_test.us040_fail_reference()`,
            );
            broken = service;
          }
          const before = await snapshot(engine);
          await reject(broken.apply(request, create(9)), 'DATA_ACCESS_FAILED');
          assert.equal(await state(engine, id(9)), null);
          assert.deepEqual(await snapshot(engine), before);
          if (engine === 'postgresql')
            await admin.query(
              'DROP TRIGGER us040_fail_reference ON fm.balance_reference;DROP FUNCTION us021_test.us040_fail_reference()',
            );
        },
      );
      await step(
        engine + '_accounts_reference_conflict_rolls_back_supersede',
        async () => {
          const before = await snapshot(engine);
          await reject(
            apply({
              kind: 'REFERENCE',
              account_id: id(2),
              replaces_id: id(103),
              reference: {
                id: id(1003),
                amount_minor: '1',
                reference_date: '2026-10-03',
                day_position: 'START_OF_DAY',
              },
            }),
            'DATA_ACCESS_FAILED',
          );
          assert.deepEqual(await snapshot(engine), before);
        },
      );
      await step(
        engine + '_accounts_workspace_and_account_authorization',
        async () => {
          const before = await snapshot(engine),
            foreignBefore = await snapshot(engine, other),
            denied = make(engine, {
              authorize: async () => ({
                ...grant(),
                account_ids: [id(3)],
                can_create: false,
              }),
            });
          await reject(
            denied.apply(request, {
              kind: 'UPDATE',
              base: (await state(engine)).account,
              name: 'SYNTHETIC DENIED',
              institution_name: null,
              status: 'ACTIVE',
            }),
            'ACCESS_DENIED',
          );
          await reject(denied.apply(request, create(10)), 'ACCESS_DENIED');
          const forged = make(engine, {
            authorize: async () => ({ ...grant(), workspace_id: other }),
          });
          await reject(forged.apply(request, create(11)), 'ACCESS_DENIED');
          if (engine === 'postgresql') {
            const rls = make(engine, {
              authorize: async () => ({ ...grant(), workspace_id: other }),
            });
            await reject(
              rls.apply({ ...request, workspace_id: other }, create(11)),
              'ACCESS_DENIED',
            );
          }
          assert.deepEqual(await snapshot(engine), before);
          assert.deepEqual(await snapshot(engine, other), foreignBefore);
        },
      );
      await step(engine + '_accounts_concurrent_base_conflict', async () => {
        const base = (await state(engine)).account,
          second = engine === 'postgresql' ? make(engine) : service;
        const results = await Promise.allSettled(
          [service, second].map((s, i) =>
            s.apply(request, {
              kind: 'UPDATE',
              base,
              name: 'SYNTHETIC CONCURRENT ' + i,
              institution_name: null,
              status: 'ACTIVE',
            }),
          ),
        );
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          results.find((r) => r.status === 'rejected').reason.code,
          'STALE_ACCOUNT',
        );
        // Normalize the winner through a fresh base so cross-engine comparison is exact.
        await apply({
          kind: 'UPDATE',
          base: (await state(engine)).account,
          name: 'SYNTHETIC US040 FINAL',
          institution_name: null,
          status: 'ACTIVE',
        });
      });
      states.push(await state(engine));
    }
    await step(
      'accounts_same_state_and_reference_history_cross_engine',
      async () => assert.deepEqual(states[0], states[1]),
    );
    const reader = createPostgresReadUnit({
      pool: pools.a,
      expected_role: 'us021_a',
      snapshot: true,
      authorize: async (r) => ({
        workspace_id: r.workspace_id,
        account_ids: null,
        permissions: ['accounts:read', 'transactions:read'],
      }),
    });
    all.push(reader);
    const readerB = createPostgresReadUnit({
      pool: pools.b,
      expected_role: 'us021_b',
      snapshot: true,
      authorize: async (r) => ({
        workspace_id: r.workspace_id,
        account_ids: null,
        permissions: ['accounts:read', 'transactions:read'],
      }),
    });
    all.push(readerB);
    await step(
      'postgres_accounts_snapshot_balance_matches_seven_fixture_goldens',
      async () => {
        let checked = 0;
        for (const expected of fixture.expected.balances) {
          const actual = await readCalculatedAccountBalance(
            expected.workspace_id === workspace ? reader : readerB,
            { ...request, workspace_id: expected.workspace_id },
            {
              account_id: expected.account_id,
              as_of: expected.as_of,
              history_coverage: 'COMPLETE',
            },
          );
          assert.equal(actual.balance.amount_minor, expected.amount_minor);
          assert.equal(actual.balance.completeness, 'COMPLETE');
          checked++;
        }
        assert.equal(checked, fixture.expected.balances.length);
        const unanchored = await readCalculatedAccountBalance(reader, request, {
          account_id: id(5),
          as_of: '2026-10-17',
          history_coverage: 'UNKNOWN',
        });
        assert.equal(unanchored.balance.completeness, 'INCOMPLETE');
        assert.ok(unanchored.balance.warnings.includes('MISSING_REFERENCE'));
      },
    );
    await step(
      'postgres_accounts_repeatable_snapshot_during_independent_commit',
      async () => {
        let release;
        const signal = new Promise((resolve) => {
          release = resolve;
        });
        const writer = make('postgresql'),
          base = (await state('postgresql')).account;
        // Register the independent request before entering the read unit's async context.
        const write = signal.then(() =>
          writer.apply(request, {
            kind: 'UPDATE',
            base,
            name: 'SYNTHETIC AFTER SNAPSHOT',
            institution_name: null,
            status: 'ACTIVE',
          }),
        );
        await reader.read(request, async (ports) => {
          const before = await ports.accounts.get(id(2));
          release();
          await write;
          const after = await ports.accounts.get(id(2));
          assert.deepEqual(after, before);
        });
        assert.equal(
          (await state('postgresql')).account.name,
          'SYNTHETIC AFTER SNAPSHOT',
        );
        await writer.apply(request, {
          kind: 'UPDATE',
          base: (await state('postgresql')).account,
          name: base.name,
          institution_name: base.institution_name,
          status: base.status,
        });
      },
    );
    await step('postgres_accounts_reject_owner_and_nested_unit', async () => {
      const unsafe = createPostgresAccountService({
        pool: admin,
        expected_role: 'us021_bootstrap',
        identity: { nowInstant: () => now },
        authorize: async () => grant(),
      });
      all.push(unsafe);
      await reject(unsafe.apply(request, create(12)), 'CONFIGURATION_INVALID');
      await reader.read(request, async () => {
        await reject(
          make('postgresql').apply(request, create(13)),
          'NESTED_UNIT',
        );
      });
    });
    await step('sqlite_accounts_anonymous_local_authority', async () => {
      const local = id(900);
      await sqlite.db.run(
        "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,created_at) VALUES(?,'SYNTHETIC US040 LOCAL','PERSONAL','LOCAL','BRL',?,?)",
        [local, id(901), now],
      );
      const service = createSqliteAccountService({
        connection: sqlite.db,
        identity: { nowInstant: () => now },
        authorize: async () => ({
          ...grant(),
          workspace_id: local,
          authority: 'LOCAL',
        }),
      });
      all.push(service);
      assert.equal(
        (await service.apply({ workspace_id: local }, create(902, false)))
          .changed,
        true,
      );
      await reject(
        service.apply(
          { workspace_id: local, principal_id: id(800) },
          create(903),
        ),
        'ACCESS_DENIED',
      );
    });
  } finally {
    await Promise.all(all.map((s) => s.close()));
  }
}

export async function readAccountSnapshot(db, engine, workspace) {
  const prefix = engine === 'postgresql' ? 'fm.' : '',
    snapshot = {};
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) {
      const sample = fixture.seed.find((row) => row.table === table);
      const fields = Object.keys(sample.values);
      if (table === 'financial_account') fields.push('institution_name');
      const columns = fields.map((name) => {
        if (
          engine === 'postgresql' &&
          /^(created_at|updated_at|deleted_at)$/.test(name)
        )
          return `to_char(${name} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${name}`;
        if (engine === 'postgresql' && name === 'is_seeded')
          return `CASE WHEN ${name} THEN '1' ELSE '0' END AS ${name}`;
        return `CAST(${name} AS TEXT) AS ${name}`;
      });
      const key = table === 'workspace' ? 'id' : 'workspace_id',
        order = table === 'transaction_tag' ? 'transaction_id,tag_id' : 'id';
      snapshot[table] = await db.rows(
        `SELECT ${columns.join(',')} FROM ${prefix}${table} WHERE ${key}=${engine === 'postgresql' ? '$1' : '?'} ORDER BY ${order}`,
        [workspace],
      );
    }
    await db.exec('COMMIT');
    return snapshot;
  } catch {
    try {
      await db.exec('ROLLBACK');
    } catch {
      /* caller disposes */
    }
    throw Error('FIXTURE_SNAPSHOT_FAILED');
  }
}
