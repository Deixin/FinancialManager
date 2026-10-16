import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  ContractError,
  createV1Client,
  parseCreateTransactionInput,
} from '../../packages/contracts/dist/index.js';
import * as validators from '../../packages/contracts/dist/generated/validators.js';
import { renderContracts } from './generate-contracts.mjs';
import {
  ids,
  syntheticAccount,
  syntheticBody,
  syntheticTransaction,
  syntheticBalance,
  createInput,
  jsonResponse,
  accountPage,
  transactionPage,
  errorBody,
} from '../contracts/fixtures.mjs';

const listInput = { path: { workspaceId: ids.workspace } };
test('generated API input parser returns a validated snapshot without coercion or raw error payloads', () => {
  const original = createInput();
  const parsed = parseCreateTransactionInput(original);
  assert.equal(parsed.body.amountMinor, '9223372036854775807');
  original.body.amountMinor = '1';
  assert.equal(parsed.body.amountMinor, '9223372036854775807');
  assert.throws(
    () =>
      parseCreateTransactionInput(
        createInput({ body: { ...syntheticBody, amountMinor: 1 } }),
      ),
    code('INVALID_REQUEST'),
  );
});
function setup(response = jsonResponse(accountPage()), options = {}) {
  const calls = [];
  const client = createV1Client({
    profile: 'NATIVE',
    baseUrl: 'https://synthetic.invalid',
    getAccessToken: () => 'synthetic.access.token',
    transport: async (request) => {
      calls.push(request);
      return typeof response === 'function' ? response(request) : response;
    },
    ...options,
  });
  return { client, calls };
}
function code(expected) {
  return (error) =>
    error instanceof ContractError &&
    error.code === expected &&
    error.message === expected;
}

test('generated monetary validators preserve both i64 limits and reject JSON numbers', () => {
  for (const value of [
    '0',
    '9007199254740993',
    '9223372036854775807',
    '-9223372036854775808',
  ])
    assert.equal(validators.validateMoneyMinor(value), true);
  for (const value of [
    0,
    9007199254740992,
    1.01,
    1n,
    '-0',
    '01',
    '+1',
    '1.0',
    '1e3',
    '9223372036854775808',
    '-9223372036854775809',
  ])
    assert.equal(validators.validateMoneyMinor(value), false);
  assert.equal(validators.validateVersion('9223372036854775807'), true);
  for (const value of ['0', '-1', '01', 1, '9223372036854775808'])
    assert.equal(validators.validateVersion(value), false);
});

test('generated UUID, calendar date and UTC millisecond formats reject lossy alternatives', () => {
  assert.equal(validators.validateUuid(ids.workspace), true);
  for (const value of [
    'A0000000-0000-7000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'invalid',
  ]) {
    assert.equal(validators.validateUuid(value), false);
  }
  assert.equal(validators.validateFinancialDate('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-09-30T00:00:00Z'])
    assert.equal(validators.validateFinancialDate(value), false);
  assert.equal(validators.validateUtcInstant('2026-10-16T12:00:00.123Z'), true);
  for (const value of [
    '2026-10-16T12:00:00Z',
    '2026-10-16T12:00:00.123+00:00',
    '2026-02-29T00:00:00.000Z',
    '2026-10-16T24:00:00.000Z',
  ])
    assert.equal(validators.validateUtcInstant(value), false);
});

test('SDK uses generated routes, bounded cursor query and request no-store policy', async () => {
  const { client, calls } = setup();
  const result = await client.listAccounts({
    ...listInput,
    query: { after: 'synthetic_page-2', limit: 2 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].version, '9007199254740993');
  assert.equal(
    calls[0].url,
    `https://synthetic.invalid/v1/workspaces/${ids.workspace}/accounts?after=synthetic_page-2&limit=2`,
  );
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers.Authorization, 'Bearer synthetic.access.token');
});

test('SDK serializes monetary values and explicit idempotency keys without Number conversion', async () => {
  const { client, calls } = setup(
    jsonResponse({ requestId: ids.request, data: syntheticTransaction }, 201),
  );
  const result = await client.createTransaction(createInput());
  assert.equal(result.ok, true);
  assert.equal(result.data.data.amountMinor, '9223372036854775807');
  assert.equal(result.data.data.version, '9223372036854775807');
  assert.equal(calls[0].headers['Idempotency-Key'], ids.key);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(calls[0].body).amountMinor, '9223372036854775807');
});

test('invalid requests fail before credentials or HTTP and cannot smuggle body workspace or auth headers', async () => {
  let credentials = 0;
  const { client, calls } = setup(undefined, {
    getAccessToken: () => {
      credentials++;
      return 'synthetic';
    },
  });
  const invalid = [
    createInput({ headers: {} }),
    createInput({
      headers: {
        'Idempotency-Key': ids.key,
        Authorization: 'synthetic-injected',
      },
    }),
    createInput({ body: { ...syntheticBody, amountMinor: 100 } }),
    createInput({
      body: { ...syntheticBody, amountMinor: '9223372036854775808' },
    }),
    createInput({ body: { ...syntheticBody, financialDate: '2026-02-29' } }),
    createInput({ body: { ...syntheticBody, currencyCode: 'USD' } }),
    createInput({
      body: { ...syntheticBody, workspaceId: ids.otherWorkspace },
    }),
    createInput({ body: { ...syntheticBody, economicKind: 'TRANSFER' } }),
    createInput({
      body: { ...syntheticBody, economicKind: 'DEBT_SETTLEMENT' },
    }),
    createInput({ path: { workspaceId: '../synthetic' } }),
  ];
  for (const input of invalid)
    await assert.rejects(
      client.createTransaction(input),
      code('INVALID_REQUEST'),
    );
  assert.equal(calls.length, 0);
  assert.equal(credentials, 0);
});

test('query validation rejects offsets, oversized cursors, bad limits and reversed periods', async () => {
  const { client, calls } = setup();
  for (const query of [
    { offset: 10 },
    { after: 'a'.repeat(513) },
    { limit: 0 },
    { limit: 101 },
    { limit: '10' },
    { limit: 1.5 },
    { from: '2026-10-01', to: '2026-09-01' },
  ])
    await assert.rejects(
      client.listTransactions({ ...listInput, query }),
      code('INVALID_REQUEST'),
    );
  assert.equal(calls.length, 0);
});

test('HTTPS and same-origin configuration prevent credentials being sent to unintended origins', () => {
  for (const baseUrl of [
    'http://synthetic.invalid',
    'https://user:secret@synthetic.invalid',
    'https://synthetic.invalid/?token=synthetic',
    'https://synthetic.invalid/#fragment',
    'http://127.0.0.1:1',
  ])
    assert.throws(
      () => setup(undefined, { baseUrl }),
      code('INVALID_CONFIGURATION'),
    );
  assert.throws(
    () =>
      setup(undefined, {
        profile: 'WEB',
        webOrigin: 'https://other.invalid',
        getCsrfToken: () => 'synthetic',
      }),
    code('INVALID_CONFIGURATION'),
  );
  assert.throws(
    () =>
      setup(undefined, {
        profile: 'WEB',
        webOrigin: 'https://synthetic.invalid/path',
        getCsrfToken: () => 'synthetic',
      }),
    code('INVALID_CONFIGURATION'),
  );
});

test('Web BFF profile uses same-origin cookie and CSRF without browser bearer tokens', async () => {
  let csrfReads = 0;
  const { client, calls } = setup(
    jsonResponse({ requestId: ids.request, data: syntheticTransaction }, 201),
    {
      profile: 'WEB',
      webOrigin: 'https://synthetic.invalid',
      getCsrfToken: () => {
        csrfReads++;
        return 'synthetic-csrf';
      },
    },
  );
  await client.createTransaction(createInput());
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].headers['X-CSRF-Token'], 'synthetic-csrf');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(csrfReads, 1);
  const { client: reader } = setup(undefined, {
    profile: 'WEB',
    webOrigin: 'https://synthetic.invalid',
    getCsrfToken: () => {
      throw new Error('not needed');
    },
  });
  assert.equal((await reader.listAccounts(listInput)).ok, true);
});

test('missing or malformed session credentials fail closed without raw secret errors', async () => {
  for (const token of ['', 'synthetic\r\nInjected: value', null]) {
    const { client, calls } = setup(undefined, { getAccessToken: () => token });
    await assert.rejects(
      client.listAccounts(listInput),
      code('AUTHENTICATION_REQUIRED'),
    );
    assert.equal(calls.length, 0);
  }
  const { client, calls } = setup(undefined, {
    profile: 'WEB',
    webOrigin: 'https://synthetic.invalid',
    getCsrfToken: () => '',
  });
  await assert.rejects(
    client.createTransaction(createInput()),
    code('CSRF_REQUIRED'),
  );
  assert.equal(calls.length, 0);
});

test('native credentials are obtained per request and do not persist in client globals', async () => {
  let token = 'synthetic-first';
  const { client, calls } = setup(undefined, { getAccessToken: () => token });
  await client.listAccounts(listInput);
  token = 'synthetic-second';
  await client.listAccounts(listInput);
  assert.deepEqual(
    calls.map((call) => call.headers.Authorization),
    ['Bearer synthetic-first', 'Bearer synthetic-second'],
  );
});

test('requests are snapshotted before awaiting credentials and config destination is captured', async () => {
  let release;
  const pendingToken = new Promise((resolve) => {
    release = resolve;
  });
  const config = {
    profile: 'NATIVE',
    baseUrl: 'https://synthetic.invalid',
    getAccessToken: () => pendingToken,
    transport: async (request) => {
      assert.equal(
        JSON.parse(request.body).amountMinor,
        syntheticBody.amountMinor,
      );
      return jsonResponse(
        { requestId: ids.request, data: syntheticTransaction },
        201,
      );
    },
  };
  const client = createV1Client(config);
  const input = createInput();
  const pending = client.createTransaction(input);
  input.body.amountMinor = '1';
  input.path.workspaceId = ids.otherWorkspace;
  config.baseUrl = 'https://other.invalid';
  release('synthetic-token');
  assert.equal((await pending).ok, true);
});

test('runtime validates financial responses instead of trusting generated TypeScript alone', async () => {
  const invalid = [
    transactionPage({
      items: [{ ...syntheticTransaction, amountMinor: 9007199254740992 }],
    }),
    transactionPage({
      items: [{ ...syntheticTransaction, amountMinor: '9223372036854775808' }],
    }),
    transactionPage({ items: [{ ...syntheticTransaction, version: 1 }] }),
    transactionPage({
      items: [
        { ...syntheticTransaction, updatedAt: '2026-02-29T00:00:00.000Z' },
      ],
    }),
    transactionPage({ requestId: null }),
    transactionPage({ nextCursor: '' }),
    transactionPage({ items: Array(101).fill(syntheticTransaction) }),
  ];
  for (const body of invalid)
    await assert.rejects(
      setup(jsonResponse(body)).client.listTransactions(listInput),
      code('INVALID_RESPONSE'),
    );
});

test('response validation refuses cross-workspace and cross-account financial records', async () => {
  const cross = accountPage({
    items: [{ ...syntheticAccount, workspaceId: ids.otherWorkspace }],
  });
  await assert.rejects(
    setup(jsonResponse(cross)).client.listAccounts(listInput),
    code('SCOPE_MISMATCH'),
  );
  const input = {
    path: { workspaceId: ids.workspace, accountId: ids.account },
    query: { asOf: '2026-09-30' },
  };
  const body = {
    requestId: ids.request,
    data: { ...syntheticBalance, accountId: ids.otherAccount },
  };
  await assert.rejects(
    setup(jsonResponse(body)).client.getAccountBalance(input),
    code('SCOPE_MISMATCH'),
  );
  await assert.rejects(
    setup(jsonResponse(transactionPage())).client.listTransactions({
      ...listInput,
      query: { accountId: ids.otherAccount },
    }),
    code('SCOPE_MISMATCH'),
  );
});

test('balance response preserves incomplete history and rejects inconsistent date or completeness', async () => {
  const input = {
    path: { workspaceId: ids.workspace, accountId: ids.account },
    query: { asOf: '2026-09-30' },
  };
  const result = await setup(
    jsonResponse({ requestId: ids.request, data: syntheticBalance }),
  ).client.getAccountBalance(input);
  assert.equal(result.data.data.amountMinor, '-9223372036854775808');
  assert.deepEqual(result.data.data.warnings, ['MISSING_REFERENCE']);
  for (const balance of [
    { ...syntheticBalance, asOf: '2026-09-29' },
    { ...syntheticBalance, completeness: 'COMPLETE' },
  ])
    await assert.rejects(
      setup(
        jsonResponse({ requestId: ids.request, data: balance }),
      ).client.getAccountBalance(input),
      code('INVALID_RESPONSE'),
    );
});

test('page results respect requested limits and periods and allow additive response fields', async () => {
  const future = transactionPage({
    items: [{ ...syntheticTransaction, financialDate: '2026-10-01' }],
  });
  await assert.rejects(
    setup(jsonResponse(future)).client.listTransactions({
      ...listInput,
      query: { to: '2026-09-30' },
    }),
    code('INVALID_RESPONSE'),
  );
  await assert.rejects(
    setup(
      jsonResponse(
        accountPage({ items: [syntheticAccount, syntheticAccount] }),
      ),
    ).client.listAccounts({ ...listInput, query: { limit: 1 } }),
    code('INVALID_RESPONSE'),
  );
  const result = await setup(
    jsonResponse(accountPage({ futureOptionalMetadata: true })),
  ).client.listAccounts(listInput);
  assert.equal(result.ok, true);
  assert.equal(result.data.futureOptionalMetadata, true);
});

test('created movement response cannot silently change the submitted value, ID or group', async () => {
  for (const entity of [
    { ...syntheticTransaction, amountMinor: '1' },
    { ...syntheticTransaction, id: ids.otherAccount },
    { ...syntheticTransaction, groupId: ids.key },
    { ...syntheticTransaction, deletedAt: '2026-10-16T12:00:00.000Z' },
  ])
    await assert.rejects(
      setup(
        jsonResponse({ requestId: ids.request, data: entity }, 201),
      ).client.createTransaction(createInput()),
      code('INVALID_RESPONSE'),
    );
});

test('safe errors distinguish authorization and idempotency conflicts without echoing server internals', async () => {
  for (const [status, errorCode] of [
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [409, 'IDEMPOTENCY_CONFLICT'],
    [500, 'INTERNAL_ERROR'],
  ]) {
    const result = await setup(
      jsonResponse(
        errorBody(errorCode, { message: 'synthetic SQL secret sentinel' }),
        status,
      ),
    ).client.listAccounts(listInput);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, errorCode);
    assert.equal(result.error.requestId, ids.request);
    assert.ok(
      !JSON.stringify(result).includes('synthetic SQL secret sentinel'),
    );
  }
  const hostile = errorBody('INTERNAL_ERROR', {
    details: { sql: 'synthetic sentinel' },
  });
  await assert.rejects(
    setup(jsonResponse(hostile, 500)).client.listAccounts(listInput),
    code('INVALID_RESPONSE'),
  );
});

test('malformed content, missing no-store, oversized bodies and unexpected success codes fail safely', async () => {
  for (const response of [
    jsonResponse(accountPage(), 200, { body: '<html>synthetic</html>' }),
    jsonResponse(accountPage(), 200, { contentType: 'text/html' }),
    jsonResponse(accountPage(), 200, { cacheControl: 'public, max-age=3600' }),
    jsonResponse(accountPage(), 200, { body: 'a'.repeat(1048577) }),
    jsonResponse(accountPage(), 204),
    jsonResponse(errorBody(), 302),
  ])
    await assert.rejects(
      setup(response).client.listAccounts(listInput),
      code('INVALID_RESPONSE'),
    );
});

test('transport failures are sanitized and critical mutations are never automatically retried', async () => {
  const { client, calls } = setup(() => {
    throw new Error('synthetic-token-and-financial-sentinel');
  });
  await assert.rejects(
    client.createTransaction(createInput()),
    (error) =>
      code('TRANSPORT_ERROR')(error) &&
      !JSON.stringify(error).includes('sentinel'),
  );
  assert.equal(calls.length, 1);
});

test('generation is reproducible, follows OpenAPI changes and refuses external references', async () => {
  const schema = JSON.parse(
    await readFile(
      new URL('../../packages/contracts/openapi/v1.json', import.meta.url),
      'utf8',
    ),
  );
  const original = await renderContracts(schema);
  for (const [name, content] of Object.entries(original))
    assert.equal(
      content,
      await readFile(
        new URL(
          `../../packages/contracts/src/generated/${name}`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
  schema.paths['/v1/workspaces/{workspaceId}/accounts'].get.operationId =
    'readAccounts';
  const changed = await renderContracts(schema);
  assert.ok(changed['sdk.ts'].includes('readAccounts:'));
  assert.ok(!changed['sdk.ts'].includes('listAccounts:'));
  schema.components.schemas.MoneyMinor = {
    $ref: 'https://synthetic.invalid/untrusted-schema.json',
  };
  await assert.rejects(
    renderContracts(schema),
    /External contract reference refused/,
  );
});
