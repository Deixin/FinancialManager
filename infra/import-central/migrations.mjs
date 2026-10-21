import { readFileSync } from 'node:fs';
import { postgresCatalog, sha256 } from '../schema/postgres-migrations.mjs';
import { migrationContent } from '../../packages/storage-schema/dist/migrations.js';
export async function postgresImportCatalog() {
  const directory = new URL(
      '../../apps/api/persistence/postgres/migrations/',
      import.meta.url,
    ),
    entry = {
      version: 3,
      name: 'import-ledger',
      up: readFileSync(new URL('0003-import-ledger.up.sql', directory), 'utf8'),
      down: readFileSync(
        new URL('0003-import-ledger.down.sql', directory),
        'utf8',
      ),
      destructive: false,
    };
  return Object.freeze([
    ...(await postgresCatalog()),
    Object.freeze({
      ...entry,
      checksum: await sha256(migrationContent(entry)),
    }),
  ]);
}
