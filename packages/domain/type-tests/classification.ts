import type {
  ClassificationCommand,
  ClassificationFilter,
} from '../src/classification.js';
declare const command: ClassificationCommand;
const money: ClassificationCommand = {
  ...command,
  // @ts-expect-error Classification never accepts a replacement financial amount.
  account_amount_minor: '100',
};
void money;
const split: ClassificationCommand = {
  ...command,
  // @ts-expect-error Splitting amounts belongs to US-046.
  classification: { kind: 'SPLIT', allocations: [] },
};
void split;
// @ts-expect-error Tag matching is explicit.
const filter: ClassificationFilter = {
  category_id: null,
  subcategory_id: null,
  tag_ids: [],
  unclassified_only: false,
};
void filter;
