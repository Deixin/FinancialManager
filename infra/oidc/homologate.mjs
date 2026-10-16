/* global Buffer, Response, fetch, setTimeout, document, localStorage, sessionStorage, indexedDB */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createBff } from '../../apps/web/spikes/us-003/bff.mjs';
import {
  localClient,
  beginAuthorization,
  completeAuthorization,
  identityFromClaims,
  oidc,
} from '../../apps/web/spikes/us-003/oidc.mjs';
import { webOrigin, nativeOrigin, issuer, mailOrigin } from './fixture.mjs';

export async function homologate({
  artifacts,
  credentials,
  chromium,
  progress,
}) {
  const checks = {};
  let stage = 'initialization';
  const step = (name) => {
    stage = name;
    progress(name);
  };
  const passed = () => {
    checks[stage] = true;
  };
  const webConfig = await localClient({
    issuer,
    clientId: 'us003-web',
    clientSecret: credentials.clientSecret,
  });
  const publicConfig = await localClient({ issuer, clientId: 'us003-native' });
  let now = Date.now();
  const bff = createBff({
    config: webConfig,
    key: readFileSync(path.join(artifacts, 'localhost.key')),
    cert: readFileSync(path.join(artifacts, 'localhost.pem')),
    clock: () => now,
  });
  await new Promise((resolve, reject) => {
    bff.once('error', reject);
    bff.listen(43181, '127.0.0.1', resolve);
  });
  let browser;
  let nativeCallbackServer;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const beginLogin = async (targetPage = page) => {
      await targetPage.goto(webOrigin);
      await targetPage
        .getByRole('button', { name: 'Entrar', exact: true })
        .click();
      progress(
        'login_navigation: ' +
          (targetPage.url().startsWith(issuer + '/')
            ? 'provider'
            : targetPage.url() === webOrigin + '/login'
              ? 'bff_rejected'
              : targetPage.url() === webOrigin + '/'
                ? 'home'
                : 'other'),
      );
      if (targetPage.url() === webOrigin + '/login') {
        const safeCode = (await targetPage.locator('body').textContent()).match(
          /"code":"([A-Z_]+)"/,
        )?.[1];
        if (
          [
            'CSRF_REJECTED',
            'OIDC_REQUEST_REJECTED',
            'INVALID_REQUEST',
          ].includes(safeCode)
        )
          progress('login_rejected: ' + safeCode);
        throw new Error('LOGIN_NAVIGATION_REJECTED');
      }
      await targetPage.waitForURL(issuer + '/**');
    };
    const fillLogin = async (password, targetPage = page) => {
      await targetPage.locator('#username').fill('synthetic@us003.invalid');
      await targetPage.locator('#password').fill(password);
      await targetPage.locator('#kc-login').click();
    };
    const clearMail = async () => {
      const response = await fetch(mailOrigin + '/api/v1/messages', {
        method: 'DELETE',
      });
      assert.equal(response.ok, true);
    };
    const mailLink = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const list = await (
          await fetch(mailOrigin + '/api/v1/messages')
        ).json();
        if (list.messages?.length) {
          const message = await (
            await fetch(mailOrigin + '/api/v1/message/' + list.messages[0].ID)
          ).json();
          const match = message.Text?.match(
            /http:\/\/127\.0\.0\.1:43180\/[^\s<>]+/,
          );
          assert.ok(match);
          const link = new URL(match[0]);
          assert.equal(link.origin, 'http://127.0.0.1:43180');
          assert.ok(link.pathname.startsWith('/realms/us003/login-actions/'));
          return link.href;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('SYNTHETIC_MAIL_TIMEOUT');
    };
    const session = async (ctx = context) => {
      const response = await ctx.request.get(webOrigin + '/session');
      assert.equal(response.status(), 200);
      assert.equal(response.headers()['cache-control'], 'no-store');
      const body = await response.text();
      assert.doesNotMatch(body, /access_token|refresh_token|id_token/);
      return JSON.parse(body);
    };

    step('email_verification');
    await clearMail();
    progress('email_verification: redirect_to_provider');
    await beginLogin();
    progress('email_verification: submit_synthetic_credentials');
    await fillLogin(credentials.password);
    progress('email_verification: await_provider_challenge');
    await page.waitForURL('**/login-actions/required-action**');
    assert.equal(
      (await context.request.get(webOrigin + '/session')).status(),
      401,
    );
    progress('email_verification: read_local_mail');
    await page.goto(await mailLink());
    progress('email_verification: await_callback');
    await page.waitForURL(webOrigin + '/');
    const originalIdentity = (await session()).identity;
    passed();

    step('bff_cookie_and_browser_storage');
    const cookies = (await context.cookies(webOrigin)).filter((item) =>
      item.name.startsWith('__Host-us003-'),
    );
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].httpOnly, true);
    assert.equal(cookies[0].secure, true);
    assert.equal(cookies[0].sameSite, 'Lax');
    assert.equal(cookies[0].path, '/');
    assert.deepEqual(
      await page.evaluate(async () => ({
        cookie: document.cookie,
        local: localStorage.length,
        session: sessionStorage.length,
        databases: (await indexedDB.databases()).length,
      })),
      { cookie: '', local: 0, session: 0, databases: 0 },
    );
    assert.doesNotMatch(
      await page.content(),
      /access_token|refresh_token|id_token|synthetic@/,
    );
    assert.equal(
      (await context.request.get(webOrigin + '/protected')).status(),
      200,
    );
    passed();

    step('csrf_rejection');
    const loggedIn = await session();
    for (const url of ['/logout', '/refresh', '/login']) {
      assert.equal(
        (
          await context.request.post(webOrigin + url, {
            form: { csrf: loggedIn.csrf },
            headers: { origin: 'https://attacker.invalid' },
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await context.request.post(webOrigin + url, {
            form: { csrf: 'wrong' },
            headers: { origin: webOrigin },
          })
        ).status(),
        403,
      );
      assert.equal((await context.request.get(webOrigin + url)).status(), 404);
    }
    assert.equal(
      (await context.request.get(webOrigin + '/protected')).status(),
      200,
    );
    passed();

    step('bff_refresh');
    const refresh = await context.request.post(webOrigin + '/refresh', {
      form: { csrf: loggedIn.csrf },
      headers: { origin: webOrigin },
    });
    assert.equal(refresh.status(), 200);
    assert.deepEqual(await refresh.json(), { refreshed: true });
    assert.deepEqual((await session()).identity, originalIdentity);
    assert.equal(
      (await context.request.get(webOrigin + '/protected')).status(),
      200,
    );
    passed();

    step('logout_local_and_provider');
    const priorSessionCookie = cookies[0];
    const logoutNavigation = page.waitForRequest((request) =>
      request.url().startsWith(issuer + '/protocol/openid-connect/logout?'),
    );
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    // End-session deliberately sends client_id, not an ID token, to the browser.
    assert.equal(
      new URL((await logoutNavigation).url()).searchParams.has('id_token_hint'),
      false,
    );
    // Revocation may already have ended the IdP session; that case redirects
    // immediately. Otherwise the IdP asks the user to confirm the logout.
    if (page.url() !== webOrigin + '/')
      await page.locator('#kc-logout').click();
    await page.waitForURL(webOrigin + '/');
    assert.equal(
      (await context.request.get(webOrigin + '/session')).status(),
      401,
    );
    const oldSession = await browser.newContext({ ignoreHTTPSErrors: true });
    await oldSession.addCookies([priorSessionCookie]);
    assert.equal(
      (await oldSession.request.get(webOrigin + '/protected')).status(),
      401,
    );
    await oldSession.close();
    await beginLogin();
    await page.locator('#username').waitFor(); // IdP SSO session really ended.
    passed();

    step('password_recovery_at_provider');
    await clearMail();
    await page.getByRole('link', { name: 'Forgot Password?' }).click();
    await page.locator('#username').fill('synthetic@us003.invalid');
    await page.locator('button[type=submit], input[type=submit]').click();
    await page.goto(await mailLink());
    const recoveredPassword = randomBytes(32).toString('base64url');
    await page.locator('#password-new').fill(recoveredPassword);
    await page.locator('#password-confirm').fill(recoveredPassword);
    await page.locator('button[type=submit], input[type=submit]').click();
    await page.waitForURL(webOrigin + '/');
    assert.deepEqual((await session()).identity, originalIdentity);
    const rejectedContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const rejectedPage = await rejectedContext.newPage();
    await beginLogin(rejectedPage);
    await fillLogin(credentials.password, rejectedPage);
    await rejectedPage.locator('#username[aria-invalid=true]').waitFor();
    assert.equal(
      (await rejectedContext.request.get(webOrigin + '/session')).status(),
      401,
    );
    await rejectedContext.close();
    passed();

    // Use the real IdP browser session to obtain codes; never mock the token endpoint.
    const deliveredCallbacks = new Map();
    nativeCallbackServer = createHttpServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(request.url, nativeOrigin);
      if (
        request.method !== 'GET' ||
        request.headers.host !== '127.0.0.1:43182' ||
        url.pathname !== '/callback' ||
        !url.searchParams.get('state')
      ) {
        response.writeHead(400);
        response.end();
        return;
      }
      deliveredCallbacks.set(url.searchParams.get('state'), url.href);
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('Synthetic protocol callback received.');
    });
    await new Promise((resolve, reject) => {
      nativeCallbackServer.once('error', reject);
      nativeCallbackServer.listen(43182, '127.0.0.1', resolve);
    });
    const callbackTarget = (target) => (url) =>
      url.origin === new URL(target).origin &&
      url.pathname === new URL(target).pathname;
    const capture = async (pending, ctx = context) => {
      const tab = await ctx.newPage();
      let callback;
      tab.on('requestfailed', (request) => {
        const failedOrigin = new URL(request.url()).origin;
        progress(
          'callback_transport: ' +
            (failedOrigin === nativeOrigin
              ? 'loopback_http'
              : failedOrigin === nativeOrigin.replace('http:', 'https:')
                ? 'loopback_https'
                : failedOrigin === new URL(issuer).origin
                  ? 'provider'
                  : 'other'),
        );
      });
      await tab.goto(pending.url.href);
      if (
        new URL(tab.url()).origin !== new URL(pending.redirectUri).origin &&
        (await tab.locator('#username').isVisible())
      ) {
        await fillLogin(recoveredPassword, tab);
      }
      await tab.waitForURL(callbackTarget(pending.redirectUri));
      callback = deliveredCallbacks.get(pending.state);
      deliveredCallbacks.delete(pending.state);
      await tab.close();
      assert.ok(callback);
      return callback;
    };
    const publicAttempt = async () => {
      const pending = await beginAuthorization(
        publicConfig,
        nativeOrigin + '/callback',
      );
      const callback = await capture(pending);
      return { pending, callback };
    };

    step('public_client_pkce');
    const first = await publicAttempt();
    assert.equal(
      first.pending.url.searchParams.get('code_challenge_method'),
      'S256',
    );
    assert.equal(
      publicConfig.clientMetadata().token_endpoint_auth_method,
      'none',
    );
    const publicTokens = await completeAuthorization(
      publicConfig,
      first.callback,
      first.pending,
    );
    assert.deepEqual(
      identityFromClaims(publicConfig, publicTokens),
      originalIdentity,
    );
    assert.ok(publicTokens.refresh_token);
    passed();

    step('code_replay_rejected');
    await assert.rejects(
      completeAuthorization(publicConfig, first.callback, first.pending),
    );
    passed();

    step('wrong_verifier_rejected');
    const wrongVerifier = await publicAttempt();
    await assert.rejects(
      completeAuthorization(publicConfig, wrongVerifier.callback, {
        ...wrongVerifier.pending,
        verifier: oidc.randomPKCECodeVerifier(),
      }),
    );
    passed();

    step('nonce_and_state_rejected');
    for (const field of ['state', 'nonce']) {
      const attempt = await publicAttempt();
      await assert.rejects(
        completeAuthorization(publicConfig, attempt.callback, {
          ...attempt.pending,
          [field]: 'incorrect',
        }),
      );
    }
    const badTarget = await publicAttempt();
    await assert.rejects(
      completeAuthorization(
        publicConfig,
        badTarget.callback.replace('/callback?', '/other?'),
        badTarget.pending,
      ),
    );
    const duplicated = new URL(badTarget.callback);
    duplicated.searchParams.append('code', 'duplicate');
    await assert.rejects(
      completeAuthorization(publicConfig, duplicated, badTarget.pending),
    );
    passed();

    step('signature_tampering_rejected');
    const signed = await publicAttempt();
    const originalFetch = publicConfig[oidc.customFetch];
    publicConfig[oidc.customFetch] = async (...args) => {
      const response = await fetch(...args);
      if (!String(args[0]).endsWith('/token')) return response;
      const body = await response.json();
      if (body.id_token) {
        const parts = body.id_token.split('.');
        const signature = Buffer.from(parts[2], 'base64url');
        signature[0] ^= 1;
        parts[2] = signature.toString('base64url');
        body.id_token = parts.join('.');
      }
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: response.headers,
      });
    };
    try {
      await assert.rejects(
        completeAuthorization(publicConfig, signed.callback, signed.pending),
      );
    } finally {
      publicConfig[oidc.customFetch] = originalFetch;
    }
    passed();

    step('refresh_rotation_and_revocation');
    const fresh = await publicAttempt();
    const tokens = await completeAuthorization(
      publicConfig,
      fresh.callback,
      fresh.pending,
    );
    const rotated = await oidc.refreshTokenGrant(
      publicConfig,
      tokens.refresh_token,
    );
    assert.ok(rotated.refresh_token);
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    await assert.rejects(
      oidc.refreshTokenGrant(publicConfig, tokens.refresh_token),
    );
    const revocationAttempt = await publicAttempt();
    const revocable = await completeAuthorization(
      publicConfig,
      revocationAttempt.callback,
      revocationAttempt.pending,
    );
    await oidc.tokenRevocation(publicConfig, revocable.refresh_token, {
      token_type_hint: 'refresh_token',
    });
    await assert.rejects(
      oidc.refreshTokenGrant(publicConfig, revocable.refresh_token),
    );
    passed();

    step('callback_binding_expiry_and_replay');
    // Playwright routes the initial request in a redirect chain. Hold the
    // provider's actual 302 instead of trying to intercept its callback target.
    const withholdBffCallback = async (targetPage) => {
      let callback;
      await targetPage.route(
        (url) =>
          url.origin === new URL(issuer).origin &&
          url.pathname === '/realms/us003/login-actions/authenticate',
        async (route) => {
          const response = await route.fetch({ maxRedirects: 0 });
          const location = response.headers().location;
          if (
            [302, 303].includes(response.status()) &&
            location &&
            callbackTarget(webOrigin + '/callback')(new URL(location, issuer))
          ) {
            callback = new URL(location, issuer).href;
            await route.fulfill({
              status: 200,
              headers: {
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
              },
              body: 'Synthetic callback withheld.',
            });
          } else await route.fulfill({ response });
        },
      );
      await beginLogin(targetPage);
      await fillLogin(recoveredPassword, targetPage);
      assert.ok(callback);
      return callback;
    };
    // Revocation can end IdP sessions. Reauthenticate through the BFF first.
    const callbackContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const callbackPage = await callbackContext.newPage();
    const intercepted = await withholdBffCallback(callbackPage);
    const foreignBrowser = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    assert.equal((await foreignBrowser.request.get(intercepted)).status(), 400);
    await foreignBrowser.close();
    const wrongState = new URL(intercepted);
    wrongState.searchParams.set('state', 'incorrect');
    assert.equal(
      (await callbackContext.request.get(wrongState.href)).status(),
      400,
    );
    const successful = await callbackContext.request.get(intercepted);
    assert.equal(successful.status(), 200);
    assert.equal(
      (await callbackContext.request.get(intercepted)).status(),
      400,
    );
    assert.deepEqual(
      (await session(callbackContext)).identity,
      originalIdentity,
    );
    await callbackContext.close();

    const expiredContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const expiredPage = await expiredContext.newPage();
    const expiredCallback = await withholdBffCallback(expiredPage);
    now += 5 * 60_000 + 1;
    assert.equal(
      (await expiredContext.request.get(expiredCallback)).status(),
      400,
    );
    assert.equal(
      (await expiredContext.request.get(webOrigin + '/session')).status(),
      401,
    );
    await expiredContext.close();
    passed();
    step('session_expiry');
    now += 15 * 60_000;
    assert.equal(
      (await context.request.get(webOrigin + '/session')).status(),
      401,
    );
    assert.equal(
      (await context.request.get(webOrigin + '/protected')).status(),
      401,
    );
    passed();
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'local-oidc-protocol',
      passed: true,
      completed_at_utc: new Date().toISOString(),
      checks,
      versions: { chromium: browser.version() },
      pending: [
        'google',
        'apple',
        'native-system-browser-deep-link-and-secret-store',
        'nextjs-integration',
      ],
    };
  } catch (error) {
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'local-oidc-protocol',
      passed: false,
      completed_at_utc: new Date().toISOString(),
      failed_step: stage,
      failure_code:
        error.message?.match(/net::ERR_[A-Z_]+/)?.[0] ?? 'CHECK_REJECTED',
      failure_location:
        error.stack?.match(/homologate\.mjs:\d+:\d+/)?.[0] ??
        'external-library',
      checks,
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      if (nativeCallbackServer) {
        nativeCallbackServer.closeAllConnections();
        await new Promise((resolve) => nativeCallbackServer.close(resolve));
      }
      bff.closeAllConnections();
      await new Promise((resolve) => bff.close(resolve));
    }
  }
}
