import { resourceId, uuidV7 } from '@financial-manager/contracts';
export { createAllocationService } from './allocations.js';
import {
  captureClassification,
  classificationChange,
  validateClassificationPlan,
  ClassificationError,
} from '@financial-manager/domain/classification';
import type { ClassificationCommand } from '@financial-manager/domain/classification';
import type { TaxonomyCatalog } from '@financial-manager/domain/taxonomy';
import { RevisionError } from './revisions.js';
import type { RevisionService, RevisionRequest } from './revisions.js';
export function createClassificationService(
  service: Pick<RevisionService, 'applyGuarded'>,
) {
  if (typeof service?.applyGuarded !== 'function')
    throw new RevisionError('CONFIGURATION_INVALID');
  const apply = service.applyGuarded.bind(service);
  return Object.freeze({
    async apply(
      request: RevisionRequest,
      input: readonly ClassificationCommand[],
    ) {
      let commands: readonly ClassificationCommand[], w: string;
      try {
        w = resourceId(request.workspace_id);
        if (
          !Array.isArray(input) ||
          input.length < 1 ||
          input.length > 256 ||
          JSON.stringify(input).length > 4 * 1024 * 1024
        )
          throw Error();
        commands = Object.freeze(input.map((r) => captureClassification(r, w)));
        if (new Set(commands.map((c) => c.base.id)).size !== commands.length)
          throw Error();
        for (const c of commands) {
          resourceId(c.base.id);
          c.tag_ids.forEach(resourceId);
          if (c.classification.kind === 'SET') {
            (c.base.content.allocations.length === 0 ? uuidV7 : resourceId)(
              c.classification.allocation_id,
            );
            resourceId(c.classification.category_id);
            if (c.classification.subcategory_id !== null)
              resourceId(c.classification.subcategory_id);
          }
        }
      } catch (e) {
        throw e instanceof ClassificationError
          ? e
          : new ClassificationError('INVALID_CLASSIFICATION');
      }
      let rejected: ClassificationError | undefined,
        catalog: Promise<TaxonomyCatalog> | undefined;
      try {
        return await apply(
          request,
          commands.map(classificationChange),
          async (context) => {
            if (!context.readTaxonomy)
              throw new RevisionError('CONFIGURATION_INVALID');
            catalog ??= context.readTaxonomy();
            const current = await catalog;
            const command = commands.find(
              (c) => c.base.id === context.plan.after.id,
            );
            if (!command) throw new RevisionError('INVALID_REVISION');
            try {
              validateClassificationPlan(command, context.plan, current, w);
            } catch (e) {
              if (e instanceof ClassificationError) rejected = e;
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
