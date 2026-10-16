/* global setTimeout, clearTimeout, fetch */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import {
  createPool,
  ownerTransaction,
  migrate,
  inWorkspace,
} from '../../apps/api/spikes/us-005/database.mjs';
import { createSyncService } from '../../apps/api/spikes/us-005/service.mjs';
import { SyncError } from '../../apps/api/spikes/us-005/protocol.mjs';
import { startTransport } from './transport.mjs';
import { f, id, operation, syntheticRecord } from './fixtures.mjs';

export async function homologate({
  credentials,
  migration,
  progress,
  artifacts,
}) {
  const pools = [];
  const pool = (user, password) => {
    const value = createPool({ user, password });
    pools.push(value);
    return value;
  };
  const bootstrap = pool('us005_bootstrap', credentials.bootstrap);
  const owner = pool('us005_migrator', credentials.migrator);
  const runtime = pool('us005_runtime', credentials.runtime);
  const checks = {};
  let stage = 'role_provisioning';
  let transport;
  let checksum;
  let postgresVersion;
  let childProcesses = 0;
  const step = (name) => {
    stage = name;
    progress(name);
  };
  const passed = () => {
    checks[stage] = true;
  };
  const a = { userId: f.userA, deviceId: f.deviceA };
  const b = { userId: f.userB, deviceId: f.deviceB };
  const reader = { userId: f.reader, deviceId: f.readerDevice };
  const outside = { userId: f.outsider, deviceId: f.outsiderDevice };
  const reject = (promise, code) => assert.rejects(promise, { code });
  const query = (sql, values) =>
    inWorkspace(
      runtime,
      a,
      f.workspace,
      async (tx) => (await tx.query(sql, values)).rows,
    );
  const admin = (sql, values) =>
    ownerTransaction(owner, async (tx) => {
      await tx.query('SELECT id FROM us005.workspace WHERE id=$1 FOR UPDATE', [
        f.workspace,
      ]);
      return tx.query(sql, values);
    });
  const files = ['a', 'b', 'reader'].map((name) =>
    path.join(artifacts, name + '.sqlite'),
  );
  for (const file of files)
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(file + suffix, { force: true });
  const client = async (name, action, extra = {}, expectedExit = 0) => {
    childProcesses++;
    const index = ['a', 'b', 'reader'].indexOf(name);
    const input = {
      file: files[index],
      action,
      workspace: f.workspace,
      generation: f.generation,
      url: transport.url,
      token: 'Bearer ' + credentials['session' + name],
      ...extra,
    };
    return new Promise((resolve, rejectPromise) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./client.mjs', import.meta.url))],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(input));
      const timer = setTimeout(() => {
        child.kill();
        rejectPromise(new Error('CLIENT_TIMEOUT'));
      }, 15000);
      child.once('error', () => {
        clearTimeout(timer);
        rejectPromise(new Error('CLIENT_PROCESS_FAILED'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        try {
          assert.equal(code, expectedExit);
          resolve(expectedExit === 0 ? JSON.parse(output) : undefined);
        } catch {
          rejectPromise(new Error('CLIENT_PROCESS_FAILED'));
        }
      });
    });
  };
  const drain = async (name) => {
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await client(name, 'pull');
      const result = state.results[0];
      assert.equal(result.status, 'OK');
      if (result.changes.length < 2) return state;
    }
    throw new Error('PAGINATION_DID_NOT_END');
  };
  try {
    for (const value of Object.values(credentials))
      assert.match(value, /^[0-9a-f]{64}$/);
    await bootstrap.query(`CREATE ROLE us005_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE us005_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.migrator}';
      CREATE ROLE us005_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.runtime}';
      GRANT us005_owner TO us005_migrator;
      REVOKE ALL ON DATABASE us005 FROM PUBLIC;
      GRANT CONNECT ON DATABASE us005 TO us005_owner,us005_migrator,us005_runtime;
      GRANT CREATE ON DATABASE us005 TO us005_owner;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;`);
    await bootstrap.end();
    pools.splice(pools.indexOf(bootstrap), 1);
    step('migration_atomic_checksum_and_force_rls');
    await assert.rejects(
      migrate(owner, migration + '\nSELECT nonexistent_synthetic_function();'),
    );
    assert.equal(
      (await owner.query("SELECT to_regclass('us005.workspace') AS name"))
        .rows[0].name,
      null,
    );
    checksum = await migrate(owner, migration);
    assert.equal(await migrate(owner, migration), checksum);
    await reject(
      migrate(owner, migration + '\n-- changed'),
      'MIGRATION_MISMATCH',
    );
    const tables = (
      await runtime.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='us005' AND relname<> 'schema_version' AND relkind='r'",
      )
    ).rows;
    assert.equal(tables.length, 10);
    assert.ok(
      tables.every((row) => row.relrowsecurity && row.relforcerowsecurity),
    );
    postgresVersion = (
      await runtime.query('SHOW server_version')
    ).rows[0].server_version.split(' ')[0];
    await ownerTransaction(owner, async (tx) => {
      await tx.query(
        'INSERT INTO us005.workspace(id,generation) VALUES($1,$3),($2,$3)',
        [f.workspace, f.otherWorkspace, f.generation],
      );
      for (const [workspace, context, write] of [
        [f.workspace, a, true],
        [f.workspace, b, true],
        [f.workspace, reader, false],
        [f.otherWorkspace, outside, true],
      ]) {
        await tx.query(
          'INSERT INTO us005.membership(workspace_id,user_id,can_write) VALUES($1,$2,$3)',
          [workspace, context.userId, write],
        );
        await tx.query(
          'INSERT INTO us005.device(workspace_id,user_id,id) VALUES($1,$2,$3)',
          [workspace, context.userId, context.deviceId],
        );
        await tx.query('INSERT INTO us005.account_scope VALUES($1,$2,$3)', [
          workspace,
          context.userId,
          f.account,
        ]);
      }
      await tx.query('INSERT INTO us005.account_scope VALUES($1,$2,$3)', [
        f.workspace,
        f.userA,
        f.hiddenAccount,
      ]);
    });
    passed();
    let failId;
    const dropIds = new Set();
    const service = createSyncService(runtime, {
      beforeCommit: async (op) => {
        if (op.operation_id === failId) throw new SyncError('REQUEST_FAILED');
      },
    });
    transport = await startTransport(
      service,
      new Map([
        ['Bearer ' + credentials.sessiona, a],
        ['Bearer ' + credentials.sessionb, b],
        ['Bearer ' + credentials.sessionreader, reader],
      ]),
      {
        dropReply: (op) => {
          if (!dropIds.has(op.operation_id)) return false;
          dropIds.delete(op.operation_id);
          return true;
        },
      },
    );
    const initial = operation(100, syntheticRecord, { base: '0' });
    await service.push(a, initial);
    await service.push(
      a,
      operation(101, syntheticRecord, {
        base: '0',
        account: f.hiddenAccount,
        entity: id(16),
      }),
    );
    for (const name of ['a', 'b', 'reader'])
      assert.equal((await client(name, 'snapshot')).results[0].status, 'OK');

    step('int64_workspace_account_and_session_boundaries');
    const snapA = await service.snapshot(a, { workspace_id: f.workspace });
    const snapB = await service.snapshot(b, { workspace_id: f.workspace });
    assert.equal(snapA.records.length, 2);
    assert.equal(snapB.records.length, 1);
    assert.equal(snapB.records[0].snapshot.amount_minor, '9007199254740993');
    assert.equal(
      (
        await query(
          'SELECT amount_minor FROM us005.record WHERE entity_id=$1',
          [f.entity],
        )
      )[0].amount_minor,
      '9007199254740993',
    );
    await reject(
      service.snapshot(outside, { workspace_id: f.workspace }),
      'REJECTED_PERMISSION',
    );
    await reject(
      service.push(
        b,
        operation(
          102,
          { description: 'SYNTHETIC hidden' },
          { account: f.hiddenAccount, entity: id(16) },
        ),
      ),
      'REJECTED_PERMISSION',
    );
    const noSession = await fetch(transport.url + '/snapshot', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: f.workspace }),
    });
    assert.equal(noSession.status, 403);
    await reject(
      inWorkspace(runtime, a, f.workspace, (tx) =>
        tx.query('UPDATE us005.membership SET can_write=false'),
      ),
      'REQUEST_FAILED',
    );
    const hiddenFeed = await service.pull(b, {
      workspace_id: f.workspace,
      generation: f.generation,
      cursor: '0',
      limit: 100,
    });
    assert.ok(hiddenFeed.changes.every((row) => row.account_id === f.account));
    passed();

    step('durable_outbox_abrupt_restart_and_atomic_enqueue');
    const durable = operation(110, { description: 'SYNTHETIC persisted' });
    await client(
      'a',
      'enqueue',
      {
        operation: operation(109, { description: 'SYNTHETIC rollback' }),
        crash: 'before_commit',
      },
      86,
    );
    assert.equal((await client('a', 'inspect')).outbox.length, 0);
    await client(
      'a',
      'enqueue',
      { operation: durable, crash: 'after_commit' },
      86,
    );
    assert.equal((await client('a', 'inspect')).outbox[0].state, 'PENDING');
    passed();
    step('disconnection_retains_pending_proposal');
    const offline = await client('a', 'push', { url: 'http://127.0.0.1:1' });
    assert.equal(offline.results[0].status, 'UNAVAILABLE');
    assert.equal(offline.outbox[0].state, 'PENDING');
    passed();
    step('lost_response_retry_is_idempotent');
    dropIds.add(durable.operation_id);
    const lost = await client('a', 'push');
    assert.equal(lost.results[0].status, 'UNAVAILABLE');
    assert.equal(lost.outbox[0].state, 'PENDING');
    const retry = await client('a', 'push');
    assert.equal(retry.results[0].version, '2');
    assert.equal(retry.outbox[0].state, 'CONFIRMED');
    assert.deepEqual(await service.push(a, durable), retry.results[0]);
    const versions = await query(
      'SELECT version FROM us005.revision WHERE entity_id=$1 ORDER BY version',
      [f.entity],
    );
    assert.deepEqual(
      versions.map((row) => row.version),
      ['1', '2'],
    );
    passed();
    step('idempotency_payload_and_actor_binding');
    await reject(
      service.push(a, {
        ...durable,
        patch: { description: 'SYNTHETIC tampered' },
      }),
      'IDEMPOTENCY_MISMATCH',
    );
    await reject(service.push(b, durable), 'REJECTED_PERMISSION');
    passed();

    step('independent_fields_merge_without_clock_priority');
    await client('b', 'enqueue', {
      operation: operation(
        120,
        { amount_minor: '9223372036854775807' },
        { timestamp: '2099-01-01T00:00:00Z' },
      ),
    });
    const merged = await client('b', 'push');
    assert.equal(merged.results[0].status, 'MERGED');
    const aState = await drain('a');
    const bState = await drain('b');
    const main = (state) =>
      state.records.find((row) => row.entity_id === f.entity);
    assert.deepEqual(main(aState), main(bState));
    assert.equal(main(bState).snapshot.description, 'SYNTHETIC persisted');
    assert.equal(main(bState).snapshot.amount_minor, '9223372036854775807');
    assert.equal(
      (
        await query(
          'SELECT amount_minor FROM us005.record WHERE entity_id=$1',
          [f.entity],
        )
      )[0].amount_minor,
      '9223372036854775807',
    );
    passed();
    step('same_field_conflict_preserves_base_local_remote');
    await client('a', 'enqueue', {
      operation: operation(
        130,
        { amount_minor: '12000' },
        { base: '3', timestamp: '2000-01-01T00:00:00Z' },
      ),
    });
    await client('b', 'enqueue', {
      operation: operation(131, { amount_minor: '13000' }, { base: '3' }),
    });
    assert.equal((await client('a', 'push')).results[0].status, 'APPLIED');
    const conflictResult = (await client('b', 'push')).results[0];
    assert.equal(conflictResult.status, 'CONFLICT');
    const conflicted = await drain('b');
    assert.equal(main(conflicted).snapshot.amount_minor, '12000');
    const conflict = conflicted.conflicts.find(
      (row) => row.id === conflictResult.conflict_id,
    );
    assert.equal(
      conflict.base_snapshot.snapshot.amount_minor,
      '9223372036854775807',
    );
    assert.equal(conflict.local_proposal.patch.amount_minor, '13000');
    assert.equal(conflict.remote_snapshot.snapshot.amount_minor, '12000');
    assert.equal(
      conflicted.outbox.find((row) => row.id === id(131)).state,
      'CONFLICT',
    );
    assert.deepEqual(
      await service.push(
        b,
        operation(131, { amount_minor: '13000' }, { base: '3' }),
      ),
      conflictResult,
    );
    passed();
    step('authorized_resolution_creates_audited_revision');
    const resolution = operation(
      132,
      { amount_minor: '12500' },
      { base: '4', resolves: conflict.id },
    );
    const readerState = await drain('reader');
    assert.equal(readerState.conflicts.length, 1);
    await reject(service.push(reader, resolution), 'REJECTED_PERMISSION');
    const resolved = await service.push(b, resolution);
    assert.equal(resolved.version, '5');
    await reject(
      service.push(a, { ...resolution, operation_id: id(133) }),
      'RESOLUTION_OUTDATED',
    );
    const audit = (
      await query(
        'SELECT source,actor_id FROM us005.revision WHERE entity_id=$1 AND version=5',
        [f.entity],
      )
    )[0];
    assert.equal(audit.source, 'SYNC_RESOLUTION');
    assert.equal(audit.actor_id, f.userB);
    assert.equal((await drain('b')).conflicts[0].state, 'RESOLVED');
    passed();
    step('changed_then_reverted_field_still_conflicts');
    await service.push(
      a,
      operation(140, { description: 'SYNTHETIC transient' }, { base: '5' }),
    );
    await service.push(
      a,
      operation(141, { description: 'SYNTHETIC persisted' }, { base: '6' }),
    );
    assert.equal(
      (
        await service.push(
          b,
          operation(142, { description: 'SYNTHETIC stale' }, { base: '5' }),
        )
      ).status,
      'CONFLICT',
    );
    passed();

    step('concurrent_delete_and_edit_require_resolution');
    assert.equal(
      (await service.push(a, operation(150, {}, { base: '7', deleted: true })))
        .status,
      'APPLIED',
    );
    const deleteConflict = await service.push(
      b,
      operation(151, { amount_minor: '-9223372036854775808' }, { base: '7' }),
    );
    assert.equal(deleteConflict.status, 'CONFLICT');
    assert.equal(
      (await service.push(b, operation(152, syntheticRecord, { base: '0' })))
        .status,
      'CONFLICT',
    );
    const deleted = await drain('b');
    assert.equal(main(deleted).deleted, true);
    const tombstones = await query(
      'SELECT version FROM us005.tombstone WHERE entity_id=$1',
      [f.entity],
    );
    assert.equal(tombstones[0].version, '8');
    assert.equal(
      (
        await service.push(
          b,
          operation(
            153,
            { ...syntheticRecord, amount_minor: '-9223372036854775808' },
            { base: '8', resolves: deleteConflict.conflict_id },
          ),
        )
      ).version,
      '9',
    );
    assert.equal(
      (
        await query(
          'SELECT amount_minor FROM us005.record WHERE entity_id=$1',
          [f.entity],
        )
      )[0].amount_minor,
      '-9223372036854775808',
    );
    await service.push(
      a,
      operation(
        154,
        { description: 'SYNTHETIC edit before delete' },
        { base: '9' },
      ),
    );
    assert.equal(
      (await service.push(b, operation(155, {}, { base: '9', deleted: true })))
        .status,
      'CONFLICT',
    );
    passed();
    step('pull_data_and_cursor_rollback_after_process_death');
    const beforePull = await client('a', 'inspect');
    await client('a', 'pull', { crash: 'before_commit' }, 86);
    const afterCrash = await client('a', 'inspect');
    assert.deepEqual(afterCrash.records, beforePull.records);
    assert.equal(afterCrash.meta.cursor, beforePull.meta.cursor);
    const recovered = await drain('a');
    assert.equal(main(recovered).version, '10');
    assert.deepEqual(main(recovered), main(await drain('b')));
    passed();
    step('server_failure_rolls_back_revision_feed_and_receipt');
    const atomic = operation(
      160,
      { description: 'SYNTHETIC atomic' },
      { base: '10' },
    );
    const beforeAtomic = await service.snapshot(a, {
      workspace_id: f.workspace,
    });
    failId = atomic.operation_id;
    await reject(service.push(a, atomic), 'REQUEST_FAILED');
    const afterAtomic = await service.snapshot(a, {
      workspace_id: f.workspace,
    });
    assert.deepEqual(afterAtomic, beforeAtomic);
    assert.equal(
      (
        await query(
          'SELECT operation_id FROM us005.receipt WHERE operation_id=$1',
          [atomic.operation_id],
        )
      ).length,
      0,
    );
    failId = undefined;
    assert.equal((await service.push(a, atomic)).version, '11');
    passed();

    step('concurrent_push_commit_order_and_no_silent_loss');
    const concurrent = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.push(
          index % 2 ? a : b,
          operation(
            200 + index,
            { amount_minor: String(20000 + index) },
            {
              base: '11',
              timestamp:
                index % 2 ? '1999-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
            },
          ),
        ),
      ),
    );
    assert.equal(
      concurrent.filter((row) => row.status === 'APPLIED').length,
      1,
    );
    assert.equal(
      concurrent.filter((row) => row.status === 'CONFLICT').length,
      11,
    );
    const winnerIndex = concurrent.findIndex((row) => row.status === 'APPLIED');
    const winningOperation = operation(
      200 + winnerIndex,
      { amount_minor: String(20000 + winnerIndex) },
      {
        base: '11',
        timestamp:
          winnerIndex % 2 ? '1999-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
      },
    );
    const duplicates = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.push(winnerIndex % 2 ? a : b, winningOperation),
      ),
    );
    assert.ok(
      duplicates.every(
        (row) =>
          row.version === '12' &&
          row.sequence === concurrent[winnerIndex].sequence,
      ),
    );
    const feed = await query(
      'SELECT sequence,version,snapshot FROM us005.change WHERE workspace_id=$1 ORDER BY sequence',
      [f.workspace],
    );
    assert.deepEqual(
      feed.map((row) => row.sequence),
      Array.from({ length: feed.length }, (_, index) => String(index + 1)),
    );
    assert.equal(
      feed.filter(
        (row) =>
          row.version === '12' &&
          row.snapshot.description === 'SYNTHETIC atomic',
      ).length,
      1,
    );
    passed();
    step('immutable_paginated_feed_and_convergence');
    const page = await service.pull(b, {
      workspace_id: f.workspace,
      generation: f.generation,
      cursor: '0',
      limit: 1,
    });
    assert.equal(page.changes[0].version, '1');
    assert.equal(
      page.changes[0].snapshot.amount_minor,
      syntheticRecord.amount_minor,
    );
    const [finalA, finalB] = await Promise.all([drain('a'), drain('b')]);
    assert.deepEqual(main(finalA), main(finalB));
    assert.equal(finalA.meta.cursor, finalB.meta.cursor);
    assert.deepEqual(finalA.conflicts, finalB.conflicts);
    passed();
    step('revoked_member_cannot_push_pull_or_replay');
    await client('b', 'enqueue', {
      operation: operation(230, { date: '2026-10-16' }, { base: '12' }),
    });
    await admin(
      'UPDATE us005.membership SET active=false WHERE workspace_id=$1 AND user_id=$2',
      [f.workspace, f.userB],
    );
    const revoked = await client('b', 'push');
    assert.equal(revoked.results[0].status, 'REJECTED_PERMISSION');
    assert.equal(revoked.outbox.at(-1).state, 'REVOKED');
    await reject(
      service.push(b, operation(131, { amount_minor: '13000' }, { base: '3' })),
      'REJECTED_PERMISSION',
    );
    assert.equal(
      (await client('b', 'pull')).results[0].status,
      'REJECTED_PERMISSION',
    );
    await admin(
      'UPDATE us005.membership SET active=true WHERE workspace_id=$1 AND user_id=$2',
      [f.workspace, f.userB],
    );
    passed();
    step('revoked_device_cannot_replay');
    await admin(
      'UPDATE us005.device SET active=false WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
      [f.workspace, f.userB, f.deviceB],
    );
    await reject(
      service.push(b, operation(131, { amount_minor: '13000' }, { base: '3' })),
      'REJECTED_PERMISSION',
    );
    await admin(
      'UPDATE us005.device SET active=true WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
      [f.workspace, f.userB, f.deviceB],
    );
    passed();
    step('revoked_account_scope_cannot_read_or_replay');
    await admin(
      'DELETE FROM us005.account_scope WHERE workspace_id=$1 AND user_id=$2 AND account_id=$3',
      [f.workspace, f.userB, f.account],
    );
    assert.equal(
      (await service.snapshot(b, { workspace_id: f.workspace })).records.length,
      0,
    );
    await reject(
      service.push(b, operation(131, { amount_minor: '13000' }, { base: '3' })),
      'REJECTED_PERMISSION',
    );
    await admin('INSERT INTO us005.account_scope VALUES($1,$2,$3)', [
      f.workspace,
      f.userB,
      f.account,
    ]);
    passed();
    step('expired_cursor_requires_snapshot');
    await admin('UPDATE us005.workspace SET floor=head WHERE id=$1', [
      f.workspace,
    ]);
    assert.equal(
      (
        await service.pull(a, {
          workspace_id: f.workspace,
          generation: f.generation,
          cursor: '0',
          limit: 2,
        })
      ).status,
      'SNAPSHOT_REQUIRED',
    );
    assert.equal((await client('a', 'snapshot')).results[0].status, 'OK');
    passed();
    step('generation_change_quarantines_old_outbox');
    await client('a', 'enqueue', {
      operation: operation(
        240,
        { description: 'SYNTHETIC previous binding' },
        { base: '12' },
      ),
    });
    await admin(
      'UPDATE us005.workspace SET generation=$2,head=0,floor=0 WHERE id=$1',
      [f.workspace, f.nextGeneration],
    );
    assert.equal(
      (await client('a', 'push')).results[0].status,
      'STALE_GENERATION',
    );
    assert.equal(
      (await client('a', 'pull')).results[0].status,
      'SNAPSHOT_REQUIRED',
    );
    const rebootstrap = await client('a', 'snapshot');
    assert.equal(rebootstrap.meta.generation, f.nextGeneration);
    assert.equal(rebootstrap.meta.cursor, '0');
    assert.equal(rebootstrap.outbox.at(-1).state, 'QUARANTINED');
    assert.equal(main(rebootstrap).version, '12');
    assert.equal(
      (
        await service.push(
          a,
          operation(
            241,
            { date: '2026-10-17' },
            { base: '12', generation: f.nextGeneration },
          ),
        )
      ).status,
      'APPLIED',
    );
    assert.equal(main(await drain('a')).snapshot.date, '2026-10-17');
    passed();
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'two-client-sync-spike',
      passed: true,
      checks,
      schema_sha256: checksum,
      postgres_version: postgresVersion,
      independent_client_processes: childProcesses,
      concurrent_pushes: 12,
    };
  } catch {
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'two-client-sync-spike',
      passed: false,
      checks,
      failed_step: stage,
    };
  } finally {
    await transport?.close();
    await Promise.all(pools.map((value) => value.end()));
    for (const file of files)
      for (const suffix of ['', '-wal', '-shm'])
        rmSync(file + suffix, { force: true });
  }
}
