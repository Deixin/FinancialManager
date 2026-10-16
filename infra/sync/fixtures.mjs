// SYNTHETIC ONLY: deterministic IDs and invented records; never customer data.
export const id = (number) =>
  '00000000-0000-4000-8000-' + number.toString(16).padStart(12, '0');
export const f = Object.freeze({
  workspace: id(1),
  otherWorkspace: id(2),
  generation: id(3),
  nextGeneration: id(4),
  userA: id(5),
  userB: id(6),
  reader: id(7),
  outsider: id(8),
  deviceA: id(9),
  deviceB: id(10),
  readerDevice: id(11),
  outsiderDevice: id(12),
  account: id(13),
  hiddenAccount: id(14),
  entity: id(15),
});
export const syntheticRecord = Object.freeze({
  amount_minor: '9007199254740993',
  description: 'SYNTHETIC US-005',
  date: '2026-10-15',
});
export function operation(
  number,
  patch,
  {
    entity = f.entity,
    base = '1',
    account = f.account,
    generation = f.generation,
    workspace = f.workspace,
    deleted = false,
    resolves,
    timestamp = '2026-10-15T12:00:00Z',
  } = {},
) {
  return {
    operation_id: id(number),
    workspace_id: workspace,
    generation,
    entity_id: entity,
    account_id: account,
    base_revision: base,
    operation: deleted ? 'DELETE' : 'UPSERT',
    patch,
    changed_fields: deleted ? ['$deleted'] : Object.keys(patch).sort(),
    client_timestamp: timestamp,
    ...(resolves === undefined ? {} : { resolves }),
  };
}
