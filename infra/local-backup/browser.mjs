/* global window,document,Event,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { backupHashes, pending, validateBackupEvidence } from './evidence.mjs';
const directory = new URL('../../.tools/us034-backup/', import.meta.url),
  PIN = '721947350682',
  PASSWORD = 'SYNTHETIC backup password US034',
  NAME = 'SYNTHETIC US034 PRIVATE SPACE';
const row = {
  id: '0199d034-0000-7000-8000-000000000001',
  display_name: NAME,
  purpose: 'PERSONAL',
  storage_mode: 'LOCAL',
  default_currency: 'BRL',
  created_at: '2026-10-17T00:00:00.000Z',
};
const report = {
  format_version: 1,
  scope: 'us034-backup-browser',
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
  console.log('US-034 browser: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge, {
    pin: PIN,
    rows: [row],
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE');
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(host.url);
  await context.setOffline(true);
  await page
    .getByRole('button', { name: 'Continuar sem conta', exact: true })
    .click();
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click();
  const locked = async () => {
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    assert.equal(await page.getByText(NAME, { exact: false }).count(), 0);
    assert.equal(await page.locator('#backup-password').count(), 0);
  };
  const open = async () => {
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
    await click('Desbloquear');
    await page.getByRole('button', { name: new RegExp(NAME) }).click();
    await click('Backup local');
    await page
      .getByRole('heading', { name: 'Backup local', exact: true })
      .waitFor();
  };
  const fill = async () => {
    await page.getByLabel('Senha do backup', { exact: true }).fill(PASSWORD);
    await page
      .getByLabel('Confirme a senha do backup', { exact: true })
      .fill(PASSWORD);
    await page.getByRole('checkbox').check();
  };
  await step('native_only_backup_entry_and_clear_policy', async () => {
    const preview = await browser.newPage();
    await preview.goto(host.url);
    await preview
      .getByRole('button', { name: 'Continuar sem conta', exact: true })
      .click();
    assert.equal(
      await preview
        .getByRole('button', { name: 'Backup local', exact: true })
        .count(),
      0,
    );
    await preview.close();
    const noPin = await browser.newContext();
    await noPin.addInitScript(installSyntheticWorkspaceBridge, { rows: [row] });
    const plain = await noPin.newPage();
    await plain.goto(host.url);
    await noPin.setOffline(true);
    await plain
      .getByRole('button', { name: 'Continuar sem conta', exact: true })
      .click();
    await plain.getByRole('button', { name: new RegExp(NAME) }).click();
    await plain
      .getByRole('button', { name: 'Backup local', exact: true })
      .click();
    await plain.getByLabel('Senha do backup', { exact: true }).fill(PASSWORD);
    await plain
      .getByLabel('Confirme a senha do backup', { exact: true })
      .fill(PASSWORD);
    await plain.getByRole('checkbox').check();
    await plain
      .getByRole('button', { name: 'Criar backup criptografado', exact: true })
      .click();
    await plain
      .getByRole('status')
      .filter({ hasText: 'Backup criptografado criado e verificado' })
      .waitFor();
    await plain
      .getByRole('heading', { name: 'Seus espaços locais', exact: true })
      .waitFor();
    await noPin.close();
    await page.bringToFront();
    await locked();
    await open();
    for (const text of [
      /não será guardada pelo aplicativo/,
      /Guarde-a separadamente/,
      /não são substituídos/,
      /serviço receberá o pacote criptografado/,
      /64 MiB/,
      /Restauração como novo espaço/,
    ])
      await page.getByText(text).waitFor();
  });
  await step('recovery_password_confirmation_and_acknowledgement', async () => {
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Criar backup criptografado',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page.getByLabel('Senha do backup', { exact: true }).fill(PASSWORD);
    await page
      .getByLabel('Confirme a senha do backup', { exact: true })
      .fill('SYNTHETIC different password');
    await page.getByRole('checkbox').check();
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Criar backup criptografado',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel('Confirme a senha do backup', { exact: true })
      .fill(PASSWORD);
    await page.getByRole('checkbox').uncheck();
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Criar backup criptografado',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page.getByRole('checkbox').check();
  });
  await step('owned_dialog_hides_data_and_clears_passwords', async () => {
    await page.evaluate(() => {
      window.__syntheticWorkspace.holdBackup = true;
    });
    await click('Criar backup criptografado');
    await page.waitForFunction(() =>
      Boolean(window.__syntheticWorkspace.releaseBackup),
    );
    await page
      .getByRole('heading', { name: 'Criando backup', exact: true })
      .waitFor();
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await page.getByText(NAME, { exact: false }).count(), 0);
    const calls = await page.evaluate(
      () => window.__syntheticWorkspace.calls.length,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.calls.length),
      calls,
    );
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await page.evaluate(() => {
      window.__syntheticWorkspace.releaseBackup();
      window.__syntheticWorkspace.holdBackup = false;
    });
  });
  await step('verified_success_and_cancellation_keep_pin_locked', async () => {
    await page
      .getByRole('status')
      .filter({ hasText: 'Backup criptografado criado e verificado' })
      .waitFor();
    await locked();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.savedBackups),
      1,
    );
    await open();
    await fill();
    await page.evaluate(() => {
      window.__syntheticWorkspace.backupOutcome = 'CANCELED';
    });
    await click('Criar backup criptografado');
    await page
      .getByRole('status')
      .filter({ hasText: 'Criação de backup cancelada' })
      .waitFor();
    await locked();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.savedBackups),
      1,
    );
  });
  await step('sanitized_error_and_late_reply_after_cancel', async () => {
    await open();
    await fill();
    await page.evaluate(() => {
      window.__syntheticWorkspace.backupError =
        'SYNTHETIC_PRIVATE_PATH_KEY_OR_SQL';
    });
    await click('Criar backup criptografado');
    await page.getByRole('alert').waitFor();
    await locked();
    assert.equal(
      (await page.locator('body').innerText()).includes('SYNTHETIC_PRIVATE'),
      false,
    );
    await open();
    await fill();
    await page.evaluate(() => {
      window.__syntheticWorkspace.backupError = null;
      window.__syntheticWorkspace.backupOutcome = 'CREATED';
      window.__syntheticWorkspace.holdBackup = true;
      window.__syntheticWorkspace.releaseBackup = null;
    });
    await click('Criar backup criptografado');
    await page.waitForFunction(() =>
      Boolean(window.__syntheticWorkspace.releaseBackup),
    );
    await click('Cancelar solicitação de backup');
    await locked();
    await page.evaluate(() => {
      window.__syntheticWorkspace.releaseBackup();
      window.__syntheticWorkspace.holdBackup = false;
    });
    await page.waitForTimeout(150);
    await locked();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.savedBackups),
      1,
    );
  });
  await step('accessible_responsive_and_forced_colors', async () => {
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await open();
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.emulateMedia({ forcedColors: 'active' });
    await page.getByLabel('Senha do backup', { exact: true }).focus();
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'backup-password',
    );
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({
      path: fileURLToPath(new URL('layout.png', directory)),
      fullPage: true,
    });
  });
  await step('no_storage_egress_or_runtime_errors', async () => {
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
  console.error('US034_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = backupHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateBackupEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
