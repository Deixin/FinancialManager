import { SpanKind } from '@opentelemetry/api';

// Names, routes and error codes are code-owned, never derived from payloads.
export const operations = Object.freeze({
  'http.accounts.list': {
    kind: SpanKind.SERVER,
    route: '/v1/workspaces/{workspaceId}/accounts',
  },
  'http.accounts.balance': {
    kind: SpanKind.SERVER,
    route: '/v1/workspaces/{workspaceId}/accounts/{accountId}/balance',
  },
  'http.transactions.list': {
    kind: SpanKind.SERVER,
    route: '/v1/workspaces/{workspaceId}/transactions',
  },
  'http.transactions.create': {
    kind: SpanKind.SERVER,
    route: '/v1/workspaces/{workspaceId}/transactions',
  },
  'job.import': { kind: SpanKind.CONSUMER },
  'sync.batch': { kind: SpanKind.CONSUMER },
  'db.query': { kind: SpanKind.INTERNAL },
});

export type Operation = keyof typeof operations;
export const errorCodes = Object.freeze([
  'VALIDATION_ERROR',
  'ACCESS_DENIED',
  'CONFLICT',
  'CANCELLED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const);
export type ErrorCode = (typeof errorCodes)[number];
export const logEvents = Object.freeze([
  'retry.scheduled',
  'conflict.detected',
  'dependency.unavailable',
] as const);
export type LogEvent = (typeof logEvents)[number];

export type SafeMetadata = Readonly<{
  workspace_id?: string;
  entity_type?: string;
  parser_version?: string;
  status_code?: number;
}>;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );

// Do not enumerate, recurse, stringify or invoke accessors on untrusted input.
export function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

export function safeMetadata(value: unknown): SafeMetadata {
  const result: {
    workspace_id?: string;
    entity_type?: string;
    parser_version?: string;
    status_code?: number;
  } = {};
  const workspace = ownData(value, 'workspace_id');
  if (isUuid(workspace)) result.workspace_id = workspace;
  const entity = ownData(value, 'entity_type');
  if (
    typeof entity === 'string' &&
    [
      'workspace',
      'account',
      'transaction',
      'import_batch',
      'sync_batch',
    ].includes(entity)
  )
    result.entity_type = entity;
  const parser = ownData(value, 'parser_version');
  if (
    typeof parser === 'string' &&
    parser.trim() === parser &&
    /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parser)
  )
    result.parser_version = parser;
  const status = ownData(value, 'status_code');
  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  )
    result.status_code = status;
  return Object.freeze(result);
}

export function safeErrorCode(value: unknown): ErrorCode {
  return errorCodes.includes(value as ErrorCode)
    ? (value as ErrorCode)
    : 'INTERNAL_ERROR';
}

export function parseTraceparent(value: unknown) {
  if (typeof value !== 'string' || value.length !== 55) return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(00|01)$/.exec(value);
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!))
    return undefined;
  return {
    traceId: match[1]!,
    spanId: match[2]!,
    traceFlags: Number.parseInt(match[3]!, 16),
    isRemote: true,
  };
}
