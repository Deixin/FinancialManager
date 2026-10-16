import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  createFetchTransport,
  ContractError,
  parseCreateTransactionInput,
} from '../../packages/contracts/dist/index.js';
import { createWebApiClient } from '../../apps/web/dist/index.js';
import { createDesktopCloudClient } from '../../apps/desktop/dist/index.js';
import { createMobileApiClient } from '../../apps/mobile/dist/index.js';
import {
  ids,
  syntheticTransaction,
  syntheticBalance,
  accountPage,
  transactionPage,
  createInput,
  errorBody,
} from '../contracts/fixtures.mjs';

// A synthetic HTTP contract peer, not a product API, auth server or database.
test(
  'compiled Web, Desktop and Mobile clients share the contract over real loopback HTTP',
  { timeout: 15000 },
  async (t) => {
    const received = [];
    let followedRedirect = false;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/redirect/')) {
        response.writeHead(302, { Location: '/must-not-be-reached' });
        response.end();
        return;
      }
      if (url.pathname === '/must-not-be-reached') followedRedirect = true;
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('utf8');
        const body = text ? JSON.parse(text) : null;
        received.push({
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers: request.headers,
          method: request.method,
          body,
        });
        let payload,
          status = 200;
        if (request.method === 'POST') {
          parseCreateTransactionInput({
            path: { workspaceId: ids.workspace },
            headers: { 'Idempotency-Key': request.headers['idempotency-key'] },
            body,
          });
          assert.equal(request.headers['idempotency-key'], ids.key);
          assert.equal(typeof body.amountMinor, 'string');
          payload = {
            requestId: ids.request,
            data: { ...syntheticTransaction, ...body },
          };
          status = 201;
        } else if (url.searchParams.get('after') === 'synthetic-denied') {
          payload = errorBody();
          status = 403;
        } else if (url.pathname.endsWith('/balance')) {
          assert.equal(url.searchParams.get('asOf'), syntheticBalance.asOf);
          payload = { requestId: ids.request, data: syntheticBalance };
        } else if (url.pathname.endsWith('/transactions')) {
          payload = transactionPage();
        } else {
          payload = accountPage({ nextCursor: 'synthetic_next-page' });
        }
        response.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        });
        response.end(JSON.stringify(payload));
      } catch {
        response.writeHead(500, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(errorBody('INTERNAL_ERROR')));
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(
      () =>
        new Promise((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const transport = createFetchTransport(globalThis.fetch);
    const common = { baseUrl, transport, allowInsecureLoopback: true };
    const factories = [
      [
        'Web',
        () =>
          createWebApiClient({
            ...common,
            webOrigin: baseUrl,
            getCsrfToken: () => 'synthetic-csrf',
          }),
      ],
      [
        'Desktop',
        () =>
          createDesktopCloudClient({
            ...common,
            getAccessToken: () => 'synthetic-desktop-token',
          }),
      ],
      [
        'Mobile',
        () =>
          createMobileApiClient({
            ...common,
            getAccessToken: () => 'synthetic-mobile-token',
          }),
      ],
    ];
    for (const [platform, factory] of factories) {
      await t.test(platform, async () => {
        const client = factory();
        const listed = await client.listAccounts({
          path: { workspaceId: ids.workspace },
          query: { limit: 1 },
        });
        assert.equal(listed.ok, true);
        assert.equal(listed.data.nextCursor, 'synthetic_next-page');
        const next = await client.listTransactions({
          path: { workspaceId: ids.workspace },
          query: {
            after: listed.data.nextCursor,
            accountId: ids.account,
            limit: 1,
          },
        });
        assert.equal(next.ok, true);
        assert.equal(next.data.items[0].amountMinor, '9223372036854775807');
        const balance = await client.getAccountBalance({
          path: { workspaceId: ids.workspace, accountId: ids.account },
          query: { asOf: '2026-09-30' },
        });
        assert.equal(balance.ok, true);
        assert.equal(balance.data.data.amountMinor, '-9223372036854775808');
        for (const amountMinor of [
          '9223372036854775807',
          '-9223372036854775808',
          '9007199254740993',
        ]) {
          const input = createInput();
          input.body.amountMinor = amountMinor;
          input.body.economicKind = amountMinor.startsWith('-')
            ? 'EXPENSE'
            : 'INCOME';
          const result = await client.createTransaction(input);
          assert.equal(result.ok, true);
          assert.equal(result.data.data.amountMinor, amountMinor);
        }
        const denied = await client.listAccounts({
          path: { workspaceId: ids.workspace },
          query: { after: 'synthetic-denied' },
        });
        assert.equal(denied.ok, false);
        assert.equal(denied.status, 403);
        assert.equal(denied.error.code, 'FORBIDDEN');
        const post = received.at(-2);
        assert.equal(post.path, `/v1/workspaces/${ids.workspace}/transactions`);
        assert.equal(post.headers['content-type'], 'application/json');
        if (platform === 'Web') {
          assert.equal(post.headers.authorization, undefined);
          assert.equal(post.headers['x-csrf-token'], 'synthetic-csrf');
        } else {
          assert.ok(post.headers.authorization.startsWith('Bearer synthetic-'));
          assert.equal(post.headers['x-csrf-token'], undefined);
        }
      });
    }
    await t.test(
      'HTTP redirects do not forward the session credential',
      async () => {
        const client = createDesktopCloudClient({
          ...common,
          baseUrl: baseUrl + '/redirect',
          getAccessToken: () => 'synthetic-desktop-token',
        });
        await assert.rejects(
          client.listAccounts({ path: { workspaceId: ids.workspace } }),
          (error) =>
            error instanceof ContractError && error.code === 'TRANSPORT_ERROR',
        );
        assert.equal(followedRedirect, false);
      },
    );
  },
);
