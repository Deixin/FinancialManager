import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const sourceFiles = [
  'packages/importers/spikes/us-006/contract.mjs',
  'packages/importers/spikes/us-006/csv.mjs',
  'packages/importers/spikes/us-006/ofx.mjs',
  'packages/importers/spikes/us-006/parse.mjs',
  'packages/importers/spikes/us-006/staging.mjs',
  'infra/importers/worker.mjs',
  'infra/importers/coordinator.mjs',
  'infra/importers/fixtures.mjs',
  'infra/importers/homologate.mjs',
  'infra/importers/sources.mjs',
  'infra/scripts/run-importer-spike.mjs',
  'infra/scripts/importer-evidence.mjs',
];
export function sourceHash() {
  return createHash('sha256')
    .update(
      sourceFiles
        .map(
          (name) =>
            name +
            '\n' +
            readFileSync(new URL('../../' + name, import.meta.url), 'utf8'),
        )
        .join('\n'),
    )
    .digest('hex');
}
