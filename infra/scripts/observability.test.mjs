import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createObservability } from '../../packages/observability/dist/index.js';
import { createApiObservability } from '../../apps/api/dist/index.js';
import {
  sensitive,
  sensitiveError,
  workspaceId,
  assertNoSensitive,
} from '../observability/sensitive-fixture.mjs';

const externalCarrier = Object.freeze({
  traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
  'x-request-id': '87654321-1234-4234-8234-123456789abc',
  baggage: sensitive.token,
  tracestate: sensitive.email,
});
function setup(t, options = {}) {
  const lines = [];
  const telemetry = createObservability({
    service: 'api',
    environment: 'ci',
    mode: 'operational',
    sink: (line) => {
      lines.push(line);
    },
    ...options,
  });
  t.after(() => telemetry.shutdown());
  return {
    telemetry,
    lines,
    records: () => lines.map((line) => JSON.parse(line)),
  };
}
const validCorrelation = (value) => {
  assert.match(
    value.request_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.match(value.trace_id, /^[0-9a-f]{32}$/);
  assert.match(value.span_id, /^[0-9a-f]{16}$/);
  assert.notEqual(value.trace_id, '0'.repeat(32));
  assert.notEqual(value.span_id, '0'.repeat(16));
};

test('telemetry is silent by default while correlation works, even with a configured sink', async (t) => {
  const { telemetry, lines } = setup(t, { mode: undefined });
  await telemetry.run('job.import', async (scope) => {
    validCorrelation(scope.correlation);
    assert.equal(scope.carrier().traceparent.endsWith('-00'), true);
    scope.log('retry.scheduled', sensitive);
    scope.captureError(sensitiveError());
    await telemetry.run('sync.batch', (child) => {
      assert.equal(child.correlation.trace_id, scope.correlation.trace_id);
    });
  });
  await telemetry.flush();
  assert.deepEqual(lines, []);
});

test('configuration and operation names fail with fixed codes and never echo input', async (t) => {
  for (const config of [
    { service: sensitive.email },
    { environment: sensitive.token },
    { mode: 'operational', sink: undefined },
    { mode: sensitive.document },
  ])
    assert.throws(
      () =>
        createObservability({ service: 'api', environment: 'ci', ...config }),
      { message: 'OBSERVABILITY_CONFIG_INVALID' },
    );
  const { telemetry, lines } = setup(t);
  for (const operation of [
    sensitive.document,
    'constructor',
    '__proto__',
    null,
  ])
    await assert.rejects(
      telemetry.run(operation, () => {}),
      { message: 'OBSERVABILITY_OPERATION_INVALID' },
    );
  assert.deepEqual(lines, []);
});

test('logs and SDK spans keep only typed allowlisted metadata and static route templates', async (t) => {
  const { telemetry, lines, records } = setup(t);
  const metadata = {
    ...sensitive,
    workspace_id: workspaceId,
    status_code: 201,
    entity_type: 'transaction',
    parser_version: '1.2.3',
    request_id: sensitive.token,
    trace_id: sensitive.email,
    route_template: `/transactions/${sensitive.transaction_description}`,
    duration_ms: sensitive.amount,
    message: sensitive.document,
    nested: sensitive,
  };
  await telemetry.run(
    'http.transactions.create',
    (scope) => {
      scope.log('retry.scheduled', metadata);
      scope.log(sensitive.document, metadata);
    },
    { metadata },
  );
  await telemetry.flush();
  const output = records();
  assert.equal(output.filter((entry) => entry.signal === 'span').length, 1);
  assert.equal(output.filter((entry) => entry.signal === 'log').length, 3);
  for (const entry of output) {
    validCorrelation(entry);
    assert.equal(entry.workspace_id, workspaceId);
    assert.equal(entry.status_code, 201);
    assert.equal(entry.entity_type, 'transaction');
    assert.equal(entry.parser_version, '1.2.3');
    assert.equal(
      entry.route_template,
      '/v1/workspaces/{workspaceId}/transactions',
    );
    assert.equal(entry.operation, 'http.transactions.create');
    assert.equal(Object.hasOwn(entry, 'nested'), false);
    assert.ok(JSON.stringify(entry).length < 4096);
  }
  assertNoSensitive(assert, lines.join('\n'));
});

test('invalid values under allowed keys are dropped and accessors/toJSON are not executed', async (t) => {
  const { telemetry, records } = setup(t);
  let executions = 0;
  const metadata = {
    workspace_id: sensitive.email,
    status_code: NaN,
    entity_type: sensitive.document,
    parser_version: sensitive.token,
    toJSON() {
      executions++;
      throw new Error(sensitive.token);
    },
    get amount() {
      executions++;
      return sensitive.amount;
    },
  };
  Object.defineProperty(metadata, 'parser_version', {
    get() {
      executions++;
      throw new Error(sensitive.document);
    },
  });
  await telemetry.run(
    'job.import',
    (scope) => {
      scope.setMetadata(metadata);
      scope.log('retry.scheduled', metadata);
      scope.setMetadata(
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error(sensitive.token);
            },
          },
        ),
      );
    },
    { metadata },
  );
  for (const entry of records())
    for (const key of [
      'workspace_id',
      'status_code',
      'entity_type',
      'parser_version',
    ])
      assert.equal(Object.hasOwn(entry, key), false);
  assert.equal(executions, 0);
});

test('metadata is snapshotted and cannot replace correlation or leak later mutation', async (t) => {
  const { telemetry, records } = setup(t);
  const metadata = { workspace_id: workspaceId, parser_version: '1.0.0' };
  await telemetry.run(
    'job.import',
    async (scope) => {
      metadata.workspace_id = sensitive.email;
      metadata.parser_version = sensitive.document;
      scope.setMetadata({
        workspace_id: sensitive.email,
        parser_version: sensitive.document,
      });
      assert.equal(Object.isFrozen(scope.correlation), true);
      await Promise.resolve();
    },
    { metadata },
  );
  for (const entry of records()) {
    assert.equal(entry.workspace_id, workspaceId);
    assert.equal(entry.parser_version, '1.0.0');
  }
});

test('errors, causes, SQL, stack and arbitrary thrown values never reach either signal', async (t) => {
  const { telemetry, lines, records } = setup(t);
  for (const error of [sensitiveError(), sensitive, sensitive.token, null]) {
    await assert.rejects(
      telemetry.run('db.query', () => {
        throw error;
      }),
      (caught) => caught === error,
    );
  }
  const spans = records().filter((entry) => entry.signal === 'span');
  assert.equal(spans.length, 4);
  for (const span of spans) {
    assert.equal(span.status, 'error');
    assert.equal(span.error_code, 'INTERNAL_ERROR');
    assert.equal(Object.hasOwn(span, 'events'), false);
    assert.equal(Object.hasOwn(span, 'resource'), false);
    assert.equal(Object.hasOwn(span, 'message'), false);
  }
  assertNoSensitive(assert, lines.join('\n'));
  assert.equal(telemetry.current(), undefined);
});

test('captured error codes are closed and repeated completion does not append payloads', async (t) => {
  const { telemetry, lines, records } = setup(t);
  let escaped;
  await telemetry.run('job.import', (scope) => {
    escaped = scope;
    scope.captureError(sensitiveError(), 'DEPENDENCY_UNAVAILABLE');
  });
  escaped.captureError(sensitiveError(), sensitive.token);
  escaped.setMetadata(sensitive);
  escaped.log('retry.scheduled', sensitive);
  assert.equal(records().filter((entry) => entry.signal === 'span').length, 1);
  assert.equal(records().at(-1).error_code, 'DEPENDENCY_UNAVAILABLE');
  await telemetry.run('job.import', (scope) =>
    scope.captureError(sensitiveError(), sensitive.token),
  );
  assert.equal(records().at(-1).error_code, 'INTERNAL_ERROR');
  assertNoSensitive(assert, lines.join('\n'));
});

test('nested operations use distinct SDK spans and share correlation across awaits', async (t) => {
  const { telemetry, records } = setup(t);
  await telemetry.run('job.import', async (root) => {
    assert.equal(telemetry.current(), root.correlation);
    await telemetry.run('sync.batch', async (child) => {
      await setTimeout(2);
      assert.equal(telemetry.current(), child.correlation);
      assert.equal(child.correlation.trace_id, root.correlation.trace_id);
      assert.equal(child.correlation.request_id, root.correlation.request_id);
      assert.notEqual(child.correlation.span_id, root.correlation.span_id);
    });
    assert.equal(telemetry.current(), root.correlation);
  });
  const spans = records().filter((entry) => entry.signal === 'span');
  assert.equal(spans[0].parent_span_id, spans[1].span_id);
  assert.equal(telemetry.current(), undefined);
});

test('concurrent requests and failed handlers do not share tenant metadata or context', async (t) => {
  const { telemetry, records } = setup(t);
  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      telemetry.run('http.accounts.list', async (scope) => {
        const workspace = `${String(index).padStart(8, '0')}-1234-4234-8234-123456789abc`;
        scope.setMetadata({ workspace_id: workspace });
        await setTimeout(index % 3);
        assert.equal(telemetry.current(), scope.correlation);
        await telemetry.run('db.query', (child) =>
          assert.equal(
            child.correlation.request_id,
            scope.correlation.request_id,
          ),
        );
      }),
    ),
  );
  const requests = records().filter(
    (entry) =>
      entry.signal === 'span' && entry.operation === 'http.accounts.list',
  );
  assert.equal(new Set(requests.map((entry) => entry.request_id)).size, 32);
  assert.equal(new Set(requests.map((entry) => entry.trace_id)).size, 32);
  assert.equal(new Set(requests.map((entry) => entry.workspace_id)).size, 32);
  // Child DB spans receive no workspace implicitly: context is not authorization.
  for (const entry of records().filter(
    (entry) => entry.operation === 'db.query',
  ))
    assert.equal(Object.hasOwn(entry, 'workspace_id'), false);
  assert.equal(telemetry.current(), undefined);
});

test('external ingress restarts even syntactically valid trace and request IDs', async (t) => {
  const { telemetry, lines } = setup(t);
  await telemetry.run(
    'http.accounts.list',
    (scope) => {
      assert.notEqual(scope.correlation.trace_id, '1'.repeat(32));
      assert.notEqual(
        scope.correlation.request_id,
        externalCarrier['x-request-id'],
      );
    },
    { carrier: externalCarrier },
  );
  assertNoSensitive(assert, lines.join('\n'));
  await telemetry.run('job.import', async (outer) => {
    await telemetry.run(
      'http.accounts.list',
      (scope) => {
        assert.notEqual(scope.correlation.trace_id, outer.correlation.trace_id);
        assert.notEqual(
          scope.correlation.request_id,
          outer.correlation.request_id,
        );
      },
      { carrier: externalCarrier },
    );
  });
});

test('explicit internal trust propagates a strict traceparent and UUID, discarding baggage', async (t) => {
  const { telemetry, lines, records } = setup(t);
  await telemetry.run(
    'job.import',
    (scope) => {
      assert.equal(scope.correlation.trace_id, '1'.repeat(32));
      assert.equal(
        scope.correlation.request_id,
        externalCarrier['x-request-id'],
      );
      assert.notEqual(scope.correlation.span_id, '2'.repeat(16));
      assert.deepEqual(Object.keys(scope.carrier()).sort(), [
        'traceparent',
        'x-request-id',
      ]);
    },
    { carrier: externalCarrier, trust: 'internal' },
  );
  assert.equal(records().at(-1).parent_span_id, '2'.repeat(16));
  assertNoSensitive(assert, lines.join('\n'));
});

test('malformed, oversized, zero and unsupported-version carriers restart safely', async (t) => {
  const { telemetry } = setup(t);
  for (const traceparent of [
    null,
    [],
    sensitive.document,
    externalCarrier.traceparent.replace('1111', 'ABCD'),
    externalCarrier.traceparent + '\n',
    externalCarrier.traceparent + '-extra',
    externalCarrier.traceparent.replace('00-', 'ff-'),
    externalCarrier.traceparent.replace('00-', '01-'),
    `00-${'0'.repeat(32)}-${'2'.repeat(16)}-01`,
    `00-${'1'.repeat(32)}-${'0'.repeat(16)}-01`,
    externalCarrier.traceparent.replace(/-01$/, '-03'),
    'x'.repeat(100000),
  ]) {
    await telemetry.run(
      'job.import',
      (scope) => {
        validCorrelation(scope.correlation);
        assert.notEqual(scope.correlation.trace_id, '1'.repeat(32));
        assert.notEqual(
          scope.correlation.request_id,
          externalCarrier['x-request-id'],
        );
      },
      { trust: 'internal', carrier: { ...externalCarrier, traceparent } },
    );
  }
  await telemetry.run(
    'job.import',
    (scope) => {
      assert.equal(scope.correlation.trace_id, '1'.repeat(32));
      assert.notEqual(scope.correlation.request_id, sensitive.token);
    },
    {
      trust: 'internal',
      carrier: { ...externalCarrier, 'x-request-id': sensitive.token },
    },
  );
});

test('sink failures do not change business results, errors or cause recursive diagnostics', async (t) => {
  let calls = 0;
  const { telemetry } = setup(t, {
    sink: () => {
      calls++;
      throw sensitiveError();
    },
  });
  assert.equal(await telemetry.run('job.import', () => 42), 42);
  const businessError = sensitiveError();
  await assert.rejects(
    telemetry.run('job.import', () => {
      throw businessError;
    }),
    (error) => error === businessError,
  );
  await telemetry.flush();
  assert.equal(calls, 6);
  assert.deepEqual(telemetry.diagnostics(), {
    sink_failures: 6,
    dropped_records: 0,
  });
});

test('shutdown flushes completed spans and rejects new operations without emitting', async (t) => {
  const { telemetry, lines } = setup(t);
  await telemetry.run('job.import', () => {});
  await telemetry.shutdown();
  const count = lines.length;
  await telemetry.shutdown();
  await assert.rejects(
    telemetry.run('job.import', () => {}),
    { message: 'OBSERVABILITY_CLOSED' },
  );
  assert.equal(lines.length, count);
});

test('detached work after completion starts a new correlation instead of reviving the ended scope', async (t) => {
  const { telemetry, records } = setup(t);
  let completeDetached;
  const completed = new Promise((resolve, reject) => {
    completeDetached = { resolve, reject };
  });
  let original;
  await telemetry.run('job.import', (scope) => {
    original = scope.correlation;
    void setTimeout(5).then(async () => {
      try {
        assert.equal(telemetry.current(), undefined);
        await telemetry.run('sync.batch', (child) => {
          assert.notEqual(child.correlation.trace_id, original.trace_id);
          assert.notEqual(child.correlation.request_id, original.request_id);
        });
        completeDetached.resolve();
      } catch (error) {
        completeDetached.reject(error);
      }
    });
  });
  await completed;
  assert.equal(records().filter((entry) => entry.signal === 'span').length, 2);
});

test('a rejected asynchronous sink is contained without an unhandled rejection or payload log', async (t) => {
  const { telemetry } = setup(t, {
    sink: async () => {
      throw sensitiveError();
    },
  });
  assert.equal(await telemetry.run('job.import', () => 42), 42);
  await setTimeout(1);
  assert.equal(telemetry.diagnostics().sink_failures, 3);
});

async function workerProcess(carrier, t) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL('../observability/worker-peer.mjs', import.meta.url),
      ),
    ],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OTEL_SERVICE_NAME: sensitive.email,
        OTEL_RESOURCE_ATTRIBUTES: `secret=${sensitive.token}`,
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
      },
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  let stdout = '',
    stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(carrier));
  const [code] = await once(child, 'close');
  assert.equal(code, 0, 'Synthetic worker process failed');
  assert.equal(stderr, '');
  assertNoSensitive(assert, stdout);
  return stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

test(
  'real HTTP ingress and separate worker process correlate request/job/sync/DB with scrubbed output',
  { timeout: 20000 },
  async (t) => {
    const lines = [];
    const telemetry = createApiObservability({
      environment: 'integration',
      mode: 'operational',
      sink: (line) => {
        lines.push(line);
      },
    });
    t.after(() => telemetry.shutdown());
    let workerRecords;
    let failure;
    const server = createServer(async (request, response) => {
      try {
        for await (const chunk of request) assert.ok(chunk.length > 0);
        await telemetry.run(
          'http.transactions.create',
          async (scope) => {
            scope.setMetadata({
              ...sensitive,
              status_code: 201,
              workspace_id: workspaceId,
            });
            workerRecords = await workerProcess(scope.carrier(), t);
            response.writeHead(201, {
              'Content-Type': 'application/json',
              'X-Request-Id': scope.correlation.request_id,
              'Cache-Control': 'no-store',
            });
            response.end(
              JSON.stringify({ requestId: scope.correlation.request_id }),
            );
          },
          { carrier: request.headers },
        );
      } catch (error) {
        failure = error;
        response.writeHead(500).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const response = await globalThis.fetch(
      `http://127.0.0.1:${server.address().port}/synthetic`,
      {
        method: 'POST',
        body: JSON.stringify(sensitive),
        headers: {
          ...externalCarrier,
          cookie: sensitive.cookie,
          authorization: sensitive.token,
        },
      },
    );
    if (failure) throw failure;
    assert.equal(response.status, 201);
    const body = await response.json();
    await telemetry.flush();
    const records = [
      ...lines.map((line) => JSON.parse(line)),
      ...workerRecords,
    ];
    assertNoSensitive(assert, JSON.stringify(records));
    assert.equal(new Set(records.map((entry) => entry.request_id)).size, 1);
    assert.equal(new Set(records.map((entry) => entry.trace_id)).size, 1);
    assert.equal(records[0].request_id, body.requestId);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    assert.notEqual(records[0].trace_id, '1'.repeat(32));
    const spans = records.filter((entry) => entry.signal === 'span');
    assert.equal(spans.length, 4);
    const api = spans.find((entry) => entry.service === 'api');
    const job = spans.find((entry) => entry.operation === 'job.import');
    const sync = spans.find((entry) => entry.operation === 'sync.batch');
    const db = spans.find((entry) => entry.operation === 'db.query');
    assert.equal(job.parent_span_id, api.span_id);
    assert.equal(sync.parent_span_id, job.span_id);
    assert.equal(db.parent_span_id, sync.span_id);
    assert.equal(db.status, 'error');
    assert.equal(db.error_code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(new Set(spans.map((entry) => entry.span_id)).size, 4);
  },
);
