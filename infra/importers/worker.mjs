import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseStatement } from '../../packages/importers/spikes/us-006/parse.mjs';
import {
  ImportError,
  limits,
} from '../../packages/importers/spikes/us-006/contract.mjs';
import { Staging } from '../../packages/importers/spikes/us-006/staging.mjs';

let cancelled = false;
let staging;
process.on('message', (message) => {
  if (message?.type === 'cancel') cancelled = true;
});
process.once('message', async (message) => {
  if (message?.type !== 'start') return;
  let transaction = false;
  try {
    const start = performance.now();
    if (statSync(message.input).size > limits.bytes)
      throw new ImportError('FILE_LIMIT');
    const bytes = readFileSync(message.input);
    staging = new Staging(message.staging);
    staging.begin(message.request.context);
    transaction = true;
    const metadata = await parseStatement(
      { ...message.request, bytes },
      {
        consume: (row) => staging.consume(row),
        progress: (value) => process.send({ type: 'progress', ...value }),
        cancelled: () => cancelled,
      },
    );
    if (cancelled) throw new ImportError('CANCELLED');
    staging.finish(metadata);
    transaction = false;
    process.send({
      type: 'progress',
      phase: 'PREVIEW_READY',
      rows: metadata.rows,
    });
    staging.close();
    staging = undefined;
    process.send({
      type: 'done',
      metadata,
      duration_ms: Math.ceil(performance.now() - start),
      peak_rss_kib: process.resourceUsage().maxRSS,
    });
  } catch (error) {
    if (transaction) {
      try {
        staging.rollback();
      } catch {
        /* Closing releases the transaction. */
      }
    }
    staging?.close();
    staging = undefined;
    process.send({
      type: 'failure',
      code: error instanceof ImportError ? error.code : 'PARSER_FAILED',
    });
  } finally {
    process.disconnect();
  }
});
