import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureTransfer,
  transferChanges,
  validateTransferPlan,
  TransferError,
} from '@financial-manager/domain/transfers';
import type { TransferCommand } from '@financial-manager/domain/transfers';
import { RevisionError } from './revisions.js';
import type { RevisionRequest, RevisionService } from './revisions.js';
export function createTransferService(
  service: Pick<RevisionService, 'applyGuarded' | 'applyComposite'>,
) {
  if (
    typeof service?.applyGuarded !== 'function' ||
    typeof service.applyComposite !== 'function'
  )
    throw new RevisionError('CONFIGURATION_INVALID');
  const apply = service.applyGuarded.bind(service),
    create = service.applyComposite.bind(service);
  return Object.freeze({
    async apply(request: RevisionRequest, input: TransferCommand) {
      let command: TransferCommand, workspace: string, changes;
      try {
        workspace = resourceId(request.workspace_id);
        command = captureTransfer(input, workspace);
        changes = transferChanges(command);
        for (const change of changes) resourceId(change.id);
        if (command.kind === 'CREATE') {
          uuidV7(command.id);
          uuidV7(command.source_entry_id);
          uuidV7(command.target_entry_id);
        }
      } catch (e) {
        throw e instanceof TransferError
          ? e
          : new TransferError('INVALID_TRANSFER');
      }
      let rejected: TransferError | undefined;
      const guard: Parameters<typeof apply>[2] = (context) => {
        try {
          validateTransferPlan(command, context, workspace);
        } catch (e) {
          if (e instanceof TransferError) rejected = e;
          throw new RevisionError('INVALID_REVISION');
        }
      };
      try {
        return command.kind === 'CREATE'
          ? await create(
              request,
              changes,
              { id: command.id, group_type: 'TRANSFER' },
              guard,
            )
          : await apply(request, changes, guard);
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
