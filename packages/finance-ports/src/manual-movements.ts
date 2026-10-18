import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureManualMovement,
  manualMovementChange,
  validateManualMovementPlan,
  ManualMovementError,
} from '@financial-manager/domain/manual-movements';
import type { ManualMovementCommand } from '@financial-manager/domain/manual-movements';
import type { RevisionRequest, RevisionService } from './revisions.js';
import { RevisionError } from './revisions.js';
export function createManualMovementService(
  service: Pick<RevisionService, 'applyGuarded'>,
) {
  if (typeof service?.applyGuarded !== 'function')
    throw new RevisionError('CONFIGURATION_INVALID');
  const apply = service.applyGuarded.bind(service);
  return Object.freeze({
    async apply(request: RevisionRequest, input: ManualMovementCommand) {
      let workspace: string, command: ManualMovementCommand, change;
      try {
        workspace = resourceId(request.workspace_id);
        command = captureManualMovement(input, workspace);
        if ('id' in command) uuidV7(command.id);
        change = manualMovementChange(command);
      } catch (error) {
        throw error instanceof ManualMovementError
          ? error
          : new ManualMovementError('INVALID_MANUAL_MOVEMENT');
      }
      let rejected: ManualMovementError | undefined;
      try {
        const result = await apply(request, [change], (context) => {
          try {
            validateManualMovementPlan(command, context, workspace);
          } catch (error) {
            if (error instanceof ManualMovementError) rejected = error;
            throw new RevisionError('INVALID_REVISION');
          }
        });
        return result[0]!;
      } catch (error) {
        if (
          rejected &&
          error instanceof RevisionError &&
          error.code === 'INVALID_REVISION'
        )
          throw rejected;
        throw error instanceof RevisionError
          ? error
          : new RevisionError('DATA_ACCESS_FAILED');
      }
    },
  });
}
