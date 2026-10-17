/* global setTimeout,window,document,Event,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import {
  restoreHashes,
  pending,
  validateRestoreEvidence,
} from './evidence.mjs';
const directory = new URL('../../.tools/us035-restore/', import.meta.url),
  PIN = '721947350682',
  PASSWORD = 'SYNTHETIC restore password US035',
  NAME = 'SYNTHETIC existing US035';
const row = {
  id: '0199d035-0000-7000-8000-000000000011',
  display_name: NAME,
  purpose: 'PERSONAL',
  storage_mode: 'LOCAL',
  default_currency: 'BRL',
  created_at: '2026-10-17T00:00:00.000Z',
};
const report = {
  format_version: 1,
  scope: 'us035-restore-browser',
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
  console.log('US-035 browser: ' + name);
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
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click();
  await click('Continuar sem conta');
  const locked = async () => {
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('SYNTHETIC backup source', { exact: false }).count(),
      0,
    );
    assert.equal(await page.locator('#restore-password').count(), 0);
  };
  const unlock = async () => {
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
    await click('Desbloquear');
  };
  const select = async () => {
    await click('Restaurar backup');
    await locked();
    await unlock();
    await page
      .getByLabel('Senha original do backup', { exact: true })
      .waitFor();
  };
  const fill = async (password = PASSWORD) => {
    await page
      .getByLabel('Senha original do backup', { exact: true })
      .fill(password);
    await click('Validar e apresentar prévia');
  };
  const preview = async () => {
    await select();
    await fill();
    await page
      .getByRole('heading', { name: 'Prévia da restauração', exact: true })
      .waitFor();
  };
  await step(
    'preview_requires_native_without_browser_persistence',
    async () => {
      await locked();
      const plain = await browser.newPage();
      await plain.goto(host.url);
      await plain
        .getByRole('button', { name: 'Continuar sem conta', exact: true })
        .click();
      assert.equal(
        await plain
          .getByRole('button', { name: 'Restaurar backup', exact: true })
          .count(),
        0,
      );
      await plain.close();
      const off = await browser.newContext();
      await off.addInitScript(installSyntheticWorkspaceBridge, { rows: [row] });
      const p = await off.newPage();
      await p.goto(host.url);
      await off.setOffline(true);
      await p
        .getByRole('button', { name: 'Continuar sem conta', exact: true })
        .click();
      await p
        .getByRole('button', { name: 'Restaurar backup', exact: true })
        .click();
      await p
        .getByLabel('Senha original do backup', { exact: true })
        .fill(PASSWORD);
      await p
        .getByRole('button', {
          name: 'Validar e apresentar prévia',
          exact: true,
        })
        .click();
      await p
        .getByRole('heading', { name: 'Prévia da restauração', exact: true })
        .waitFor();
      await p.getByRole('checkbox').check();
      await p
        .getByRole('button', {
          name: 'Restaurar como novo espaço',
          exact: true,
        })
        .click();
      await p.getByText('Restauração concluída.', { exact: false }).waitFor();
      assert.equal(
        await p
          .getByRole('heading', {
            name: 'Nenhuma conta financeira cadastrada',
            exact: true,
          })
          .count(),
        0,
      );
      await off.close();
      await page.bringToFront();
    },
  );
  await step('picker_locks_pin_and_original_secret_policy', async () => {
    await unlock();
    await select();
    assert.ok(
      (await page.locator('body').innerText()).includes(
        'PIN e Windows Hello não recuperam',
      ),
    );
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Validar e apresentar prévia',
          exact: true,
        })
        .isDisabled(),
      true,
    );
  });
  await step('wrong_secret_clears_fields_without_publication', async () => {
    await fill('SYNTHETIC incorrect secret');
    await page
      .getByText('Senha incorreta ou pacote adulterado.', { exact: false })
      .waitFor();
    assert.equal(await page.locator('#restore-password').inputValue(), '');
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      1,
    );
  });
  await step('canceled_preview_and_late_reply_discarded', async () => {
    await fill();
    await page
      .getByRole('heading', { name: 'Prévia da restauração', exact: true })
      .waitFor();
    await page.evaluate(() => {
      const state = window.__syntheticWorkspace,
        original = window.__TAURI_INTERNALS__.invoke;
      state.originalCancelInvoke = original;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'cancel_local_restore')
          await new Promise((resolve) => {
            state.releaseCancel = resolve;
          });
        return original(command, args);
      };
    });
    await click('Cancelar restauração');
    await page.waitForFunction(
      () => typeof window.__syntheticWorkspace.releaseCancel === 'function',
    );
    await page.locator('.local-list li').first().waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Restaurar backup', exact: true })
        .count(),
      0,
    );
    await page.evaluate(() => {
      const state = window.__syntheticWorkspace;
      state.releaseCancel();
      window.__TAURI_INTERNALS__.invoke = state.originalCancelInvoke;
      delete state.originalCancelInvoke;
      delete state.releaseCancel;
    });
    await page
      .getByRole('button', { name: 'Restaurar backup', exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.restorePrepared),
      false,
    );
    await select();
    await page.evaluate(() => {
      window.__syntheticWorkspace.holdRestore = true;
    });
    await fill();
    await page
      .getByRole('heading', { name: 'Processando restauração', exact: true })
      .waitFor();
    assert.equal(await page.locator('#restore-password').count(), 0);
    assert.equal(await page.getByText(NAME, { exact: false }).count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await locked();
    await page.evaluate(async () => {
      window.__syntheticWorkspace.releaseRestore();
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.__syntheticWorkspace.holdRestore = false;
    });
    await locked();
    await unlock();
  });
  await step('lost_ack_retries_same_restore_without_duplicate', async () => {
    await preview();
    await page.evaluate(() => {
      window.__syntheticWorkspace.loseRestoreAck = true;
    });
    await page.getByRole('checkbox').check();
    await click('Restaurar como novo espaço');
    await page
      .getByText('Não foi possível validar ou concluir a restauração.', {
        exact: false,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      2,
    );
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command === 'confirm_local_restore')
          window.__syntheticWorkspace.locked = true;
        return result;
      };
    });
    await page.getByRole('checkbox').check();
    await click('Restaurar como novo espaço');
    await page.getByText('Restauração concluída.', { exact: false }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      2,
    );
    await locked();
    await unlock();
    await page
      .getByRole('button', { name: 'Ver espaços locais', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('heading', {
          name: 'Nenhuma conta financeira cadastrada',
          exact: true,
        })
        .count(),
      0,
    );
  });
  await step(
    'verified_preview_counts_ack_and_new_local_workspace',
    async () => {
      assert.ok(
        (await page.locator('body').innerText()).includes('(restaurado)'),
      );
      await click('Ver espaços locais');
      await preview();
      assert.equal(
        await page
          .getByRole('button', {
            name: 'Restaurar como novo espaço',
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.locator('dt').filter({ hasText: 'Contas' }).count(),
        1,
      );
      assert.equal(
        await page.getByText('Revisões históricas', { exact: true }).count(),
        1,
      );
      assert.equal(
        await page.evaluate(() => window.__syntheticWorkspace.rows.length),
        2,
      );
      assert.equal(
        (await new AxeBuilder({ page }).analyze()).violations.length,
        0,
      );
      await click('Cancelar restauração');
    },
  );
  await step('accessible_responsive_forced_colors', async () => {
    await select();
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
    await page.getByLabel('Senha original do backup', { exact: true }).focus();
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'restore-password',
    );
    await page.emulateMedia({ forcedColors: 'none' });
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
  console.error('US035_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = restoreHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateRestoreEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
