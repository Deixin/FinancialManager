import { resourceId } from '@financial-manager/contracts';
import {
  captureCounterpartyAssociation,
  counterpartyAssociationChange,
  validateCounterpartyAssociationPlan,
  CounterpartyAssociationError,
  captureCounterpartyReference,
} from '@financial-manager/domain/counterparties';
import type {
  CounterpartyAssociationCommand,
  CounterpartyReference,
} from '@financial-manager/domain/counterparties';
import { RevisionError } from './revisions.js';
import type { RevisionService, RevisionRequest } from './revisions.js';
export function createCounterpartyAssociationService(
  service: Pick<RevisionService, 'applyGuarded'>,
) {
  if (typeof service?.applyGuarded !== 'function')
    throw new RevisionError('CONFIGURATION_INVALID');
  const apply = service.applyGuarded.bind(service);
  return Object.freeze({
    async apply(
      request: RevisionRequest,
      input: readonly CounterpartyAssociationCommand[],
    ) {
      let commands: readonly CounterpartyAssociationCommand[], w: string;
      try {
        w = resourceId(request.workspace_id);
        if (
          !Array.isArray(input) ||
          !input.length ||
          input.length > 256 ||
          JSON.stringify(input).length > 4 * 1024 * 1024
        )
          throw Error();
        commands = Object.freeze(
          Array.from(input, (c) => captureCounterpartyAssociation(c, w)),
        );
        if (new Set(commands.map((c) => c.base.id)).size !== commands.length)
          throw Error();
        for (const c of commands) {
          resourceId(c.base.id);
          if (c.counterparty.kind === 'SET')
            resourceId(c.counterparty.counterparty_id);
        }
      } catch (e) {
        throw e instanceof CounterpartyAssociationError
          ? e
          : new CounterpartyAssociationError(
              'INVALID_COUNTERPARTY_ASSOCIATION',
            );
      }
      const changes = commands.map(counterpartyAssociationChange),
        ids = Object.freeze(
          [
            ...new Set(
              changes.flatMap((c) =>
                c.content.counterparty_id === null
                  ? []
                  : [resourceId(c.content.counterparty_id)],
              ),
            ),
          ].sort(),
        );
      let references: Promise<readonly CounterpartyReference[]> | undefined,
        rejected: CounterpartyAssociationError | undefined;
      try {
        return await apply(request, changes, async (context) => {
          if (!context.readCounterparties)
            throw new RevisionError('CONFIGURATION_INVALID');
          references ??= ids.length
            ? context.readCounterparties(ids).then((rows) => {
                if (!Array.isArray(rows) || rows.length > ids.length)
                  throw new RevisionError('DATA_ACCESS_FAILED');
                const captured = Object.freeze(
                  Array.from(rows, (r) => captureCounterpartyReference(r, w)),
                );
                for (const r of captured) {
                  if (!ids.includes(resourceId(r.id)))
                    throw new RevisionError('DATA_ACCESS_FAILED');
                }
                return captured;
              })
            : Promise.resolve(Object.freeze([]));
          const current = await references,
            command = commands.find((c) => c.base.id === context.plan.after.id);
          if (!command) throw new RevisionError('INVALID_REVISION');
          try {
            validateCounterpartyAssociationPlan(
              command,
              context.plan,
              current,
              w,
            );
          } catch (e) {
            if (e instanceof CounterpartyAssociationError) rejected = e;
            throw new RevisionError('INVALID_REVISION');
          }
        });
      } catch (e) {
        if (
          rejected &&
          e instanceof RevisionError &&
          e.code === 'INVALID_REVISION'
        )
          throw rejected;
        throw e instanceof RevisionError
          ? e
          : new RevisionError('DATA_ACCESS_FAILED');
      }
    },
  });
}
