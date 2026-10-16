// Synthetic privacy canaries only. These are not real identity/financial records.
export const sensitive = Object.freeze({
  amount: '9123456789000345',
  transaction_description: 'SYNTHETIC_DESCRIPTION_DONT_LOG',
  document_item_name: 'SYNTHETIC_ITEM_DONT_LOG',
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0000-00',
  email: 'synthetic-private@example.invalid',
  filename: 'SYNTHETIC_PRIVATE_document.pdf',
  document: '<synthetic>PRIVATE_DOCUMENT_DONT_LOG</synthetic>',
  token: 'SYNTHETIC_TOKEN_DONT_LOG',
  cookie: 'session=SYNTHETIC_COOKIE_DONT_LOG',
  sql: 'select SYNTHETIC_PRIVATE_SQL_DONT_LOG',
});
export const workspaceId = '12345678-1234-4234-8234-123456789abc';
export const sensitiveError = () =>
  Object.assign(new Error(sensitive.document), {
    ...sensitive,
    stack: 'SYNTHETIC_PRIVATE_STACK_DONT_LOG',
    cause: new Error(sensitive.token),
  });

export function assertNoSensitive(assert, text) {
  for (const canary of [
    ...Object.values(sensitive),
    'SYNTHETIC_PRIVATE_STACK_DONT_LOG',
  ])
    assert.equal(
      text.includes(canary),
      false,
      'A synthetic privacy canary reached telemetry',
    );
}
