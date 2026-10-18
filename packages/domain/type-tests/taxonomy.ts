import type { Tag, Subcategory, TaxonomyCommand } from '../src/taxonomy.js';
declare const tag: Tag;
declare const subcategory: Subcategory;
const commands: readonly TaxonomyCommand[] = [
  { kind: 'CREATE', item: tag },
  { kind: 'UPDATE', base: subcategory, item: subcategory },
  {
    kind: 'REORDER_SUBCATEGORIES',
    category_id: subcategory.category_id,
    bases: [subcategory],
    ids: [subcategory.id],
  },
];
void commands;
// @ts-expect-error Tags have no monetary allocation or ordering field.
void tag.sort_order;
// @ts-expect-error Subcategories always require a category.
const missingParent: Subcategory = {
  kind: 'SUBCATEGORY',
  id: 'synthetic',
  workspace_id: 'synthetic',
  name: 'synthetic',
  status: 'ACTIVE',
  sort_order: 0,
};
void missingParent;
// @ts-expect-error Catalog commands cannot delete a used label.
const deletion: TaxonomyCommand = { kind: 'DELETE', id: tag.id };
void deletion;
