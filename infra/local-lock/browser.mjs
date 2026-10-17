/* global document,Event,localStorage,sessionStorage,indexedDB,window */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { lockHashes, pending, validateLockEvidence } from './evidence.mjs';
const directory = new URL('../../.tools/us033-lock/', import.meta.url),
  PIN = '721947350682',
  SECOND = '682035741921',
  NAME = 'SYNTHETIC US033 PRIVATE SPACE';
const report = {
  format_version: 1,
  scope: 'us033-local-lock-browser',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: { node: process.versions.node },
  pending,
};
let browser,
  host,
  stage = 'startup';
const step = async (name, action) => {
  stage = name;
  await action();
  report.checks[name] = true;
  console.log('US-033 browser: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const preview = await browser.newPage();
  await preview.goto(host.url);
  await preview.getByRole('button', { name: 'Continuar sem conta' }).click();
  await step('preview_has_no_privacy_persistence', async () => {
    await preview.getByText(/Esta visualização não salva dados/).waitFor();
    assert.equal(
      await preview
        .getByRole('button', { name: 'Privacidade local', exact: true })
        .count(),
      0,
    );
  });
  await preview.close();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge);
  const page = await context.newPage();
  await page.clock.install();
  const errors = [],
    requests = [];
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE');
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(host.url);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Continuar sem conta' }).click();
  const click = async (name) =>
    page.getByRole('button', { name, exact: true }).click();
  const locked = async () => {
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    assert.equal(await page.getByText(NAME, { exact: false }).count(), 0);
    assert.equal(await page.locator('#workspace-name').count(), 0);
  };
  const unlock = async (pin) => {
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(pin);
    await click('Desbloquear');
  };
  const spaces = async () =>
    page
      .getByRole('heading', { name: 'Seus espaços locais', exact: true })
      .waitFor();
  await step('optional_default_and_clear_policy', async () => {
    await page.getByLabel('Nome do espaço').waitFor();
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: 'Bloquear agora', exact: true })
        .count(),
      0,
    );
    await click('Privacidade local');
    await page
      .getByRole('heading', { name: 'Privacidade local', exact: true })
      .waitFor();
    for (const text of [
      /PIN opcional desativado/,
      /não há redefinição/,
      /reiniciar, voltar à entrada ou perder o foco/,
      /cinco erros/,
      /Biometria indisponível/,
    ])
      await page.getByText(text).waitFor();
    await page.getByLabel('Novo PIN', { exact: true }).fill(PIN);
    await page.getByLabel('Confirme o novo PIN').fill(PIN);
    await click('Ativar PIN');
    await page.getByText('PIN configurado.', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Novo PIN', { exact: true }).inputValue(),
      '',
    );
    await click('Voltar aos espaços locais');
    await page.getByLabel('Nome do espaço').fill(NAME);
    await click('Criar espaço local');
    await page
      .getByRole('heading', {
        name: 'Seu espaço local está pronto',
        exact: true,
      })
      .waitFor();
  });
  await step('manual_lock_and_exit_hide_workspace', async () => {
    await click('Bloquear agora');
    await locked();
    await unlock(PIN);
    await spaces();
    await page.getByRole('button', { name: new RegExp(NAME) }).click();
    await page
      .getByRole('heading', {
        name: 'Seu espaço local está pronto',
        exact: true,
      })
      .waitFor();
    await page.evaluate(() => {
      window.__syntheticWorkspace.failLockNext = true;
    });
    await click('Voltar à entrada');
    await click('Continuar sem conta');
    await locked();
  });
  await step('wrong_pin_and_throttle_preserve_closed_view', async () => {
    for (let n = 0; n < 5; n++) {
      await unlock(SECOND);
      await page
        .getByRole('alert')
        .filter({ hasText: 'PIN incorreto' })
        .waitFor();
      await locked();
      assert.equal(
        await page
          .getByLabel('PIN do aplicativo', { exact: true })
          .inputValue(),
        '',
      );
    }
    await page.getByText(/Aguarde 30 segundos e tente novamente/).waitFor();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      1,
    );
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await page.evaluate(() => {
      window.__syntheticWorkspace.retry = 0;
    });
    await page.clock.fastForward(31_000);
  });
  await step('late_unlock_reply_after_blur_discarded', async () => {
    await page.evaluate(() => {
      window.__syntheticWorkspace.holdUnlock = true;
    });
    await unlock(PIN);
    await page.waitForFunction(() =>
      Boolean(window.__syntheticWorkspace.releaseUnlock),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await locked();
    await page.evaluate(() => window.__syntheticWorkspace.releaseUnlock());
    await page.waitForTimeout(150);
    await locked();
    assert.equal(
      await page.getByLabel('PIN do aplicativo', { exact: true }).inputValue(),
      '',
    );
    await page.evaluate(() => {
      window.__syntheticWorkspace.holdUnlock = false;
      window.__syntheticWorkspace.locked = true;
    });
  });
  await step('enable_change_disable_clear_pins', async () => {
    await unlock(PIN);
    await spaces();
    await click('Privacidade local');
    await page.getByLabel('PIN atual', { exact: true }).fill(PIN);
    await page.getByLabel('Novo PIN', { exact: true }).fill(SECOND);
    await page.getByLabel('Confirme o novo PIN').fill(SECOND);
    await click('Alterar PIN');
    await page.getByText('PIN configurado.', { exact: true }).waitFor();
    for (const field of await page.locator('input[type=password]').all())
      assert.equal(await field.inputValue(), '');
    await page.getByLabel('PIN atual para desativar').fill(PIN);
    await click('Desativar PIN');
    await page
      .getByRole('alert')
      .filter({ hasText: 'PIN incorreto' })
      .waitFor();
    await locked();
    await unlock(SECOND);
    await spaces();
    await click('Privacidade local');
    await page.getByLabel('PIN atual para desativar').fill(SECOND);
    await click('Desativar PIN');
    await page
      .getByText('Proteção por PIN desativada.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Novo PIN', { exact: true }).inputValue(),
      '',
    );
  });
  await step('accessible_locked_settings_and_responsive', async () => {
    stage = 'settings_axe';
    const audit = await new AxeBuilder({ page }).analyze();
    assert.equal(audit.violations.length, 0);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    stage = 'settings_reflow';
    await page.screenshot({
      path: fileURLToPath(new URL('reflow.png', directory)),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.emulateMedia({ forcedColors: 'active' });
    stage = 'settings_forced_colors_focus';
    await page.getByLabel('Novo PIN', { exact: true }).focus();
    assert.equal(await page.locator(':focus').getAttribute('id'), 'new-pin');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({
      path: fileURLToPath(new URL('layout.png', directory)),
      fullPage: true,
    });
  });
  await step('no_storage_egress_or_errors', async () => {
    assert.deepEqual(errors, []);
    assert.ok(
      requests.every((url) => url.startsWith(new URL(host.url).origin + '/')),
    );
    assert.deepEqual(
      await page.evaluate(async () => [
        localStorage.length,
        sessionStorage.length,
        (await indexedDB.databases()).length,
      ]),
      [0, 0, 0],
    );
  });
  report.passed = true;
} catch {
  report.passed = false;
  process.exitCode = 1;
  console.error('US033_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = lockHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateLockEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
