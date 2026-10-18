import type { AllocationCommand } from '../src/classification.js';
declare const command: AllocationCommand;
const money: AllocationCommand = {
  ...command,
  // @ts-expect-error Allocation edits preserve the financial amount.
  account_amount_minor: '1',
};
const tags: AllocationCommand = {
  ...command,
  // @ts-expect-error Tag edits use the separate classification intention.
  tag_ids: [],
};
void money;
void tags;
