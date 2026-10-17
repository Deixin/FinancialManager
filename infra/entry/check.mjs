/* global document, innerWidth, getComputedStyle, navigator, localStorage, sessionStorage, indexedDB */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from './host.mjs';
import { entryHashes, validateEntryEvidence } from './evidence.mjs';
const directory = new URL('../../.tools/us030-entry/', import.meta.url);
const report = {
  format_version: 1,
  scope: 'us030-desktop-entry-browser',
  passed: false,
  checks: {},
  versions: { node: process.versions.node },
  pending: [
    'workspace-persistence-us031',
    'vault-product-integration-us032',
    'cloud-auth-product-integration',
    'signed-desktop-release',
  ],
};
let host,
  browser,
  stage = 'start';
const step = async (name, run) => {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US-030 check: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage();
  const errors = [],
    requests = [];
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('CONSOLE');
  });
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  const local = () => page.getByRole('button', { name: 'Continuar sem conta' });
  await page.goto(host.url);
  await step('three_choices_and_local_prominence', async () => {
    await local().waitFor();
    assert.equal(await local().isEnabled(), true);
    assert.equal(
      await page
        .getByRole('button', { name: 'Entrar', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Criar conta', exact: true })
        .isDisabled(),
      true,
    );
    const boxes = await page
      .getByRole('button')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().top),
      );
    assert.ok(boxes[0] < boxes[1]);
    assert.match(
      await page.locator('.entry-caption').innerText(),
      /não envia dados financeiros/,
    );
  });
  await step('keyboard_skip_and_local_transition_focus', async () => {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      'Pular para o conteúdo',
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(
      await local().evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press('Enter');
    await page
      .getByRole('heading', { name: 'Primeiro espaço', exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator('h1')
        .evaluate((node) => node === document.activeElement),
      true,
    );
    assert.match(await page.title(), /Primeiro espaço/);
  });
  await step(
    'local_handoff_without_credentials_or_fake_workspace',
    async () => {
      assert.equal(await page.locator('input').count(), 0);
      assert.equal(
        await page.getByText('Modo local', { exact: true }).count(),
        1,
      );
      assert.match(
        await page.locator('main').innerText(),
        /criação de espaços estará disponível em breve/,
      );
      assert.equal(
        await page
          .getByRole('button', { name: 'Criar espaço', exact: true })
          .count(),
        0,
      );
    },
  );
  await step('back_and_repeat_do_not_duplicate_state', async () => {
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Voltar à entrada' }).click();
      await local().click();
      await page
        .getByRole('heading', { name: 'Primeiro espaço', exact: true })
        .waitFor();
      assert.equal(await page.locator('h1').count(), 1);
    }
    await page.getByRole('button', { name: 'Voltar à entrada' }).click();
  });
  await step('offline_keeps_local_available', async () => {
    await context.setOffline(true);
    await page.getByText(/Você está sem internet/).waitFor();
    await local().click();
    await page
      .getByRole('heading', { name: 'Primeiro espaço', exact: true })
      .waitFor();
  });
  await step('network_changes_do_not_leave_local_mode', async () => {
    await context.setOffline(false);
    await context.setOffline(true);
    assert.equal(
      await page.getByText('Modo local', { exact: true }).count(),
      1,
    );
    await page.getByRole('button', { name: 'Voltar à entrada' }).click();
    await page.getByText(/Você está sem internet/).waitFor();
    await context.setOffline(false);
    await page
      .getByText('O acesso à nuvem estará disponível em breve.')
      .waitFor();
  });
  await step('privacy_information_available_offline', async () => {
    await context.setOffline(true);
    await page.getByText('Privacidade no modo local', { exact: true }).click();
    assert.equal(
      await page.getByText(/não cria um usuário remoto/).isVisible(),
      true,
    );
    await context.setOffline(false);
  });
  await step('axe_accessibility_both_screens', async () => {
    for (let i = 0; i < 2; i++) {
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      assert.equal(result.violations.length, 0);
      if (i === 0) await local().click();
    }
    await page.getByRole('button', { name: 'Voltar à entrada' }).click();
  });
  await step('responsive_reflow_and_large_text', async () => {
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await local().click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.getByRole('button', { name: 'Voltar à entrada' }).click();
    }
    await page.setViewportSize({ width: 640, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.evaluate(() =>
      document.documentElement.style.removeProperty('font-size'),
    );
  });
  await step('forced_colors_focus_and_targets', async () => {
    await page.emulateMedia({ forcedColors: 'active' });
    assert.ok(
      (await local().evaluate((node) => node.getBoundingClientRect().height)) >=
        44,
    );
    await page.locator('h1').focus();
    await page.keyboard.press('Tab');
    assert.notEqual(
      await local().evaluate((node) => getComputedStyle(node).outlineStyle),
      'none',
    );
    await page.emulateMedia({ forcedColors: 'none' });
  });
  await step('fresh_boot_offline_without_anonymous_identity', async () => {
    const fresh = await browser.newContext();
    await fresh.setOffline(true);
    // Deliver the already-built local assets as an embedded-host analogue while Chromium is offline.
    await fresh.route(host.url + '**', async (route) => {
      const response = await context.request.get(route.request().url());
      await route.fulfill({ response });
    });
    const offline = await fresh.newPage();
    await offline.goto(host.url);
    await offline.getByRole('button', { name: 'Continuar sem conta' }).click();
    await offline
      .getByRole('heading', { name: 'Primeiro espaço', exact: true })
      .waitFor();
    assert.equal(await offline.evaluate(() => navigator.onLine), false);
    await fresh.close();
  });
  await step('no_storage_egress_identity_or_runtime_errors', async () => {
    assert.deepEqual(
      await page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        databases: (await indexedDB.databases()).length,
        cookies: document.cookie,
        serviceWorkers: (await navigator.serviceWorker.getRegistrations())
          .length,
      })),
      { local: 0, session: 0, databases: 0, cookies: '', serviceWorkers: 0 },
    );
    assert.deepEqual(errors, []);
    assert.ok(
      requests.every(
        (request) =>
          request.method === 'GET' && request.url.startsWith(host.url),
      ),
    );
    assert.ok(
      requests.every(
        (request) =>
          !/(auth|config|identity|token|telemetry)/.test(
            new URL(request.url).pathname,
          ),
      ),
    );
    await page.screenshot({
      path: fileURLToPath(new URL('entry.png', directory)),
      fullPage: true,
    });
  });
  report.passed = true;
} catch {
  process.exitCode = 1;
  console.error('US030_ENTRY_FAILED_' + stage.toUpperCase());
} finally {
  try {
    await browser?.close();
    await host?.close();
    report.resources_closed = true;
  } catch {
    report.passed = false;
    process.exitCode = 1;
  }
  report.source_sha256 = entryHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateEntryEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
