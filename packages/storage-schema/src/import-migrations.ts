import { sqliteCatalog } from './generated-migrations.js';
import { importLedgerMigration } from './generated-import-migration.js';
import type { Migration } from './migration-plan.js';
// Deliberate rollout boundary: the active Desktop catalog stays at v2 until
// native backup/restore and the import host adopt this ledger together.
export const sqliteImportCatalog: readonly Migration[] = Object.freeze([
  ...sqliteCatalog,
  importLedgerMigration,
]);
