/* global setTimeout */
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  applyInitialMigration,
  initialMigration,
} from '../../apps/api/persistence/postgres/migrate.mjs';
import {
  id,
  tables,
  sentinels,
  createPool,
  inWorkspace,
  account,
  movement,
  category,
  split,
} from './fixtures.mjs';

export async function homologate(credentials, progress, checks) {
  const pools = [];
  const pool = (user, password, max = 1) => {
    const result = createPool(pg, user, password, max);
    pools.push(result);
    return result;
  };
  const admin = pool('us020_bootstrap', credentials.bootstrap);
  const migrator = pool('fm_schema_migrator', credentials.migrator, 2);
  const a = pool('fm_fixture_a', credentials.a, 3),
    b = pool('fm_fixture_b', credentials.b),
    outsider = pool('fm_fixture_outsider', credentials.outsider);
  const step = async (name, operation) => {
    progress(name);
    await operation();
    checks[name] = true;
  };
  const run = (operation) => inWorkspace(a, id(1), operation);
  const reject = (operation, state = '23514') =>
    assert.rejects(run(operation), (error) => error.sqlState === state);
  const seedWorkspace = async (tx, workspace) => {
    await tx.query(
      `INSERT INTO fm.workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,tax_identifier)
      VALUES ($1,'Synthetic workspace','PERSONAL','CLOUD','BRL',$2,$3)`,
      [workspace, id(90), sentinels[1]],
    );
  };
  try {
    // Bootstrap is used only for roles, technical grants and inspection, never financial CRUD.
    for (const password of Object.values(credentials))
      assert.match(password, /^[a-f0-9]{64}$/);
    await admin.query(`
      CREATE ROLE fm_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE fm_schema_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.migrator}';
      CREATE ROLE fm_fixture NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE fm_fixture_a LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.a}';
      CREATE ROLE fm_fixture_b LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.b}';
      CREATE ROLE fm_fixture_outsider LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.outsider}';
      GRANT fm_schema_owner TO fm_schema_migrator;
      GRANT fm_fixture TO fm_fixture_a,fm_fixture_b,fm_fixture_outsider;
      REVOKE ALL ON DATABASE us020 FROM PUBLIC;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE us020 TO fm_schema_migrator,fm_fixture;
      GRANT CREATE ON DATABASE us020 TO fm_schema_owner;
    `);
    await step('migration_failure_rollback', async () => {
      await assert.rejects(
        applyInitialMigration(migrator, initialMigration() + '\nSELECT 1/0;'),
        { message: 'MIGRATION_FAILED' },
      );
      assert.equal(
        (await admin.query("SELECT to_regnamespace('fm') AS schema")).rows[0]
          .schema,
        null,
      );
    });
    await step('migration_idempotency_checksum_and_concurrency', async () => {
      const results = await Promise.all([
        applyInitialMigration(migrator),
        applyInitialMigration(migrator),
      ]);
      assert.equal(results.filter((result) => result.applied).length, 1);
      assert.equal(results[0].checksum, results[1].checksum);
      assert.equal((await applyInitialMigration(migrator)).applied, false);
      await assert.rejects(
        applyInitialMigration(migrator, initialMigration() + '\n-- changed'),
        { message: 'MIGRATION_CHECKSUM_MISMATCH' },
      );
    });
    await step('roles_and_default_deny', async () => {
      const roles = await admin.query(
        "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname LIKE 'fm_%'",
      );
      assert.ok(
        roles.rows.every((row) =>
          Object.values(row).every((value) => value === false),
        ),
      );
      // Grants alone do not open a table with only restrictive policies.
      await admin.query(
        'GRANT USAGE ON SCHEMA fm TO fm_fixture; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA fm TO fm_fixture; REVOKE ALL ON fm.schema_migration FROM fm_fixture; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fm TO fm_fixture',
      );
      assert.equal(
        (await run((tx) => tx.query('SELECT * FROM fm.workspace'))).rowCount,
        0,
      );
      await reject((tx) => seedWorkspace(tx, id(1)), '42501');
      const client = await migrator.connect();
      try {
        await client.query('BEGIN; SET LOCAL ROLE fm_schema_owner');
        assert.equal(
          (await client.query('SELECT * FROM fm.workspace')).rowCount,
          0,
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
    await step('twelve_tables_forced_rls_and_composite_keys', async () => {
      const relations = await admin.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='fm' AND relkind='r' AND relname<>'schema_migration'",
      );
      assert.deepEqual(
        relations.rows.map((row) => row.relname).sort(),
        [...tables].sort(),
      );
      assert.ok(
        relations.rows.every(
          (row) => row.relrowsecurity && row.relforcerowsecurity,
        ),
      );
      const foreignKeys = await admin.query(
        "SELECT conkey FROM pg_constraint WHERE contype='f' AND connamespace='fm'::regnamespace",
      );
      assert.equal(
        foreignKeys.rows.filter((row) => row.conkey.length > 1).length,
        11,
      );
    });
    // Explicit synthetic authorization, additive to the product restrictive boundary.
    // Distinct database logins have distinct grants; no owner/BYPASSRLS or disabled policy.
    await admin.query(`CREATE SCHEMA us020_test; REVOKE ALL ON SCHEMA us020_test FROM PUBLIC;
      CREATE TABLE us020_test.access(database_role name NOT NULL,workspace_id uuid NOT NULL,PRIMARY KEY(database_role,workspace_id));
      GRANT USAGE ON SCHEMA us020_test TO fm_fixture; GRANT SELECT ON us020_test.access TO fm_fixture;`);
    await admin.query('INSERT INTO us020_test.access VALUES ($1,$2),($3,$4)', [
      'fm_fixture_a',
      id(1),
      'fm_fixture_b',
      id(2),
    ]);
    for (const table of tables) {
      const key = table === 'workspace' ? 'id' : 'workspace_id';
      await admin.query(`CREATE POLICY synthetic_authorized_fixture ON fm.${table} TO fm_fixture USING
        (EXISTS(SELECT 1 FROM us020_test.access access WHERE access.database_role=session_user AND access.workspace_id=${table}.${key}))
        WITH CHECK (EXISTS(SELECT 1 FROM us020_test.access access WHERE access.database_role=session_user AND access.workspace_id=${table}.${key}))`);
    }
    await step('authorized_synthetic_seed', async () => {
      for (const [
        connection,
        workspace,
        accountId,
        categoryId,
        groupId,
        counterId,
        tagId,
      ] of [
        [a, id(1), id(11), id(21), id(51), id(61), id(41)],
        [b, id(2), id(12), id(22), id(52), id(62), id(42)],
      ])
        await inWorkspace(connection, workspace, async (tx) => {
          await seedWorkspace(tx, workspace);
          await account(tx, workspace, accountId);
          if (workspace === id(2))
            await movement(tx, workspace, accountId, id(102));
          await category(tx, workspace, categoryId);
          await tx.query(
            "INSERT INTO fm.transaction_group(id,workspace_id,group_type,state) VALUES ($1,$2,'TRANSFER','ACTIVE')",
            [groupId, workspace],
          );
          await tx.query(
            "INSERT INTO fm.counterparty(id,workspace_id,display_name,status) VALUES ($1,$2,'Synthetic counterparty','ACTIVE')",
            [counterId, workspace],
          );
          await tx.query(
            "INSERT INTO fm.tag(id,workspace_id,name,status) VALUES ($1,$2,'Synthetic tag','ACTIVE')",
            [tagId, workspace],
          );
        });
      await run(async (tx) => {
        await category(tx, id(1), id(23), 'Synthetic second category');
        await tx.query(
          "INSERT INTO fm.subcategory(id,workspace_id,category_id,name,sort_order,status) VALUES ($1,$2,$3,'Synthetic subcategory',0,'ACTIVE')",
          [id(31), id(1), id(21)],
        );
        await movement(tx, id(1), id(11), id(101));
      });
    });
    await step('cross_workspace_read_write_and_forged_context', async () => {
      assert.equal(
        (await a.query('SELECT * FROM fm.financial_account')).rowCount,
        0,
      );
      assert.deepEqual(
        (
          await run((tx) => tx.query('SELECT id FROM fm.financial_account'))
        ).rows.map((row) => row.id),
        [id(11)],
      );
      assert.equal(
        (
          await inWorkspace(a, id(2), (tx) =>
            tx.query('SELECT * FROM fm.financial_account'),
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await inWorkspace(outsider, id(1), (tx) =>
            tx.query('SELECT * FROM fm.workspace'),
          )
        ).rowCount,
        0,
      );
      await reject((tx) => account(tx, id(2), id(999)), '42501');
      assert.equal(
        (
          await run((tx) =>
            tx.query('UPDATE fm.financial_account SET name=$1 WHERE id=$2', [
              'Synthetic denied',
              id(12),
            ]),
          )
        ).rowCount,
        0,
      );
    });
    await step('cross_workspace_foreign_keys', async () => {
      await reject((tx) => movement(tx, id(1), id(12), id(201)), '23503');
      await reject(
        (tx) =>
          movement(tx, id(1), id(11), id(201), '-100', { group_id: id(52) }),
        '23503',
      );
      await reject(
        (tx) =>
          movement(tx, id(1), id(11), id(201), '-100', {
            counterparty_id: id(62),
          }),
        '23503',
      );
      await reject(
        (tx) => split(tx, id(1), id(101), id(22), id(201), '100'),
        '23503',
      );
      await reject(
        (tx) =>
          tx.query('INSERT INTO fm.transaction_tag VALUES ($1,$2,$3)', [
            id(1),
            id(101),
            id(42),
          ]),
        '23503',
      );
      await reject(
        (tx) =>
          tx.query(
            "INSERT INTO fm.transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source) VALUES ($1,$2,$3,1,'{}','SYSTEM','SYSTEM')",
            [id(201), id(1), id(102)],
          ),
        '23503',
      );
    });
    await step('required_fields_enums_ids_and_currency', async () => {
      await reject((tx) =>
        tx.query("UPDATE fm.financial_account SET account_kind='UNKNOWN'"),
      );
      await reject((tx) =>
        tx.query("UPDATE fm.financial_account SET currency_code='USD'"),
      );
      await reject((tx) =>
        tx.query("UPDATE fm.workspace SET storage_mode='LOCAL'"),
      );
      await reject((tx) =>
        tx.query('UPDATE fm.financial_transaction SET version=0'),
      );
      await reject(
        (tx) =>
          tx.query('UPDATE fm.financial_transaction SET display_name=NULL'),
        '23502',
      );
      await reject((tx) =>
        tx.query(
          "UPDATE fm.workspace SET id='00000000-0000-0000-0000-000000000000'",
        ),
      );
      await reject((tx) =>
        tx.query('UPDATE fm.financial_transaction SET id=$1', [id(202)]),
      );
      assert.equal(
        (await run((tx) => tx.query('SELECT tax_identifier FROM fm.workspace')))
          .rows[0].tax_identifier,
        sentinels[1],
      );
    });
    await step('exact_i64_and_overflow', async () => {
      await run(async (tx) => {
        for (const [index, amount] of [
          '9223372036854775807',
          '-9223372036854775808',
          '9007199254740993',
        ].entries())
          await movement(tx, id(1), id(11), id(300 + index), amount);
      });
      assert.deepEqual(
        (
          await run((tx) =>
            tx.query(
              'SELECT account_amount_minor FROM fm.financial_transaction WHERE id BETWEEN $1 AND $2 ORDER BY id',
              [id(300), id(302)],
            ),
          )
        ).rows.map((row) => row.account_amount_minor),
        ['9223372036854775807', '-9223372036854775808', '9007199254740993'],
      );
      await reject(
        (tx) => movement(tx, id(1), id(11), id(303), '9223372036854775808'),
        '22003',
      );
      await reject(
        (tx) => movement(tx, id(1), id(11), id(303), '1.5'),
        '22P02',
      );
    });
    await step('date_and_utc_millisecond_roundtrip', async () => {
      await run((tx) =>
        movement(tx, id(1), id(11), id(401), '-100', {
          created_at: '2024-02-29T23:59:59.123Z',
          updated_at: '2024-02-29T23:59:59.123Z',
        }),
      );
      const row = (
        await run((tx) =>
          tx.query(
            'SELECT to_char(created_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS instant,financial_date::text AS day FROM fm.financial_transaction WHERE id=$1',
            [id(401)],
          ),
        )
      ).rows[0];
      assert.deepEqual(row, {
        instant: '2024-02-29T23:59:59.123Z',
        day: '2026-10-16',
      });
      await reject(
        (tx) =>
          tx.query(
            "UPDATE fm.financial_transaction SET financial_date='2025-02-29'",
          ),
        '22008',
      );
      await reject((tx) =>
        tx.query(
          "UPDATE fm.financial_transaction SET created_at='2024-02-29T00:00:00.123456Z'",
        ),
      );
      await reject((tx) =>
        tx.query(
          "UPDATE fm.financial_transaction SET financial_date='infinity'",
        ),
      );
      await reject((tx) =>
        tx.query("UPDATE fm.financial_transaction SET updated_at='infinity'"),
      );
      await run(async (tx) => {
        await tx.query("SET LOCAL timezone='America/Fortaleza'");
        await tx.query(
          "UPDATE fm.financial_transaction SET financial_date='2024-02-29' WHERE id=$1",
          [id(401)],
        );
      });
      assert.equal(
        (
          await run((tx) =>
            tx.query(
              'SELECT financial_date::text AS day FROM fm.financial_transaction WHERE id=$1',
              [id(401)],
            ),
          )
        ).rows[0].day,
        '2024-02-29',
      );
    });
    await step('normalized_active_names', async () => {
      await run((tx) => category(tx, id(1), id(501), '  Mercado   mensal  '));
      await reject(
        (tx) => category(tx, id(1), id(502), 'mercado mensal'),
        '23505',
      );
      await run((tx) =>
        category(tx, id(1), id(503), 'MERCADO MENSAL', 'ARCHIVED'),
      );
      await inWorkspace(b, id(2), (tx) =>
        category(tx, id(2), id(504), 'Mercado mensal'),
      );
      await reject(
        (tx) =>
          tx.query(
            "INSERT INTO fm.tag(id,workspace_id,name,status) VALUES ($1,$2,'synthetic tag','ACTIVE')",
            [id(505), id(1)],
          ),
        '23505',
      );
    });
    await step('subcategory_matches_category', async () => {
      await reject(
        (tx) => split(tx, id(1), id(101), id(23), id(601), '100', id(31)),
        '23503',
      );
      await run((tx) =>
        split(tx, id(1), id(101), id(21), id(602), '100', id(31)),
      );
    });
    await step('allocation_atomicity_and_extreme_amount', async () => {
      await reject(async (tx) => {
        await movement(tx, id(1), id(11), id(701));
        await split(tx, id(1), id(701), id(21), id(702), '99');
      });
      assert.equal(
        (
          await run((tx) =>
            tx.query('SELECT * FROM fm.financial_transaction WHERE id=$1', [
              id(701),
            ]),
          )
        ).rowCount,
        0,
      );
      await run(async (tx) => {
        await split(tx, id(1), id(301), id(21), id(703), '9223372036854775807');
        await split(tx, id(1), id(301), id(21), id(704), '1');
      });
      await reject((tx) => split(tx, id(1), id(101), id(21), id(705), '0'));
      await reject((tx) =>
        tx.query(
          'UPDATE fm.financial_transaction SET account_amount_minor=-101 WHERE id=$1',
          [id(101)],
        ),
      );
      await run(async (tx) => {
        await tx.query(
          'UPDATE fm.financial_transaction SET account_amount_minor=-101 WHERE id=$1',
          [id(101)],
        );
        await tx.query(
          'UPDATE fm.transaction_allocation SET amount_minor=101 WHERE id=$1',
          [id(602)],
        );
      });
    });
    await step('concurrent_allocations_serialize', async () => {
      await run((tx) => movement(tx, id(1), id(11), id(801)));
      const first = await a.connect(),
        second = await a.connect();
      try {
        for (const client of [first, second]) {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.workspace_id',$1,true)", [
            id(1),
          ]);
        }
        await split(first, id(1), id(801), id(21), id(802), '100');
        const pid = (await second.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid;
        const waiting = split(second, id(1), id(801), id(21), id(803), '1');
        let blocked = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          if (
            (
              await admin.query(
                'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
                [pid],
              )
            ).rows[0].blocked
          ) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(blocked, true);
        await first.query('COMMIT');
        await waiting;
        await assert.rejects(
          second.query('COMMIT'),
          (error) => error.code === '23514',
        );
      } finally {
        await first.query('ROLLBACK');
        await second.query('ROLLBACK');
        first.release();
        second.release();
      }
      assert.equal(
        (
          await run((tx) =>
            tx.query(
              'SELECT * FROM fm.transaction_allocation WHERE transaction_id=$1',
              [id(801)],
            ),
          )
        ).rowCount,
        1,
      );
    });
    await step('revision_unique_immutable_and_soft_delete', async () => {
      const revision = (tx, revisionId, version = 1) =>
        tx.query(
          "INSERT INTO fm.transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source) VALUES ($1,$2,$3,$4,$5,'MEMBER','MANUAL')",
          [
            revisionId,
            id(1),
            id(101),
            version,
            JSON.stringify({
              account_amount_minor: '-101',
              synthetic_only: true,
            }),
          ],
        );
      await run((tx) => revision(tx, id(901)));
      await reject((tx) => revision(tx, id(902)), '23505');
      await reject((tx) =>
        tx.query("UPDATE fm.transaction_revision SET snapshot='{}'"),
      );
      await reject((tx) => tx.query('DELETE FROM fm.transaction_revision'));
      await reject((tx) =>
        tx.query(
          "INSERT INTO fm.transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source) VALUES ($1,$2,$3,2,'[]','SYSTEM','SYSTEM')",
          [id(903), id(1), id(101)],
        ),
      );
      await run((tx) =>
        tx.query(
          "UPDATE fm.financial_transaction SET deleted_at=date_trunc('milliseconds',CURRENT_TIMESTAMP) WHERE id=$1",
          [id(101)],
        ),
      );
      assert.equal(
        (
          await run((tx) =>
            tx.query(
              'SELECT * FROM fm.transaction_revision WHERE transaction_id=$1',
              [id(101)],
            ),
          )
        ).rowCount,
        1,
      );
      await reject(
        (tx) =>
          tx.query('DELETE FROM fm.financial_transaction WHERE id=$1', [
            id(101),
          ]),
        '23503',
      );
    });
    await step('reference_and_account_card_constraints', async () => {
      await run((tx) => account(tx, id(1), id(1001), true));
      await reject((tx) =>
        tx.query(
          "UPDATE fm.financial_account SET balance_nature='ASSET' WHERE id=$1",
          [id(1001)],
        ),
      );
      const reference = (tx, referenceId, status = 'ACTIVE') =>
        tx.query(
          "INSERT INTO fm.balance_reference(id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status) VALUES ($1,$2,$3,$4,'2026-10-16','START_OF_DAY','MANUAL',$5)",
          [referenceId, id(1), id(11), '9007199254740993', status],
        );
      await run((tx) => reference(tx, id(1002)));
      await reject((tx) => reference(tx, id(1003)), '23505');
      await run((tx) => reference(tx, id(1004), 'SUPERSEDED'));
    });
    await step('keyset_pagination_and_indexes', async () => {
      const expected = (
        await run((tx) =>
          tx.query(
            'SELECT id FROM fm.financial_transaction WHERE deleted_at IS NULL ORDER BY financial_date DESC,id DESC',
          ),
        )
      ).rows.map((row) => row.id);
      const result = [];
      let cursor;
      while (true) {
        const page = await run((tx) =>
          tx.query(
            `SELECT id,financial_date::text AS day FROM fm.financial_transaction WHERE deleted_at IS NULL ${cursor ? 'AND (financial_date,id)<($1,$2)' : ''} ORDER BY financial_date DESC,id DESC LIMIT 2`,
            cursor ? [cursor.day, cursor.id] : [],
          ),
        );
        if (!page.rowCount) break;
        result.push(...page.rows.map((row) => row.id));
        cursor = page.rows.at(-1);
      }
      assert.deepEqual(result, expected);
      const indexes = (
        await admin.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname='fm'",
        )
      ).rows.map((row) => row.indexname);
      for (const name of [
        'transaction_workspace_date',
        'transaction_account_date',
        'allocation_category',
        'category_active_name',
      ])
        assert.ok(indexes.includes(name));
    });
    await step('restricted_roles_cannot_ddl_truncate_or_migrate', async () => {
      for (const sql of [
        'TRUNCATE fm.financial_transaction',
        'ALTER TABLE fm.financial_transaction DISABLE ROW LEVEL SECURITY',
        'SELECT * FROM fm.schema_migration',
        'CREATE TABLE fm.forbidden(id integer)',
        'SET ROLE fm_schema_owner',
      ])
        await reject((tx) => tx.query(sql), '42501');
      await assert.rejects(applyInitialMigration(a), {
        message: 'MIGRATION_FAILED',
      });
    });
    return (
      await admin.query('SHOW server_version')
    ).rows[0].server_version.split(' ')[0];
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
  }
}
