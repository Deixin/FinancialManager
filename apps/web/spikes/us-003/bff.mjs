/* global Buffer, URLSearchParams */
import { createServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import {
  beginAuthorization,
  completeAuthorization,
  identityFromClaims,
  oidc,
} from './oidc.mjs';

const origin = 'https://127.0.0.1:43181';
const sessionCookie = '__Host-us003-session';
const logoutCookie = '__Host-us003-logout';
const lifetime = 15 * 60_000;
const transactionLifetime = 5 * 60_000;
const random = () => randomBytes(32).toString('base64url');

export class ExpiringStore {
  #items = new Map();
  constructor(ttl, limit = 128, clock = Date.now) {
    this.ttl = ttl;
    this.limit = limit;
    this.clock = clock;
  }
  prune() {
    for (const [key, item] of this.#items)
      if (item.until <= this.clock()) this.#items.delete(key);
  }
  put(key, value) {
    this.prune();
    if (this.#items.size >= this.limit && !this.#items.has(key))
      throw new Error('CAPACITY_REACHED');
    this.#items.set(key, { value, until: this.clock() + this.ttl });
  }
  get(key) {
    this.prune();
    return this.#items.get(key)?.value;
  }
  take(key) {
    const value = this.get(key);
    this.#items.delete(key);
    return value;
  }
  delete(key) {
    this.#items.delete(key);
  }
  clear() {
    this.#items.clear();
  }
}

export function readCookie(header, name) {
  const values = (header ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

const cookie = (name, value, age) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

async function readForm(req) {
  if (
    req.headers['content-type']?.split(';')[0] !==
    'application/x-www-form-urlencoded'
  )
    throw new Error('FORM_REQUIRED');
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 1024) throw new Error('FORM_TOO_LARGE');
  }
  return new URLSearchParams(body);
}

export function createBff({ config, key, cert, clock = Date.now }) {
  const sessions = new ExpiringStore(lifetime, 128, clock);
  const transactions = new ExpiringStore(transactionLifetime, 128, clock);
  const logouts = new ExpiringStore(transactionLifetime, 128, clock);
  const server = createServer({ key, cert }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    // no-referrer on a form page makes Chromium serialize the POST Origin as
    // null. same-origin preserves CSRF validation without referring the IdP.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; form-action 'self' http://127.0.0.1:43180; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const redirect = (url) => {
      res.writeHead(303, { Location: url.toString() });
      res.end();
    };
    try {
      // Never trust Host / Forwarded / X-Forwarded-* to build callback URLs.
      if (
        req.headers.host !== '127.0.0.1:43181' ||
        !req.url?.startsWith('/') ||
        req.url.startsWith('//')
      )
        return reply(400, { code: 'INVALID_REQUEST' });
      const url = new URL(req.url, origin);
      const id = readCookie(req.headers.cookie, sessionCookie);
      const session = sessions.get(id);
      if (req.method === 'GET' && url.pathname === '/') {
        const current = session ?? { csrf: random() };
        if (!session) {
          const freshId = random();
          sessions.put(freshId, current);
          res.setHeader(
            'Set-Cookie',
            cookie(sessionCookie, freshId, lifetime / 1000),
          );
        }
        const action = current.tokens ? 'logout' : 'login';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>US-003 — identidade sintética</title><h1>Teste local de autenticação</h1><p>${current.tokens ? 'Sessão autenticada.' : 'Sessão desconectada.'}</p><form method="post" action="/${action}"><input type="hidden" name="csrf" value="${current.csrf}"><button>${current.tokens ? 'Sair' : 'Entrar'}</button></form></html>`,
        );
      }
      if (req.method === 'GET' && url.pathname === '/callback') {
        res.setHeader('Referrer-Policy', 'no-referrer');
        const state = url.searchParams.get('state');
        const pending = transactions.get(state);
        if (!pending || !session || pending.browser !== id)
          return reply(400, { code: 'CALLBACK_REJECTED' });
        // Consume before network I/O so a concurrent replay cannot exchange twice.
        transactions.take(state);
        const tokens = await completeAuthorization(config, url, pending);
        const identity = identityFromClaims(config, tokens);
        const freshId = random();
        sessions.delete(id);
        sessions.put(freshId, { tokens, identity, csrf: random() });
        res.setHeader(
          'Set-Cookie',
          cookie(sessionCookie, freshId, lifetime / 1000),
        );
        return redirect('/');
      }
      if (req.method === 'GET' && url.pathname === '/signed-out') {
        const logoutId = readCookie(req.headers.cookie, logoutCookie);
        const expected = logouts.take(logoutId);
        res.setHeader('Set-Cookie', cookie(logoutCookie, '', 0));
        if (
          !expected ||
          url.searchParams.get('state') !== expected ||
          url.searchParams.getAll('state').length !== 1
        )
          return reply(400, { code: 'LOGOUT_CALLBACK_REJECTED' });
        return redirect('/');
      }
      if (req.method === 'GET' && url.pathname === '/session') {
        if (!session?.tokens) return reply(401, { authenticated: false });
        return reply(200, {
          authenticated: true,
          identity: session.identity,
          csrf: session.csrf,
        });
      }
      if (req.method === 'GET' && url.pathname === '/protected') {
        if (!session?.tokens)
          return reply(401, { code: 'AUTHENTICATION_REQUIRED' });
        await oidc.fetchUserInfo(
          config,
          session.tokens.access_token,
          session.identity.subject,
        );
        return reply(200, { authorized: true });
      }
      if (
        req.method === 'POST' &&
        ['/login', '/logout', '/refresh'].includes(url.pathname)
      ) {
        if (req.headers.origin !== origin || !session)
          return reply(403, { code: 'CSRF_REJECTED' });
        const form = await readForm(req);
        if (
          form.getAll('csrf').length !== 1 ||
          form.get('csrf') !== session.csrf ||
          [...form.keys()].some((k) => k !== 'csrf')
        )
          return reply(403, { code: 'CSRF_REJECTED' });
        if (url.pathname === '/login') {
          const pending = await beginAuthorization(
            config,
            origin + '/callback',
          );
          transactions.put(pending.state, { ...pending, browser: id });
          return redirect(pending.url);
        }
        if (!session.tokens)
          return reply(401, { code: 'AUTHENTICATION_REQUIRED' });
        if (url.pathname === '/refresh') {
          // Serialize rotation for concurrent requests belonging to this session.
          session.refresh ??= oidc
            .refreshTokenGrant(config, session.tokens.refresh_token)
            .then((tokens) => {
              if (tokens.id_token) {
                const identity = identityFromClaims(config, tokens);
                if (
                  identity.issuer !== session.identity.issuer ||
                  identity.subject !== session.identity.subject
                )
                  throw new Error('IDENTITY_CHANGED');
              }
              session.tokens = tokens;
            })
            .finally(() => {
              delete session.refresh;
            });
          await session.refresh;
          return reply(200, { refreshed: true });
        }
        sessions.delete(id);
        res.setHeader('Set-Cookie', cookie(sessionCookie, '', 0));
        await oidc.tokenRevocation(config, session.tokens.refresh_token, {
          token_type_hint: 'refresh_token',
        });
        const logoutId = random();
        const state = random();
        logouts.put(logoutId, state);
        res.setHeader('Set-Cookie', [
          cookie(sessionCookie, '', 0),
          cookie(logoutCookie, logoutId, transactionLifetime / 1000),
        ]);
        // No id_token_hint in browser URLs; the IdP asks for logout confirmation.
        return redirect(
          oidc.buildEndSessionUrl(config, {
            client_id: config.clientMetadata().client_id,
            post_logout_redirect_uri: origin + '/signed-out',
            state,
          }),
        );
      }
      return reply(404, { code: 'NOT_FOUND' });
    } catch {
      // Native/library errors may carry codes or tokens. Return only a fixed code.
      if (req.url === '/refresh') {
        const id = readCookie(req.headers.cookie, sessionCookie);
        sessions.delete(id);
        res.setHeader('Set-Cookie', cookie(sessionCookie, '', 0));
      }
      reply(400, { code: 'OIDC_REQUEST_REJECTED' });
    }
  });
  server.on('close', () => {
    sessions.clear();
    transactions.clear();
    logouts.clear();
  });
  return server;
}
