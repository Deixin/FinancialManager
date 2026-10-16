import { validateApiError } from './generated/validators.js';
import type { components } from './generated/schema.js';

export type ApiError = components['schemas']['ApiError'];
const safeMessages: Record<ApiError['code'], string> = {
  VALIDATION_ERROR: 'Verifique os campos informados.',
  UNAUTHENTICATED: 'Autenticação necessária.',
  FORBIDDEN: 'Acesso não autorizado.',
  NOT_FOUND: 'Recurso não encontrado.',
  REVISION_CONFLICT: 'Há uma alteração concorrente que precisa de revisão.',
  IDEMPOTENCY_CONFLICT: 'Esta chave já foi usada para outra solicitação.',
  RATE_LIMITED: 'Limite temporário de solicitações atingido.',
  INTERNAL_ERROR: 'Não foi possível concluir a solicitação.',
};
export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: ApiError };
export type ContractErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'SCOPE_MISMATCH'
  | 'AUTHENTICATION_REQUIRED'
  | 'CSRF_REQUIRED'
  | 'TRANSPORT_ERROR';
export class ContractError extends Error {
  readonly code: ContractErrorCode;
  constructor(code: ContractErrorCode) {
    super(code);
    this.name = 'ContractError';
    this.code = code;
  }
}
export interface HttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly cache: 'no-store';
  readonly credentials: 'same-origin' | 'omit';
  readonly redirect: 'error';
}
export interface HttpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly body: string;
}
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;
interface BaseConfig {
  readonly baseUrl: string;
  readonly transport: HttpTransport;
  readonly allowInsecureLoopback?: boolean;
}
export type WebClientOptions = BaseConfig & {
  readonly webOrigin: string;
  readonly getCsrfToken: () => string | Promise<string>;
};
export type NativeClientOptions = BaseConfig & {
  readonly getAccessToken: () => string | Promise<string>;
};
export type ClientConfig =
  | (WebClientOptions & { readonly profile: 'WEB' })
  | (NativeClientOptions & { readonly profile: 'NATIVE' });
type Validator = (value: unknown) => boolean;
export interface OperationDescriptor {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly status: number;
  readonly request: Validator;
  readonly response: Validator;
}
type Input = {
  readonly path: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

function parseBase(config: ClientConfig): string {
  try {
    const base = new URL(config.baseUrl);
    const loopback =
      base.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) &&
      config.allowInsecureLoopback === true;
    if (
      (!loopback && base.protocol !== 'https:') ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      typeof config.transport !== 'function'
    )
      throw new Error();
    if (config.profile === 'WEB') {
      const origin = new URL(config.webOrigin);
      if (
        origin.origin !== base.origin ||
        origin.href !== origin.origin + '/' ||
        typeof config.getCsrfToken !== 'function'
      )
        throw new Error();
    } else if (
      config.profile !== 'NATIVE' ||
      typeof config.getAccessToken !== 'function'
    )
      throw new Error();
    return base.href.replace(/\/$/, '');
  } catch {
    throw new ContractError('INVALID_CONFIGURATION');
  }
}

async function credential(
  getter: () => string | Promise<string>,
  code: 'AUTHENTICATION_REQUIRED' | 'CSRF_REQUIRED',
): Promise<string> {
  try {
    const token = await getter();
    if (
      typeof token !== 'string' ||
      !/^[A-Za-z0-9._~+\/-]{1,16384}={0,2}$/.test(token)
    )
      throw new Error();
    return token;
  } catch {
    throw new ContractError(code);
  }
}

function assertScope(
  id: string,
  value: Record<string, unknown>,
  input: Input,
): void {
  const entities =
    'items' in value
      ? (value.items as Record<string, unknown>[])
      : [value.data as Record<string, unknown>];
  const limit = typeof input.query?.limit === 'number' ? input.query.limit : 50;
  if ('items' in value && entities.length > limit)
    throw new ContractError('INVALID_RESPONSE');
  for (const entity of entities) {
    if (
      entity.workspaceId !== input.path.workspaceId ||
      (input.path.accountId && entity.accountId !== input.path.accountId) ||
      (input.query?.accountId && entity.accountId !== input.query.accountId)
    )
      throw new ContractError('SCOPE_MISMATCH');
    if (id === 'getAccountBalance' && entity.asOf !== input.query?.asOf)
      throw new ContractError('INVALID_RESPONSE');
    if (
      id === 'getAccountBalance' &&
      (entity.completeness === 'COMPLETE') !==
        ((entity.warnings as unknown[]).length === 0)
    )
      throw new ContractError('INVALID_RESPONSE');
    if (
      id === 'listTransactions' &&
      ((typeof input.query?.from === 'string' &&
        String(entity.financialDate) < input.query.from) ||
        (typeof input.query?.to === 'string' &&
          String(entity.financialDate) > input.query.to))
    )
      throw new ContractError('INVALID_RESPONSE');
    if (id === 'createTransaction') {
      const body = input.body as Record<string, unknown>;
      for (const key of [
        'id',
        'accountId',
        'financialDate',
        'amountMinor',
        'currencyCode',
        'economicKind',
      ])
        if (entity[key] !== body[key])
          throw new ContractError('INVALID_RESPONSE');
      if (entity.groupId !== null || entity.deletedAt !== null)
        throw new ContractError('INVALID_RESPONSE');
    }
  }
}

export function createExecutor(config: ClientConfig) {
  // Copy config to prevent later mutation from changing the destination or auth profile.
  const captured = { ...config };
  const base = parseBase(captured);
  return async function execute<T>(
    operation: OperationDescriptor,
    rawInput: unknown,
  ): Promise<ApiResult<T>> {
    const input = parseRequest<Input>(operation.request, rawInput);
    let route = operation.path;
    for (const [key, value] of Object.entries(input.path))
      route = route.replace(`{${key}}`, encodeURIComponent(value));
    const query = Object.entries(input.query ?? {})
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join('&');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...input.headers,
    };
    if (captured.profile === 'NATIVE')
      headers.Authorization =
        'Bearer ' +
        (await credential(captured.getAccessToken, 'AUTHENTICATION_REQUIRED'));
    else if (operation.method !== 'GET')
      headers['X-CSRF-Token'] = await credential(
        captured.getCsrfToken,
        'CSRF_REQUIRED',
      );
    const payload =
      input.body === undefined ? {} : { body: JSON.stringify(input.body) };
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: HttpResponse;
    try {
      response = await captured.transport({
        url: base + route + (query ? '?' + query : ''),
        method: operation.method,
        headers,
        ...payload,
        cache: 'no-store',
        redirect: 'error',
        credentials: captured.profile === 'WEB' ? 'same-origin' : 'omit',
      });
    } catch {
      throw new ContractError('TRANSPORT_ERROR');
    }
    if (
      !response ||
      !Number.isInteger(response.status) ||
      !/^application\/json(?:\s*;|$)/i.test(response.contentType ?? '') ||
      !(response.cacheControl ?? '')
        .toLowerCase()
        .split(',')
        .some((part) => part.trim() === 'no-store') ||
      typeof response.body !== 'string' ||
      response.body.length > 1048576
    )
      throw new ContractError('INVALID_RESPONSE');
    let value: unknown;
    try {
      value = JSON.parse(response.body);
    } catch {
      throw new ContractError('INVALID_RESPONSE');
    }
    if (response.status === operation.status) {
      if (!operation.response(value))
        throw new ContractError('INVALID_RESPONSE');
      assertScope(operation.id, value as Record<string, unknown>, input);
      return Object.freeze({
        ok: true,
        status: response.status,
        data: value as T,
      });
    }
    if (
      response.status < 400 ||
      response.status > 599 ||
      !validateApiError(value)
    )
      throw new ContractError('INVALID_RESPONSE');
    return Object.freeze({
      ok: false,
      status: response.status,
      error: {
        ...(value as ApiError),
        message: safeMessages[(value as ApiError).code],
      },
    });
  };
}

/** Shared generated parsers return a validated snapshot for API adapters and clients. */
export function parseRequest<T>(validator: Validator, rawInput: unknown): T {
  if (!validator(rawInput)) throw new ContractError('INVALID_REQUEST');
  let input: Input;
  try {
    input = JSON.parse(JSON.stringify(rawInput)) as Input;
  } catch {
    throw new ContractError('INVALID_REQUEST');
  }
  if (
    !validator(input) ||
    (typeof input.query?.from === 'string' &&
      typeof input.query.to === 'string' &&
      input.query.from > input.query.to)
  )
    throw new ContractError('INVALID_REQUEST');
  return input as T;
}

/** Minimal structural fetch interface keeps DOM types out of the public API. */
export type FetchLike = (
  url: string,
  init: Omit<HttpRequest, 'url'>,
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;
export function createFetchTransport(fetch: FetchLike): HttpTransport {
  return async ({ url, ...init }) => {
    const response = await fetch(url, init);
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      body: await response.text(),
    };
  };
}
