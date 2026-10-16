import { createHash, randomUUID } from 'node:crypto';
import { inWorkspace } from './database.mjs';
import {
  SyncError,
  canonical,
  counter,
  mergeStatus,
  validateOperation,
  validatePatch,
  uuid,
} from './protocol.mjs';

export function createSyncService(
  pool,
  { beforeCommit = async () => {} } = {},
) {
  const push = async (context, proposal) => {
    const op = validateOperation(proposal);
    return inWorkspace(
      pool,
      context,
      op.workspace_id,
      async (tx, workspace, member) => {
        const allowed = await tx.query(
          'SELECT us005.can_write($1) AS allowed',
          [op.account_id],
        );
        if (!member.can_write || !allowed.rows[0].allowed)
          throw new SyncError('REJECTED_PERMISSION');
        if (op.generation !== workspace.generation)
          return { status: 'STALE_GENERATION' };
        const fingerprint = createHash('sha256')
          .update(canonical(op))
          .digest('hex');
        const previous = (
          await tx.query(
            'SELECT * FROM us005.receipt WHERE workspace_id=$1 AND generation=$2 AND operation_id=$3',
            [op.workspace_id, op.generation, op.operation_id],
          )
        ).rows[0];
        if (previous) {
          if (
            previous.actor_id !== context.userId ||
            previous.device_id !== context.deviceId
          )
            throw new SyncError('REJECTED_PERMISSION');
          if (previous.fingerprint !== fingerprint)
            throw new SyncError('IDEMPOTENCY_MISMATCH');
          return previous.result;
        }
        const remote = (
          await tx.query(
            'SELECT * FROM us005.record WHERE workspace_id=$1 AND entity_id=$2',
            [op.workspace_id, op.entity_id],
          )
        ).rows[0];
        if (remote && remote.account_id !== op.account_id)
          throw new SyncError('REJECTED_PERMISSION');
        let base = null;
        let changed = [];
        if (op.base_revision !== '0') {
          base = (
            await tx.query(
              'SELECT snapshot,deleted FROM us005.revision WHERE workspace_id=$1 AND entity_id=$2 AND version=$3',
              [op.workspace_id, op.entity_id, op.base_revision],
            )
          ).rows[0];
          if (!base) throw new SyncError('INVALID_BASE');
          changed = (
            await tx.query(
              'SELECT changed_fields FROM us005.revision WHERE workspace_id=$1 AND entity_id=$2 AND version>$3',
              [op.workspace_id, op.entity_id, op.base_revision],
            )
          ).rows.flatMap((row) => row.changed_fields);
        }
        let resolution;
        let status;
        if (op.resolves !== undefined) {
          resolution = (
            await tx.query(
              'SELECT * FROM us005.conflict WHERE workspace_id=$1 AND id=$2',
              [op.workspace_id, op.resolves],
            )
          ).rows[0];
          if (
            !resolution ||
            resolution.entity_id !== op.entity_id ||
            resolution.state !== 'OPEN' ||
            !remote ||
            op.base_revision !== remote.version
          )
            throw new SyncError('RESOLUTION_OUTDATED');
          if (remote.deleted && op.operation === 'UPSERT')
            validatePatch(op.patch, true);
          status = 'APPLIED';
        } else status = mergeStatus(op, remote, changed);
        let result;
        if (status === 'CONFLICT') {
          const id = randomUUID();
          await tx.query(
            "INSERT INTO us005.conflict(workspace_id,id,account_id,entity_id,base_version,remote_version,base_snapshot,remote_snapshot,local_proposal,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN')",
            [
              op.workspace_id,
              id,
              op.account_id,
              op.entity_id,
              op.base_revision,
              remote.version,
              base,
              { snapshot: remote.snapshot, deleted: remote.deleted },
              op,
            ],
          );
          result = { status, conflict_id: id, remote_version: remote.version };
        } else {
          const version = (BigInt(remote?.version ?? '0') + 1n).toString();
          const sequence = (BigInt(workspace.head) + 1n).toString();
          const deleted = op.operation === 'DELETE';
          const snapshot = deleted
            ? remote.snapshot
            : { ...remote?.snapshot, ...op.patch };
          validatePatch(snapshot, true);
          await tx.query(
            'INSERT INTO us005.record(workspace_id,entity_id,account_id,version,deleted,snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET version=EXCLUDED.version,deleted=EXCLUDED.deleted,snapshot=EXCLUDED.snapshot',
            [
              op.workspace_id,
              op.entity_id,
              op.account_id,
              version,
              deleted,
              snapshot,
            ],
          );
          await tx.query(
            'INSERT INTO us005.revision VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [
              op.workspace_id,
              op.entity_id,
              op.account_id,
              version,
              deleted,
              snapshot,
              op.changed_fields,
              context.userId,
              context.deviceId,
              resolution ? 'SYNC_RESOLUTION' : 'MANUAL',
            ],
          );
          await tx.query(
            'INSERT INTO us005.change VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              op.workspace_id,
              op.generation,
              sequence,
              op.entity_id,
              op.account_id,
              version,
              deleted,
              snapshot,
            ],
          );
          if (deleted)
            await tx.query(
              'INSERT INTO us005.tombstone VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,generation,entity_id) DO UPDATE SET version=EXCLUDED.version,sequence=EXCLUDED.sequence',
              [
                op.workspace_id,
                op.generation,
                op.entity_id,
                op.account_id,
                version,
                sequence,
              ],
            );
          await tx.query('UPDATE us005.workspace SET head=$2 WHERE id=$1', [
            op.workspace_id,
            sequence,
          ]);
          if (resolution)
            await tx.query(
              "UPDATE us005.conflict SET state='RESOLVED',resolved_version=$3 WHERE workspace_id=$1 AND id=$2",
              [op.workspace_id, resolution.id, version],
            );
          result = { status, version, sequence };
        }
        await tx.query(
          'INSERT INTO us005.receipt VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            op.workspace_id,
            op.generation,
            op.operation_id,
            op.account_id,
            context.userId,
            context.deviceId,
            fingerprint,
            result,
          ],
        );
        await beforeCommit(op);
        return result;
      },
    );
  };
  const pull = async (context, request) => {
    if (
      !uuid(request?.workspace_id) ||
      !uuid(request.generation) ||
      !counter(request.cursor) ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 100
    )
      throw new SyncError('INVALID_OPERATION');
    return inWorkspace(
      pool,
      context,
      request.workspace_id,
      async (tx, workspace) => {
        if (
          request.generation !== workspace.generation ||
          BigInt(request.cursor) < BigInt(workspace.floor) ||
          BigInt(request.cursor) > BigInt(workspace.head)
        )
          return { status: 'SNAPSHOT_REQUIRED' };
        const changes = (
          await tx.query(
            'SELECT generation,sequence,entity_id,account_id,version,deleted,snapshot FROM us005.change WHERE workspace_id=$1 AND generation=$2 AND sequence>$3 ORDER BY sequence LIMIT $4',
            [
              request.workspace_id,
              request.generation,
              request.cursor,
              request.limit,
            ],
          )
        ).rows;
        const cursor =
          changes.length === request.limit
            ? changes.at(-1).sequence
            : workspace.head;
        const conflicts = (
          await tx.query(
            'SELECT * FROM us005.conflict WHERE workspace_id=$1 ORDER BY id',
            [request.workspace_id],
          )
        ).rows;
        return {
          status: 'OK',
          generation: workspace.generation,
          cursor,
          changes,
          conflicts,
        };
      },
    );
  };
  const snapshot = async (context, request) =>
    inWorkspace(
      pool,
      context,
      request?.workspace_id,
      async (tx, workspace) => ({
        status: 'OK',
        generation: workspace.generation,
        cursor: workspace.head,
        records: (
          await tx.query(
            'SELECT entity_id,account_id,version,deleted,snapshot FROM us005.record WHERE workspace_id=$1 ORDER BY entity_id',
            [request.workspace_id],
          )
        ).rows,
        conflicts: (
          await tx.query(
            'SELECT * FROM us005.conflict WHERE workspace_id=$1 ORDER BY id',
            [request.workspace_id],
          )
        ).rows,
      }),
    );
  return { push, pull, snapshot };
}
