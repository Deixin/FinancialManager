// US-012: entirely synthetic IDs, names, tokens and financial values.
export const ids = Object.freeze({
  workspace: '00000000-0000-7000-8000-000000000001',
  otherWorkspace: '00000000-0000-7000-8000-000000000002',
  account: '00000000-0000-7000-8000-000000000003',
  transaction: '00000000-0000-7000-8000-000000000004',
  request: '00000000-0000-7000-8000-000000000005',
  key: '00000000-0000-7000-8000-000000000006',
  otherAccount: '00000000-0000-7000-8000-000000000007',
});
export const syntheticAccount = Object.freeze({
  id: ids.account,
  workspaceId: ids.workspace,
  name: 'CONTA FICTÍCIA US-012',
  accountKind: 'CHECKING',
  balanceNature: 'ASSET',
  currencyCode: 'BRL',
  status: 'ACTIVE',
  version: '9007199254740993',
  updatedAt: '2026-10-16T12:00:00.000Z',
});
export const syntheticBody = Object.freeze({
  id: ids.transaction,
  accountId: ids.account,
  financialDate: '2026-09-02',
  amountMinor: '9223372036854775807',
  currencyCode: 'BRL',
  economicKind: 'INCOME',
  displayName: 'RECEITA FICTÍCIA US-012',
});
export const syntheticTransaction = Object.freeze({
  ...syntheticBody,
  workspaceId: ids.workspace,
  groupId: null,
  version: '9223372036854775807',
  updatedAt: '2026-10-16T12:00:00.000Z',
  deletedAt: null,
});
export const syntheticBalance = Object.freeze({
  workspaceId: ids.workspace,
  accountId: ids.account,
  currencyCode: 'BRL',
  balanceNature: 'ASSET',
  asOf: '2026-09-30',
  amountMinor: '-9223372036854775808',
  completeness: 'INCOMPLETE',
  warnings: ['MISSING_REFERENCE'],
});
export function createInput(overrides = {}) {
  return {
    path: { workspaceId: ids.workspace },
    headers: { 'Idempotency-Key': ids.key },
    body: { ...syntheticBody },
    ...overrides,
  };
}
export function jsonResponse(value, status = 200, overrides = {}) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'private, no-store',
    body: JSON.stringify(value),
    ...overrides,
  };
}
export function accountPage(overrides = {}) {
  return {
    requestId: ids.request,
    items: [syntheticAccount],
    nextCursor: null,
    ...overrides,
  };
}
export function transactionPage(overrides = {}) {
  return {
    requestId: ids.request,
    items: [syntheticTransaction],
    nextCursor: null,
    ...overrides,
  };
}
export function errorBody(code = 'FORBIDDEN', overrides = {}) {
  return {
    code,
    message: 'ERRO FICTÍCIO US-012',
    requestId: ids.request,
    ...overrides,
  };
}
