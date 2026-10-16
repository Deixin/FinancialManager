import { createWorkerObservability } from '../../apps/worker/dist/index.js';
import {
  sensitive,
  sensitiveError,
  workspaceId,
} from './sensitive-fixture.mjs';

// A one-shot synthetic process, not a durable queue or product worker.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 2048) throw new Error('SYNTHETIC_CARRIER_TOO_LARGE');
}
const telemetry = createWorkerObservability({
  environment: 'integration',
  mode: 'operational',
  sink: (line) => {
    process.stdout.write(line + '\n');
  },
});
try {
  await telemetry.run(
    'job.import',
    async (scope) => {
      scope.setMetadata({
        ...sensitive,
        workspace_id: workspaceId,
        parser_version: '1.0.0',
      });
      await telemetry.run('sync.batch', async () => {
        await telemetry.run(
          'db.query',
          (db) => {
            db.captureError(sensitiveError(), 'DEPENDENCY_UNAVAILABLE');
          },
          { metadata: { ...sensitive, entity_type: 'transaction' } },
        );
      });
    },
    { trust: 'internal', carrier: JSON.parse(input) },
  );
  await telemetry.flush();
} finally {
  await telemetry.shutdown();
}
