import type { ImportBatch, ImportCounts, ImportQuery } from '../src/imports.js';
declare const batch: ImportBatch;
declare const counts: ImportCounts;
declare const query: ImportQuery;
// @ts-expect-error snapshots are immutable
batch.status = 'FAILED';
// @ts-expect-error exact counts are decimal strings
const invalidCount: ImportCounts['total_items'] = 12;
// @ts-expect-error counters cannot be modified through a result
counts.items.NEW = '2';
// @ts-expect-error captured queries cannot change after authorization
query.statuses.push('REVIEW');
void invalidCount;
