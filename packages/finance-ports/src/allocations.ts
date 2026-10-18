import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureAllocation,
  allocationChange,
  validateAllocationPlan,
  AllocationError,
} from '@financial-manager/domain/classification';
import type { AllocationCommand } from '@financial-manager/domain/classification';
import type { TaxonomyCatalog } from '@financial-manager/domain/taxonomy';
import { RevisionError } from './revisions.js';
import type { RevisionService, RevisionRequest } from './revisions.js';

export function createAllocationService(
  service: Pick<RevisionService, 'applyGuarded'>,
) {
  if (typeof service?.applyGuarded !== 'function')
    throw new RevisionError('CONFIGURATION_INVALID');
  const apply = service.applyGuarded.bind(service);
  return Object.freeze({
    async apply(request: RevisionRequest, input: readonly AllocationCommand[]) {
      let commands: readonly AllocationCommand[], w: string;
      try {
        w = resourceId(request.workspace_id);
        if (
          !Array.isArray(input) ||
          !input.length ||
          input.length > 256 ||
          JSON.stringify(input).length > 4 * 1024 * 1024
        )
          throw Error();
        commands = Object.freeze(input.map((c) => captureAllocation(c, w)));
        if (new Set(commands.map((c) => c.base.id)).size !== commands.length)
          throw Error();
        for (const c of commands) {
          resourceId(c.base.id);
          if (c.allocation.kind === 'REPLACE')
            for (const a of c.allocation.allocations) {
              (c.base.content.allocations.some((r) => r.id === a.id)
                ? resourceId
                : uuidV7)(a.id);
              resourceId(a.category_id);
              if (a.subcategory_id !== null) resourceId(a.subcategory_id);
            }
        }
      } catch (e) {
        throw e instanceof AllocationError
          ? e
          : new AllocationError('INVALID_ALLOCATION_CHANGE');
      }
      let rejected: AllocationError | undefined,
        catalog: Promise<TaxonomyCatalog> | undefined;
      try {
        return await apply(
          request,
          commands.map(allocationChange),
          async (context) => {
            if (!context.readTaxonomy)
              throw new RevisionError('CONFIGURATION_INVALID');
            catalog ??= context.readTaxonomy();
            const current = await catalog,
              command = commands.find(
                (c) => c.base.id === context.plan.after.id,
              );
            if (!command) throw new RevisionError('INVALID_REVISION');
            try {
              validateAllocationPlan(command, context.plan, current, w);
            } catch (e) {
              if (e instanceof AllocationError) rejected = e;
              throw new RevisionError('INVALID_REVISION');
            }
          },
        );
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
