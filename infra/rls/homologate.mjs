/* global setTimeout */
import assert from 'node:assert/strict';
import {
  createWorkspaceRunner,
  WorkspaceRequestError,
} from '../../apps/api/spikes/us-004/context.mjs';
import {
  createSpikePool,
  withSchemaOwner,
  applySpikeMigration,
} from '../../apps/api/spikes/us-004/database.mjs';
import { fixture as f, amounts, contextA, contextB } from './fixtures.mjs';

export async function homologate({ credentials, migration, progress }) {
  const pools = [];
  const pool = (user, password, max = 1) => {
    const instance = createSpikePool({ user, password, max });
    pools.push(instance);
    return instance;
  };
  const bootstrap = pool('us004_bootstrap', credentials.bootstrap);
  const owner = pool('us004_migrator', credentials.migrator);
  const runtime = pool('us004_runtime', credentials.runtime);
  const run = createWorkspaceRunner(runtime);
  const checks = {};
  let stage = 'role_provisioning';
  let schemaChecksum;
  const step = (name) => {
    stage = name;
    progress(name);
  };
  const passed = () => {
    checks[stage] = true;
  };
  const queryRows = async (
    tx,
    query = 'SELECT * FROM us004.entry ORDER BY id',
    values,
  ) => (await tx.query(query, values)).rows;
  const expectIds = (rows, ids) =>
    assert.deepEqual(rows.map((row) => row.id).sort(), [...ids].sort());
  const rejectState = (promise, sqlState = '42501') =>
    assert.rejects(
      promise,
      (error) =>
        error.code === 'DB_REQUEST_REJECTED' && error.sqlState === sqlState,
    );
  const rollbackProbe = async (context, operation) => {
    let result;
    await assert.rejects(
      run(context, async (tx) => {
        result = await operation(tx);
        throw new WorkspaceRequestError('SYNTHETIC_ROLLBACK');
      }),
      { code: 'SYNTHETIC_ROLLBACK' },
    );
    return result;
  };
  const insert = (workspace, account, id = f.temporaryEntry) => [
    'INSERT INTO us004.entry(workspace_id, id, account_id, amount_minor) VALUES ($1,$2,$3,$4) RETURNING *',
    [workspace, id, account, '9007199254740993'],
  ];
  const memberUpdate = (column, value) => {
    assert.ok(['active', 'can_write'].includes(column));
    return withSchemaOwner(owner, (client) =>
      client.query(
        `UPDATE us004.membership SET ${column} = $1 WHERE workspace_id = $2 AND user_id = $3`,
        [value, f.workspaceA, f.userA],
      ),
    );
  };
  try {
    for (const secret of Object.values(credentials))
      assert.match(secret, /^[0-9a-f]{64}$/);
    // Only role provisioning uses the bootstrap superuser. All financial probes
    // below connect as the constrained runtime role (including negative tests).
    await bootstrap.query(`
      CREATE ROLE us004_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE us004_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.migrator}';
      CREATE ROLE us004_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.runtime}';
      GRANT us004_owner TO us004_migrator;
      REVOKE ALL ON DATABASE us004 FROM PUBLIC;
      GRANT CONNECT ON DATABASE us004 TO us004_owner, us004_migrator, us004_runtime;
      GRANT CREATE ON DATABASE us004 TO us004_owner;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
    `);
    await bootstrap.end();
    pools.splice(pools.indexOf(bootstrap), 1);

    step('schema_migration_and_force_rls');
    schemaChecksum = await applySpikeMigration(owner, migration);
    assert.equal(await applySpikeMigration(owner, migration), schemaChecksum);
    const schema = await runtime.query(
      "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='us004' AND c.relname = ANY($1) ORDER BY c.relname",
      [['membership', 'account_scope', 'account', 'entry']],
    );
    assert.equal(schema.rowCount, 4);
    assert.ok(
      schema.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity),
    );
    const functions = await runtime.query(
      "SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='us004'",
    );
    assert.equal(functions.rowCount, 3);
    assert.ok(functions.rows.every((row) => !row.prosecdef));
    passed();

    step('migration_rollback_and_checksum');
    await assert.rejects(
      withSchemaOwner(owner, async (client) => {
        await client.query(
          'CREATE TABLE us004.interrupted_migration(id integer)',
        );
        await client.query('SELECT 1/0');
      }),
      { code: '22012' },
    );
    const absent = await runtime.query(
      "SELECT to_regclass('us004.interrupted_migration') AS relation",
    );
    assert.equal(absent.rows[0].relation, null);
    await assert.rejects(
      applySpikeMigration(
        owner,
        migration + '\n-- synthetic checksum mismatch',
      ),
      /SPIKE_MIGRATION_MISMATCH/,
    );
    assert.equal(await applySpikeMigration(owner, migration), schemaChecksum);
    passed();

    step('runtime_least_privilege');
    const role = (
      await runtime.query(
        'SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    assert.ok(Object.values(role).every((value) => value === false));
    const authority = (
      await runtime.query(
        "SELECT current_user AS name, pg_has_role(current_user, 'us004_owner','MEMBER') AS owner_member, has_table_privilege(current_user,'us004.entry','TRUNCATE') AS truncate, has_schema_privilege(current_user,'us004','CREATE') AS create_schema",
      )
    ).rows[0];
    assert.equal(authority.name, 'us004_runtime');
    assert.equal(authority.owner_member, false);
    assert.equal(authority.truncate, false);
    assert.equal(authority.create_schema, false);
    passed();

    step('missing_partial_and_invalid_context');
    for (const table of [
      'entry',
      'account',
      'membership',
      'account_scope',
      'export_entries',
    ])
      assert.equal(
        (await runtime.query('SELECT * FROM us004.' + table)).rowCount,
        0,
      );
    await assert.rejects(runtime.query(...insert(f.workspaceA, f.accountA)), {
      code: '42501',
    });
    const raw = await runtime.connect();
    try {
      await raw.query('BEGIN');
      await raw.query("SELECT set_config('app.workspace_id',$1,true)", [
        f.workspaceA,
      ]);
      assert.equal((await raw.query('SELECT * FROM us004.entry')).rowCount, 0);
      await raw.query("SELECT set_config('app.user_id','invalid-uuid',true)");
      await assert.rejects(raw.query('SELECT * FROM us004.entry'), {
        code: '22P02',
      });
    } finally {
      await raw.query('ROLLBACK');
      raw.release();
    }
    await assert.rejects(
      run({ workspaceId: f.workspaceB, userId: f.userA }, async () => {}),
      { code: 'WORKSPACE_FORBIDDEN' },
    );
    await assert.rejects(
      run({ workspaceId: f.unknownWorkspace, userId: f.userA }, async () => {}),
      { code: 'WORKSPACE_FORBIDDEN' },
    );
    passed();

    step('authorized_crud');
    await run(contextA, async (tx) => {
      assert.equal(
        (await tx.query(...insert(f.workspaceA, f.accountA))).rowCount,
        1,
      );
      assert.equal(
        (
          await tx.query(
            'UPDATE us004.entry SET revision=revision+1 WHERE id=$1 RETURNING revision',
            [f.temporaryEntry],
          )
        ).rows[0].revision,
        2,
      );
      assert.equal(
        (
          await tx.query('DELETE FROM us004.entry WHERE id=$1', [
            f.temporaryEntry,
          ])
        ).rowCount,
        1,
      );
    });
    passed();

    step('int64_exact_roundtrip');
    for (const context of [contextA, contextB]) {
      const rows = await run(context, (tx) => queryRows(tx));
      for (const row of rows) {
        assert.equal(typeof row.amount_minor, 'string');
        assert.equal(row.amount_minor, amounts[row.id]);
        assert.equal(
          JSON.parse(JSON.stringify(row)).amount_minor,
          amounts[row.id],
        );
      }
    }
    passed();

    step('unfiltered_select_update_delete_isolation');
    expectIds(await run(contextA, (tx) => queryRows(tx)), [
      f.entryA,
      f.hiddenEntryA,
    ]);
    expectIds(await run(contextB, (tx) => queryRows(tx)), [f.entryB]);
    for (const sql of [
      'UPDATE us004.entry SET revision=revision+1 RETURNING *',
      'DELETE FROM us004.entry RETURNING *',
    ]) {
      const result = await rollbackProbe(contextA, (tx) => queryRows(tx, sql));
      expectIds(result, [f.entryA, f.hiddenEntryA]);
      assert.ok(result.every((row) => row.workspace_id === f.workspaceA));
    }
    await run(contextA, async (tx) => {
      for (const sql of [
        'SELECT * FROM us004.entry WHERE id=$1',
        'UPDATE us004.entry SET revision=99 WHERE id=$1 RETURNING *',
        'DELETE FROM us004.entry WHERE id=$1 RETURNING *',
      ])
        assert.equal((await tx.query(sql, [f.entryB])).rowCount, 0);
    });
    const untouched = await run(contextB, (tx) => queryRows(tx));
    assert.equal(untouched[0].revision, 1);
    assert.equal(untouched[0].amount_minor, amounts[f.entryB]);
    passed();

    step('cross_workspace_insert_update_upsert_rejected');
    await rejectState(
      run(contextA, (tx) => tx.query(...insert(f.workspaceB, f.accountB))),
    );
    await rejectState(
      run(contextA, (tx) =>
        tx.query(
          'UPDATE us004.entry SET workspace_id=$1, account_id=$2 WHERE id=$3',
          [f.workspaceB, f.accountB, f.entryA],
        ),
      ),
    );
    await rejectState(
      run(contextA, (tx) =>
        tx.query(
          'INSERT INTO us004.entry(workspace_id,id,account_id,amount_minor) VALUES ($1,$2,$3,$4) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=99',
          [f.workspaceB, f.entryB, f.accountB, amounts[f.entryB]],
        ),
      ),
    );
    // A requested workspace is not membership: the authenticated subject stays A.
    await run(contextA, async (tx) => {
      await tx.query("SELECT set_config('app.workspace_id',$1,true)", [
        f.workspaceB,
      ]);
      assert.equal((await tx.query('SELECT * FROM us004.entry')).rowCount, 0);
    });
    assert.equal((await run(contextB, (tx) => queryRows(tx)))[0].revision, 1);
    passed();

    const limited = { workspaceId: f.workspaceA, userId: f.limitedWriter };
    const reader = { workspaceId: f.workspaceA, userId: f.reader };
    step('account_scope_join_total_export');
    await run(limited, async (tx) => {
      expectIds(await queryRows(tx), [f.entryA]);
      expectIds(
        await queryRows(
          tx,
          'SELECT e.* FROM us004.entry e JOIN us004.account a ON a.workspace_id=e.workspace_id AND a.id=e.account_id ORDER BY e.id',
        ),
        [f.entryA],
      );
      expectIds(await queryRows(tx, 'SELECT * FROM us004.export_entries'), [
        f.entryA,
      ]);
      assert.equal(
        (
          await tx.query(
            'SELECT sum(amount_minor)::text AS total FROM us004.entry',
          )
        ).rows[0].total,
        amounts[f.entryA],
      );
      assert.equal((await tx.query('SELECT * FROM us004.account')).rowCount, 1);
      assert.equal(
        (await tx.query('SELECT * FROM us004.membership')).rowCount,
        1,
      );
      assert.equal(
        (await tx.query('SELECT * FROM us004.account_scope')).rowCount,
        1,
      );
      assert.equal(
        (
          await tx.query('UPDATE us004.entry SET revision=99 WHERE id=$1', [
            f.hiddenEntryA,
          ])
        ).rowCount,
        0,
      );
    });
    await rejectState(
      run(limited, (tx) => tx.query(...insert(f.workspaceA, f.hiddenAccountA))),
    );
    await rejectState(
      run(limited, (tx) =>
        tx.query('UPDATE us004.entry SET account_id=$1 WHERE id=$2', [
          f.hiddenAccountA,
          f.entryA,
        ]),
      ),
    );
    passed();

    step('read_only_and_export_capability');
    await run(reader, async (tx) => {
      expectIds(await queryRows(tx), [f.entryA]);
      assert.equal(
        (await tx.query('SELECT * FROM us004.export_entries')).rowCount,
        0,
      );
      await tx.query("SELECT set_config('app.can_write','true',true)");
      assert.equal(
        (await tx.query('UPDATE us004.entry SET revision=99')).rowCount,
        0,
      );
      assert.equal((await tx.query('DELETE FROM us004.entry')).rowCount, 0);
    });
    await rejectState(
      run(reader, (tx) => tx.query(...insert(f.workspaceA, f.accountA))),
    );
    await rejectState(
      run(reader, (tx) =>
        tx.query('UPDATE us004.membership SET can_write=true'),
      ),
    );
    passed();

    step('composite_foreign_key');
    // This administrative operation is allowed by an explicit owner policy on
    // the ACL table; the composite FK must reject a cross-workspace account.
    await assert.rejects(
      withSchemaOwner(owner, (client) =>
        client.query(
          'INSERT INTO us004.account_scope(workspace_id,user_id,account_id) VALUES ($1,$2,$3)',
          [f.workspaceA, f.userA, f.accountB],
        ),
      ),
      { code: '23503' },
    );
    passed();

    step('revocation_rechecked_per_statement');
    try {
      await run(contextA, async (tx) => {
        expectIds(await queryRows(tx), [f.entryA, f.hiddenEntryA]);
        await memberUpdate('active', false);
        assert.equal((await tx.query('SELECT * FROM us004.entry')).rowCount, 0);
        assert.equal(
          (await tx.query('UPDATE us004.entry SET revision=99')).rowCount,
          0,
        );
      });
      await assert.rejects(
        run(contextA, async () => {}),
        { code: 'WORKSPACE_FORBIDDEN' },
      );
    } finally {
      await memberUpdate('active', true);
    }
    try {
      await run(contextA, async (tx) => {
        await memberUpdate('can_write', false);
        assert.equal(
          (await tx.query('UPDATE us004.entry SET revision=99')).rowCount,
          0,
        );
      });
      await rejectState(
        run(contextA, (tx) => tx.query(...insert(f.workspaceA, f.accountA))),
      );
    } finally {
      await memberUpdate('can_write', true);
    }
    passed();

    step('pool_reuse_commit_rollback_and_session_reset');
    const pid = async (context) =>
      await run(
        context,
        async (tx) =>
          (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      );
    const firstPid = await pid(contextA);
    assert.equal(await pid(contextB), firstPid);
    await rollbackProbe(contextA, (tx) =>
      tx.query(...insert(f.workspaceA, f.accountA)),
    );
    assert.equal(await pid(contextB), firstPid);
    assert.equal(
      (
        await run(contextA, (tx) =>
          tx.query('SELECT * FROM us004.entry WHERE id=$1', [f.temporaryEntry]),
        )
      ).rowCount,
      0,
    );
    const poisoned = await runtime.connect();
    await poisoned.query(
      "SELECT set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false)",
      [f.workspaceA, f.userA],
    );
    poisoned.release();
    expectIds(await run(contextB, (tx) => queryRows(tx)), [f.entryB]);
    assert.equal(await pid(contextA), firstPid);
    const clean = (
      await runtime.query(
        "SELECT nullif(current_setting('app.workspace_id',true),'') AS workspace, nullif(current_setting('app.user_id',true),'') AS subject",
      )
    ).rows[0];
    assert.deepEqual(clean, { workspace: null, subject: null });
    assert.equal(
      (await runtime.query('SELECT * FROM us004.entry')).rowCount,
      0,
    );
    passed();

    step('prepared_statement_context_reuse');
    for (const context of [
      contextA,
      contextB,
      { workspaceId: f.workspaceB, userId: f.multiUser },
      { workspaceId: f.workspaceA, userId: f.multiUser },
    ]) {
      const result = await run(context, (tx) =>
        tx.query({
          name: 'us004_unfiltered_entries',
          text: 'SELECT * FROM us004.entry ORDER BY id',
        }),
      );
      expectIds(
        result.rows,
        context.workspaceId === f.workspaceA
          ? [f.entryA, f.hiddenEntryA]
          : [f.entryB],
      );
    }
    passed();

    step('concurrent_pool_isolation');
    const concurrentPool = pool('us004_runtime', credentials.runtime, 4);
    const parallel = createWorkspaceRunner(concurrentPool);
    const contexts = [contextA, contextB, limited];
    const pids = new Set();
    await Promise.all(
      Array.from({ length: 48 }, async (_, index) => {
        const context = contexts[index % contexts.length];
        const result = await parallel(context, async (tx) => {
          const backend = (await tx.query('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { backend, rows: await queryRows(tx) };
        });
        pids.add(result.backend);
        expectIds(
          result.rows,
          context === contextA
            ? [f.entryA, f.hiddenEntryA]
            : context === contextB
              ? [f.entryB]
              : [f.entryA],
        );
      }),
    );
    assert.ok(pids.size >= 2 && pids.size <= 4);
    passed();

    step('savepoint_rollback_preserves_context');
    await run(contextA, async (tx) => {
      await tx.query('SAVEPOINT own_write');
      await tx.query(...insert(f.workspaceA, f.accountA));
      await tx.query('ROLLBACK TO SAVEPOINT own_write');
      expectIds(await queryRows(tx), [f.entryA, f.hiddenEntryA]);
      await tx.query('RELEASE SAVEPOINT own_write');
    });
    passed();

    step('connection_loss_rolls_back_and_replaces_socket');
    const beforeLoss = await pid(contextA);
    await assert.rejects(
      run(contextA, async (tx) => {
        await tx.query(...insert(f.workspaceA, f.accountA));
        await tx.query('SELECT pg_terminate_backend(pg_backend_pid())');
      }),
      { code: 'DB_REQUEST_REJECTED' },
    );
    assert.notEqual(await pid(contextB), beforeLoss);
    assert.equal(
      (
        await run(contextA, (tx) =>
          tx.query('SELECT * FROM us004.entry WHERE id=$1', [f.temporaryEntry]),
        )
      ).rowCount,
      0,
    );
    passed();

    step('owner_force_and_escalation_rejected');
    assert.equal(
      (
        await withSchemaOwner(owner, (client) =>
          client.query('SELECT * FROM us004.entry'),
        )
      ).rowCount,
      0,
    );
    for (const sql of [
      'SET LOCAL ROLE us004_owner',
      'ALTER TABLE us004.entry DISABLE ROW LEVEL SECURITY',
      'TRUNCATE us004.entry',
      'SET LOCAL row_security = off; SELECT * FROM us004.entry',
    ])
      await rejectState(run(contextA, (tx) => tx.query(sql)));
    expectIds(await run(contextB, (tx) => queryRows(tx)), [f.entryB]);
    passed();

    const version = (
      await runtime.query("SELECT current_setting('server_version') AS version")
    ).rows[0].version;
    assert.match(version, /^18\.6(?:\s|$)/);
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'postgresql-rls-pool-spike',
      passed: true,
      checks,
      schema_sha256: schemaChecksum,
      postgres_version: version.split(' ')[0],
      concurrent_requests: 48,
    };
  } catch (error) {
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'postgresql-rls-pool-spike',
      passed: false,
      failed_step: stage,
      sql_state: /^[0-9A-Z]{5}$/.test(error.sqlState ?? error.code ?? '')
        ? (error.sqlState ?? error.code)
        : undefined,
      failure_location:
        error.stack?.match(
          /(?:homologate|context|database)\.mjs:\d+:\d+/,
        )?.[0] ?? 'external-library',
      checks,
    };
  } finally {
    await Promise.all(pools.map((instance) => instance.end()));
  }
}
