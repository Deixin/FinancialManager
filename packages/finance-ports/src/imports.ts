import { resourceId, uuidV7 } from '@financial-manager/contracts';
import { utcInstant } from '@financial-manager/domain';
import {
  ImportCentralError,
  captureImportBatch,
  captureImportSource,
  captureImportCounts,
  captureImportEffect,
  captureImportQuery,
  defaultImportQuery,
  importExact,
} from '@financial-manager/domain/imports';
import type {
  ImportBatch,
  ImportSource,
  ImportCounts,
  ImportEffect,
  ImportQuery,
} from '@financial-manager/domain/imports';
export interface ImportRequest {
  readonly workspace_id: string;
  readonly principal_id?: string;
}
export interface ImportGrant {
  readonly workspace_id: string;
  readonly authority: 'LOCAL' | 'CLOUD';
  readonly can_read: boolean;
  readonly can_prepare: boolean;
  readonly account_ids: readonly string[] | null;
  readonly member_id: string | null;
}
export interface ImportScope {
  readonly workspace_id: string;
  readonly account_ids: readonly string[] | null;
}
export interface ImportTransaction {
  workspace(): Promise<Readonly<{ storage_mode: 'LOCAL' | 'CLOUD' }> | null>;
  account(id: string): Promise<Readonly<{
    id: string;
    workspace_id: string;
    status: 'ACTIVE' | 'ARCHIVED';
  }> | null>;
  candidates(query: ImportQuery): Promise<readonly ImportBatch[]>;
  batch(id: string): Promise<ImportBatch | null>;
  sources(id: string): Promise<readonly ImportSource[]>;
  counts(id: string): Promise<ImportCounts>;
  effects(
    id: string,
    after: string | null,
    limit: number,
  ): Promise<readonly ImportEffect[]>;
  effectTransactionIds(id: string): Promise<readonly string[]>;
  transactionAccounts(ids: readonly string[]): Promise<
    readonly Readonly<{
      id: string;
      workspace_id: string;
      account_id: string;
    }>[]
  >;
  insert(batch: ImportBatch): Promise<void>;
}
export interface ImportCentralOptions {
  readonly authorize: (
    request: Readonly<ImportRequest>,
  ) => Promise<ImportGrant | null>;
  readonly now: () => string;
  readonly store: {
    transaction<T>(
      scope: ImportScope,
      mode: 'READ' | 'WRITE',
      run: (tx: ImportTransaction) => Promise<T>,
    ): Promise<T>;
  };
}
export interface ImportSummary {
  readonly batch: ImportBatch;
  readonly sources: readonly ImportSource[];
  readonly counts: ImportCounts;
}
export function createImportCentralService(options: ImportCentralOptions) {
  if (
    typeof options?.authorize !== 'function' ||
    typeof options.now !== 'function' ||
    typeof options.store?.transaction !== 'function'
  )
    throw new ImportCentralError('CONFIGURATION_INVALID');
  function request(raw: ImportRequest): Readonly<ImportRequest> {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (k) => !['workspace_id', 'principal_id'].includes(k),
      ) ||
      (raw.principal_id !== undefined &&
        (typeof raw.principal_id !== 'string' ||
          !raw.principal_id.trim() ||
          raw.principal_id !== raw.principal_id.trim() ||
          raw.principal_id.length > 256 ||
          /\p{Cc}/u.test(raw.principal_id)))
    )
      throw new ImportCentralError('INVALID_IMPORT_REQUEST');
    return Object.freeze({
      workspace_id: resourceId(raw.workspace_id),
      ...(raw.principal_id === undefined
        ? {}
        : { principal_id: raw.principal_id }),
    });
  }
  function ids(b: ImportBatch) {
    resourceId(b.id);
    resourceId(b.workspace_id);
    for (const id of [
      b.target_account_id,
      b.reverses_batch_id,
      b.created_by_member_id,
    ])
      if (id !== null) resourceId(id);
    return b;
  }
  async function execute<T>(
    raw: ImportRequest,
    mode: 'READ' | 'WRITE',
    capture: () => T,
    run: (
      tx: ImportTransaction,
      scope: ImportScope,
      g: Readonly<ImportGrant>,
      input: T,
    ) => Promise<unknown>,
  ) {
    try {
      let req: Readonly<ImportRequest>, input: T;
      try {
        req = request(raw);
        input = capture();
      } catch {
        throw new ImportCentralError('INVALID_IMPORT_REQUEST');
      }
      let g: Readonly<ImportGrant>;
      try {
        const grant = await options.authorize(req);
        if (
          !grant ||
          grant.workspace_id !== req.workspace_id ||
          grant.can_read !== true ||
          typeof grant.can_prepare !== 'boolean' ||
          (mode === 'WRITE' && !grant.can_prepare) ||
          !['LOCAL', 'CLOUD'].includes(grant.authority) ||
          (grant.authority === 'LOCAL'
            ? req.principal_id !== undefined || grant.member_id !== null
            : !req.principal_id || grant.member_id === null) ||
          (grant.account_ids !== null &&
            (!Array.isArray(grant.account_ids) ||
              grant.account_ids.length > 10000))
        )
          throw Error();
        if (grant.member_id !== null) resourceId(grant.member_id);
        g = Object.freeze({
          ...grant,
          account_ids:
            grant.account_ids === null
              ? null
              : Object.freeze(
                  [
                    ...new Set(Array.from(grant.account_ids, resourceId)),
                  ].sort(),
                ),
        });
      } catch {
        throw new ImportCentralError('ACCESS_DENIED');
      }
      const scope = Object.freeze({
        workspace_id: req.workspace_id,
        account_ids: g.account_ids,
      });
      return await options.store.transaction(scope, mode, async (tx) => {
        const workspace = await tx.workspace();
        if (!workspace || workspace.storage_mode !== g.authority)
          throw new ImportCentralError('ACCESS_DENIED');
        return run(tx, scope, g, input);
      });
    } catch (e) {
      if (e instanceof ImportCentralError) throw e;
      throw new ImportCentralError('DATA_ACCESS_FAILED');
    }
  }
  function allowed(scope: ImportScope, account: string | null) {
    return (
      scope.account_ids === null ||
      (account !== null && scope.account_ids.includes(account))
    );
  }
  async function visible(
    tx: ImportTransaction,
    scope: ImportScope,
    b: ImportBatch,
  ) {
    if (!allowed(scope, b.target_account_id)) return false;
    if (scope.account_ids === null) return true;
    const raw = await tx.effectTransactionIds(b.id);
    if (!Array.isArray(raw) || raw.length > 10000)
      throw new ImportCentralError('IMPORT_LIMIT');
    const ids = Object.freeze([...new Set(Array.from(raw, resourceId))]);
    const refs = await tx.transactionAccounts(ids);
    if (
      !Array.isArray(refs) ||
      refs.length !== ids.length ||
      new Set(refs.map((r) => r.id)).size !== refs.length
    )
      throw new ImportCentralError('INVALID_IMPORT_STATE');
    for (const r of refs) {
      importExact(r, ['id', 'workspace_id', 'account_id']);
      const id = resourceId(r.id);
      resourceId(r.account_id);
      if (r.workspace_id !== scope.workspace_id || !ids.includes(id))
        throw new ImportCentralError('INVALID_IMPORT_STATE');
    }
    return refs.every((r) => allowed(scope, r.account_id));
  }
  async function summary(
    tx: ImportTransaction,
    scope: ImportScope,
    b: ImportBatch,
  ): Promise<ImportSummary> {
    const raw = await tx.sources(b.id);
    if (!Array.isArray(raw) || raw.length > 16)
      throw new ImportCentralError('IMPORT_LIMIT');
    const sources = Array.from(raw, (r) =>
      captureImportSource(r, scope.workspace_id, b.id),
    );
    for (const r of sources) {
      resourceId(r.id);
      resourceId(r.batch_id);
    }
    if (new Set(sources.map((r) => r.id)).size !== sources.length)
      throw new ImportCentralError('INVALID_IMPORT_STATE');
    const counts = captureImportCounts(await tx.counts(b.id));
    if (
      BigInt(counts.total_items) > 200000n ||
      BigInt(counts.total_effects) > 400000n
    )
      throw new ImportCentralError('IMPORT_LIMIT');
    return Object.freeze({ batch: b, sources: Object.freeze(sources), counts });
  }
  return Object.freeze({
    list(raw: ImportRequest, query: ImportQuery = defaultImportQuery) {
      return execute(
        raw,
        'READ',
        () => {
          const q = captureImportQuery(query);
          if (q.account_id !== null) resourceId(q.account_id);
          if (q.cursor) resourceId(q.cursor.id);
          return q;
        },
        async (tx, scope, _g, q) => {
          if (q.account_id !== null && !allowed(scope, q.account_id))
            throw new ImportCentralError('ACCESS_DENIED');
          const candidates = await tx.candidates(q);
          if (!Array.isArray(candidates) || candidates.length > q.limit + 1)
            throw new ImportCentralError('INVALID_IMPORT_STATE');
          const rows = Array.from(candidates, (r) =>
            ids(captureImportBatch(r, scope.workspace_id)),
          );
          if (
            new Set(rows.map((r) => r.id)).size !== rows.length ||
            rows.some(
              (r, i) =>
                (q.statuses.length && !q.statuses.includes(r.status)) ||
                (q.account_id !== null &&
                  r.target_account_id !== q.account_id) ||
                (q.cursor !== null &&
                  !(
                    r.created_at < q.cursor.created_at ||
                    (r.created_at === q.cursor.created_at && r.id < q.cursor.id)
                  )) ||
                (i > 0 &&
                  !(
                    r.created_at < rows[i - 1]!.created_at ||
                    (r.created_at === rows[i - 1]!.created_at &&
                      r.id < rows[i - 1]!.id)
                  )),
            )
          )
            throw new ImportCentralError('INVALID_IMPORT_STATE');
          const page = rows.slice(0, q.limit),
            items: ImportSummary[] = [];
          for (const b of page)
            if (await visible(tx, scope, b))
              items.push(await summary(tx, scope, b));
          const last = page.at(-1);
          return Object.freeze({
            items: Object.freeze(items),
            next_cursor:
              rows.length > q.limit && last
                ? Object.freeze({ created_at: last.created_at, id: last.id })
                : null,
          });
        },
      ) as Promise<
        Readonly<{
          items: readonly ImportSummary[];
          next_cursor: ImportQuery['cursor'];
        }>
      >;
    },
    detail(
      raw: ImportRequest,
      query: Readonly<{
        id: string;
        effect_after: string | null;
        effect_limit: number;
      }>,
    ) {
      return execute(
        raw,
        'READ',
        () => {
          importExact(query, ['id', 'effect_after', 'effect_limit']);
          if (
            !Number.isSafeInteger(query.effect_limit) ||
            query.effect_limit < 1 ||
            query.effect_limit > 100
          )
            throw Error();
          return Object.freeze({
            id: resourceId(query.id),
            effect_after:
              query.effect_after === null
                ? null
                : resourceId(query.effect_after),
            effect_limit: query.effect_limit,
          });
        },
        async (tx, scope, _g, q) => {
          const raw = await tx.batch(q.id);
          const b = raw
            ? ids(captureImportBatch(raw, scope.workspace_id))
            : null;
          if (!b || b.id !== q.id || !(await visible(tx, scope, b)))
            throw new ImportCentralError('IMPORT_NOT_FOUND');
          const s = await summary(tx, scope, b),
            rows = await tx.effects(b.id, q.effect_after, q.effect_limit + 1);
          if (!Array.isArray(rows) || rows.length > q.effect_limit + 1)
            throw new ImportCentralError('INVALID_IMPORT_STATE');
          const captured = Array.from(rows, (r) =>
            captureImportEffect(r, scope.workspace_id, b.id),
          );
          for (const r of captured) {
            for (const id of [
              r.id,
              r.import_item_id,
              r.transaction_id,
              r.before_revision_id,
              r.after_revision_id,
            ])
              if (id !== null) resourceId(id);
          }
          if (
            captured.some(
              (r, i) =>
                (q.effect_after !== null && r.id <= q.effect_after) ||
                (i > 0 && r.id <= captured[i - 1]!.id),
            )
          )
            throw new ImportCentralError('INVALID_IMPORT_STATE');
          const effects = Object.freeze(captured.slice(0, q.effect_limit));
          return Object.freeze({
            ...s,
            effects,
            next_effect_cursor:
              captured.length > q.effect_limit ? effects.at(-1)!.id : null,
          });
        },
      ) as Promise<
        ImportSummary &
          Readonly<{
            effects: readonly ImportEffect[];
            next_effect_cursor: string | null;
          }>
      >;
    },
    prepare(
      raw: ImportRequest,
      command: Readonly<{ id: string; target_account_id: string }>,
    ) {
      return execute(
        raw,
        'WRITE',
        () => {
          importExact(command, ['id', 'target_account_id']);
          return Object.freeze({
            id: uuidV7(command.id),
            target_account_id: resourceId(command.target_account_id),
          });
        },
        async (tx, scope, g, c) => {
          if (!allowed(scope, c.target_account_id))
            throw new ImportCentralError('ACCESS_DENIED');
          const prior = await tx.batch(c.id);
          if (prior) {
            const b = ids(captureImportBatch(prior, scope.workspace_id));
            if (
              b.id !== c.id ||
              b.batch_kind !== 'IMPORT' ||
              b.target_account_id !== c.target_account_id ||
              b.created_by_member_id !== g.member_id
            )
              throw new ImportCentralError('IMPORT_BASE_CONFLICT');
            if (!(await visible(tx, scope, b)))
              throw new ImportCentralError('IMPORT_NOT_FOUND');
            return Object.freeze({
              created: false,
              ...(await summary(tx, scope, b)),
            });
          }
          const account = await tx.account(c.target_account_id);
          if (
            !account ||
            account.id !== c.target_account_id ||
            account.workspace_id !== scope.workspace_id ||
            account.status !== 'ACTIVE'
          )
            throw new ImportCentralError('IMPORT_ACCOUNT_UNAVAILABLE');
          const b = ids(
            captureImportBatch(
              {
                id: c.id,
                workspace_id: scope.workspace_id,
                target_account_id: c.target_account_id,
                batch_kind: 'IMPORT',
                status: 'PREPARING',
                reverses_batch_id: null,
                created_by_member_id: g.member_id,
                created_at: utcInstant(options.now()),
                committed_at: null,
                version: '1',
                failure_code: null,
              },
              scope.workspace_id,
            ),
          );
          await tx.insert(b);
          return Object.freeze({
            created: true,
            ...(await summary(tx, scope, b)),
          });
        },
      ) as Promise<Readonly<{ created: boolean }> & ImportSummary>;
    },
  });
}
