import type { RevisionService } from '../../packages/finance-ports/dist/revisions.js';
declare const service: RevisionService;
// @ts-expect-error a command service never exposes a SQL handle
service.db.query('select 1');
service.apply({ workspace_id: 'id' }, [
  {
    id: 'id',
    // @ts-expect-error version JSON uses canonical decimal strings, never numbers
    base_revision: 9007199254740993,
    content: {} as never,
  },
]);
service.apply(
  {
    workspace_id: 'id',
    // @ts-expect-error a caller cannot submit an authorization grant
    can_write: true,
  },
  [],
);
