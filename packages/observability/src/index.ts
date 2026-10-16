import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span, SpanContext } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  operations,
  logEvents,
  ownData,
  isUuid,
  safeMetadata,
  safeErrorCode,
  parseTraceparent,
} from './policy.js';
import type { Operation, LogEvent, SafeMetadata } from './policy.js';

export type { Operation, LogEvent, ErrorCode, SafeMetadata } from './policy.js';
export type Service = 'api' | 'bff' | 'worker' | 'sync';
export type Environment =
  'local' | 'ci' | 'integration' | 'staging' | 'production';
export type Correlation = Readonly<{
  request_id: string;
  trace_id: string;
  span_id: string;
}>;
export type Carrier = Readonly<{ traceparent: string; 'x-request-id': string }>;
// A synchronous, explicitly supplied destination. No default console/network sink.
export type TelemetrySink = (line: string) => void;
export type ObservabilityOptions = Readonly<{
  service: Service;
  environment: Environment;
  mode?: 'disabled' | 'operational';
  sink?: TelemetrySink;
}>;
export type RunOptions = Readonly<{
  metadata?: unknown;
  carrier?: unknown;
  trust?: 'external' | 'internal';
}>;
export type OperationScope = Readonly<{
  correlation: Correlation;
  carrier: () => Carrier;
  setMetadata: (metadata: unknown) => void;
  log: (event: LogEvent, metadata?: unknown) => void;
  captureError: (error: unknown, code?: unknown) => void;
}>;
export class ObservabilityError extends Error {
  constructor(
    code:
      | 'OBSERVABILITY_CONFIG_INVALID'
      | 'OBSERVABILITY_OPERATION_INVALID'
      | 'OBSERVABILITY_CLOSED',
  ) {
    super(code);
    this.name = 'ObservabilityError';
  }
}

function randomNonzeroId(bytes: number) {
  let value: string;
  do {
    value = randomBytes(bytes).toString('hex');
  } while (/^0+$/.test(value));
  return value;
}
const newTraceId = () => randomNonzeroId(16);
const newSpanId = () => randomNonzeroId(8);
const duration = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value * 1000) / 1000) : 0;

export function createObservability(options: ObservabilityOptions) {
  const { service, environment, mode = 'disabled', sink } = options;
  if (
    !['api', 'bff', 'worker', 'sync'].includes(service) ||
    !['local', 'ci', 'integration', 'staging', 'production'].includes(
      environment,
    ) ||
    !['disabled', 'operational'].includes(mode) ||
    (mode === 'operational' && typeof sink !== 'function')
  ) {
    throw new ObservabilityError('OBSERVABILITY_CONFIG_INVALID');
  }
  const enabled = mode === 'operational';
  const storage = new AsyncLocalStorage<{
    correlation: Correlation;
    span: Span;
    active: boolean;
  }>();
  let closed = false;
  let sinkFailures = 0;
  let droppedRecords = 0;

  function emit(record: object) {
    if (!enabled || closed) return;
    try {
      const line = JSON.stringify(record);
      // Bound output even if the static catalogue grows later.
      if (line.length > 4096) {
        droppedRecords++;
        return;
      }
      // Catch rejected async implementations too; sinks must not block business work.
      const result: unknown = sink!(line);
      if (result instanceof Promise)
        void result.catch(() => {
          sinkFailures++;
        });
    } catch {
      sinkFailures++;
    }
  }

  // The SDK stays private. Only this projection can cross the export boundary;
  // no resource dump, exception, events, links, scope metadata or status message.
  const exporter: SpanExporter = {
    export(spans: ReadableSpan[], done) {
      for (const span of spans) {
        const correlation = span.spanContext();
        emit({
          schema_version: 1,
          signal: 'span',
          service,
          environment,
          timestamp: new Date(
            span.startTime[0] * 1000 + span.startTime[1] / 1e6,
          ).toISOString(),
          operation: span.name,
          trace_id: correlation.traceId,
          span_id: correlation.spanId,
          ...(span.parentSpanContext
            ? { parent_span_id: span.parentSpanContext.spanId }
            : {}),
          request_id: span.attributes['request_id'],
          ...safeMetadata(span.attributes),
          ...(typeof span.attributes['route_template'] === 'string'
            ? { route_template: span.attributes['route_template'] }
            : {}),
          ...(span.attributes['error_code']
            ? { error_code: safeErrorCode(span.attributes['error_code']) }
            : {}),
          status: span.status.code === SpanStatusCode.ERROR ? 'error' : 'ok',
          duration_ms: duration(
            span.duration[0] * 1000 + span.duration[1] / 1e6,
          ),
        });
      }
      done({ code: 0 });
    },
    async shutdown() {},
  };
  const provider = enabled
    ? new BasicTracerProvider({
        resource: resourceFromAttributes({
          'service.name': service,
          'deployment.environment.name': environment,
        }),
        sampler: new AlwaysOnSampler(),
        idGenerator: { generateTraceId: newTraceId, generateSpanId: newSpanId },
        spanLimits: {
          attributeCountLimit: 12,
          attributeValueLengthLimit: 160,
          eventCountLimit: 0,
          linkCountLimit: 0,
        },
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      })
    : undefined;
  const tracer = provider?.getTracer(
    'financial-manager.observability',
    '1.0.0',
  );

  async function run<T>(
    operation: Operation,
    handler: (scope: OperationScope) => T | Promise<T>,
    settings: RunOptions = {},
  ): Promise<T> {
    if (closed) throw new ObservabilityError('OBSERVABILITY_CLOSED');
    if (typeof operation !== 'string' || !Object.hasOwn(operations, operation))
      throw new ObservabilityError('OBSERVABILITY_OPERATION_INVALID');
    const definition = operations[operation];
    const stored = storage.getStore();
    // An explicit carrier establishes ingress even inside an existing handler.
    const active =
      stored?.active && settings.carrier === undefined ? stored : undefined;
    // The caller must establish trust independently of the carrier's contents.
    // Public ingress restarts traces; baggage/tracestate are never inspected.
    const remote =
      settings.trust === 'internal'
        ? parseTraceparent(ownData(settings.carrier, 'traceparent'))
        : undefined;
    const remoteRequest = remote
      ? ownData(settings.carrier, 'x-request-id')
      : undefined;
    const parent = active?.span.spanContext() ?? remote;
    const requestId =
      active?.correlation.request_id ??
      (isUuid(remoteRequest) ? remoteRequest : randomUUID());
    let metadata: SafeMetadata = safeMetadata(settings.metadata);
    let errorCode: string | undefined;
    let finished = false;
    const started = performance.now();
    const parentContext = parent
      ? trace.setSpanContext(ROOT_CONTEXT, parent)
      : ROOT_CONTEXT;
    const span =
      tracer?.startSpan(operation, { kind: definition.kind }, parentContext) ??
      trace.wrapSpanContext({
        traceId: parent?.traceId ?? newTraceId(),
        spanId: newSpanId(),
        traceFlags: 0,
      });
    const spanContext: SpanContext = span.spanContext();
    const correlation: Correlation = Object.freeze({
      request_id: requestId,
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    });
    const route =
      'route' in definition ? { route_template: definition.route } : {};
    const writeLog = (event: string, extra?: SafeMetadata) => {
      emit({
        schema_version: 1,
        signal: 'log',
        service,
        environment,
        timestamp: new Date().toISOString(),
        severity: errorCode ? 'error' : 'info',
        event,
        operation,
        ...correlation,
        ...route,
        ...metadata,
        ...extra,
        ...(errorCode ? { error_code: errorCode } : {}),
        ...(finished
          ? { duration_ms: duration(performance.now() - started) }
          : {}),
      });
    };
    const scope: OperationScope = Object.freeze({
      correlation,
      carrier: () =>
        Object.freeze({
          traceparent: `00-${correlation.trace_id}-${correlation.span_id}-${enabled ? '01' : '00'}`,
          'x-request-id': requestId,
        }),
      setMetadata(value: unknown) {
        if (!finished)
          metadata = Object.freeze({ ...metadata, ...safeMetadata(value) });
      },
      log(event: LogEvent, extra?: unknown) {
        if (!finished && logEvents.includes(event))
          writeLog(event, safeMetadata(extra));
      },
      captureError(_error: unknown, code?: unknown) {
        if (!finished) {
          errorCode = safeErrorCode(code);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
      },
    });
    const state = { correlation, span, active: true };
    return await storage.run(state, async () => {
      writeLog('operation.started');
      try {
        return await handler(scope);
      } catch (error) {
        scope.captureError(error, errorCode);
        throw error;
      } finally {
        finished = true;
        span.setAttributes({
          request_id: requestId,
          ...route,
          ...metadata,
          ...(errorCode ? { error_code: errorCode } : {}),
        });
        if (!errorCode) span.setStatus({ code: SpanStatusCode.OK });
        writeLog(errorCode ? 'operation.failed' : 'operation.completed');
        span.end();
        state.active = false;
      }
    });
  }

  return Object.freeze({
    run,
    current: (): Correlation | undefined => {
      const state = storage.getStore();
      return state?.active ? state.correlation : undefined;
    },
    diagnostics: () =>
      Object.freeze({
        sink_failures: sinkFailures,
        dropped_records: droppedRecords,
      }),
    async flush() {
      await provider?.forceFlush();
    },
    async shutdown() {
      if (!closed) {
        await provider?.shutdown();
        closed = true;
      }
    },
  });
}
