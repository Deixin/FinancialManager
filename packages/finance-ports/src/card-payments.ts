import { resourceId, uuidV7 } from '@financial-manager/contracts';
import {
  captureCardPayment,
  cardPaymentChanges,
  validateCardPaymentPlan,
  CardPaymentError,
} from '@financial-manager/domain/card-payments';
import type { CardPaymentCommand } from '@financial-manager/domain/card-payments';
import { RevisionError } from './revisions.js';
import type { RevisionRequest, RevisionService } from './revisions.js';
export function createCardPaymentService(
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
    async apply(request: RevisionRequest, input: CardPaymentCommand) {
      let command: CardPaymentCommand, workspace: string, changes;
      try {
        workspace = resourceId(request.workspace_id);
        command = captureCardPayment(input, workspace);
        changes = cardPaymentChanges(command);
        for (const change of changes) resourceId(change.id);
        if (command.kind === 'CREATE') {
          uuidV7(command.id);
          uuidV7(command.source_entry_id);
          uuidV7(command.target_entry_id);
        }
      } catch (e) {
        throw e instanceof CardPaymentError
          ? e
          : new CardPaymentError('INVALID_CARD_PAYMENT');
      }
      let rejected: CardPaymentError | undefined;
      const guard: Parameters<typeof apply>[2] = (context) => {
        try {
          validateCardPaymentPlan(command, context, workspace);
        } catch (e) {
          if (e instanceof CardPaymentError) rejected = e;
          throw new RevisionError('INVALID_REVISION');
        }
      };
      try {
        return command.kind === 'CREATE'
          ? await create(
              request,
              changes,
              { id: command.id, group_type: 'CARD_PAYMENT' },
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
