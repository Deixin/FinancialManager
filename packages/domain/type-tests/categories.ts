import type { CategoryCommand, Category } from '../src/categories.js';
declare const row: Category;
declare const command: Extract<CategoryCommand, { kind: 'REORDER' }>;
// @ts-expect-error category snapshots are immutable
row.name = 'changed';
// @ts-expect-error complete base arrays are immutable
command.bases.push(row);
// @ts-expect-error ordered ids are immutable
command.ids.push('id');
const invalid: CategoryCommand = {
  kind: 'UPDATE',
  base: row,
  name: row.name,
  status: row.status,
  sort_order: 0,
  // @ts-expect-error scope edits require a separate policy
  category_scope: 'BOTH',
};
void invalid;
