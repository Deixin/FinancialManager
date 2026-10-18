/* global window,document,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import {
  managerHashes,
  pending,
  validateManagerEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us036-workspace-manager/',
    import.meta.url,
  ),
  PIN = '721947350682';
const rows = Array.from({ length: 12 }, (_, index) => ({
  id: '0199d036-0000-7000-8000-' + String(index + 1).padStart(12, '0'),
  display_name: 'SYNTHETIC US036 SPACE ' + String(index + 1).padStart(2, '0'),
  purpose: index % 2 ? 'BUSINESS' : 'PERSONAL',
  storage_mode: 'LOCAL',
  default_currency: 'BRL',
  created_at: '2026-10-17T12:00:00.000Z',
}));
const report = {
  format_version: 10,
  scope: 'us036-workspace-manager-browser',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: { node: process.versions.node },
  pending,
};
let host,
  browser,
  stage = 'startup';
const step = async (name, fn) => {
  stage = name;
  await fn();
  report.checks[name] = true;
  console.log('US-036 browser: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge, {
    rows,
    pin: PIN,
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
  const unlock = async () => {
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
    await click('Desbloquear');
  };
  const open = async (index) => {
    await page
      .getByRole('button', { name: new RegExp(rows[index].display_name) })
      .click();
    await page.getByLabel('Espaço ativo', { exact: true }).waitFor();
  };
  const create = async (name, purpose) => {
    await click('Criar outro espaço local');
    await page.getByLabel('Nome do espaço', { exact: true }).fill(name);
    await page.getByLabel('Finalidade', { exact: true }).selectOption(purpose);
    await click('Criar espaço local');
  };
  await step('native_only_multiple_workspace_policy', async () => {
    const p = await browser.newPage();
    await p.goto(host.url);
    await p
      .getByRole('button', { name: 'Continuar sem conta', exact: true })
      .click();
    assert.equal(
      await p
        .getByRole('button', { name: 'Criar espaço local', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await p
        .getByRole('button', { name: 'Criar outro espaço local', exact: true })
        .count(),
      0,
    );
    await p.close();
    await page.bringToFront();
    await unlock();
  });
  await step(
    'unlimited_catalog_with_purpose_and_local_cloud_filter',
    async () => {
      await page.locator('.local-list li').last().waitFor();
      assert.equal(await page.locator('.local-list li').count(), 12);
      assert.equal(
        (await page.getByText('Empresa', { exact: false }).count()) > 0,
        true,
      );
      await page
        .getByLabel('Armazenamento', { exact: true })
        .selectOption('cloud');
      assert.equal(await page.locator('.local-list li').count(), 0);
      await page
        .getByText('Espaços na nuvem exigem conta', { exact: false })
        .waitFor();
      await page
        .getByLabel('Armazenamento', { exact: true })
        .selectOption('local');
      await open(0);
      assert.equal(
        await page
          .getByLabel('Espaço ativo', { exact: true })
          .locator('option')
          .count(),
        12,
      );
      assert.match(
        await page
          .getByLabel('Espaço ativo', { exact: true })
          .locator('option')
          .first()
          .innerText(),
        /Local.*Pessoal/,
      );
    },
  );
  await step('create_multiple_fresh_intents_and_cancel', async () => {
    await click('Criar outro espaço local');
    await page
      .getByRole('heading', { name: 'Novo espaço local', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Nome do espaço', { exact: true }).inputValue(),
      '',
    );
    assert.equal(
      await page.getByLabel('Finalidade', { exact: true }).inputValue(),
      'PERSONAL',
    );
    await page
      .getByLabel('Nome do espaço', { exact: true })
      .fill('SYNTHETIC CANCELED DRAFT');
    await click('Cancelar criação');
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      12,
    );
    await create('SYNTHETIC US036 NEW A', 'BUSINESS');
    await page.getByLabel('Espaço ativo', { exact: true }).waitFor();
    await create('SYNTHETIC US036 NEW B', 'PERSONAL');
    await page.getByLabel('Espaço ativo', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => new Set(window.__syntheticWorkspace.rows.map((r) => r.id)).size,
      ),
      14,
    );
    assert.equal(
      await page
        .getByLabel('Espaço ativo', { exact: true })
        .locator('option')
        .count(),
      14,
    );
  });
  await step('lost_ack_repeats_frozen_request_without_duplicate', async () => {
    await page.evaluate(() => {
      window.__syntheticWorkspace.loseAck = true;
    });
    await create('SYNTHETIC US036 LOST ACK', 'BUSINESS');
    await page.getByRole('alert').waitFor();
    assert.equal(
      await page.getByLabel('Nome do espaço', { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel('Finalidade', { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      15,
    );
    await click('Criar espaço local');
    await page.getByLabel('Espaço ativo', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__syntheticWorkspace.rows.length),
      15,
    );
  });
  await step('switch_removes_old_tree_and_resets_route', async () => {
    await page
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Configurações do espaço', exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.__syntheticWorkspace.holdOpen = true;
    });
    await page
      .getByLabel('Espaço ativo', { exact: true })
      .selectOption(rows[1].id);
    assert.equal(await page.locator('.fm-shell').count(), 0);
    assert.equal(
      await page
        .getByText('Nome: SYNTHETIC US036 LOST ACK', { exact: true })
        .count(),
      0,
    );
    await page.evaluate(() => {
      window.__syntheticWorkspace.releaseOpen();
      window.__syntheticWorkspace.holdOpen = false;
    });
    await page
      .getByRole('heading', {
        name: 'Seu espaço local está pronto',
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByLabel('Espaço ativo', { exact: true }).inputValue(),
      rows[1].id,
    );
    await page.evaluate(() => {
      window.__syntheticWorkspace.failOpenNext = true;
    });
    await page
      .getByLabel('Espaço ativo', { exact: true })
      .selectOption(rows[0].id);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.fm-shell').count(), 0);
    await page.evaluate(() => {
      window.__syntheticWorkspace.failListNext = true;
    });
    await click('Verificar espaços locais');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.local-list li').count(), 0);
    assert.equal(
      await page.getByLabel('Nome do espaço', { exact: true }).count(),
      0,
    );
    await click('Verificar espaços locais');
    await page.locator('.local-list li').last().waitFor();
    await open(1);
  });
  await step('native_lock_failure_clears_cached_catalog', async () => {
    await page.evaluate(() => {
      window.__syntheticWorkspace.lockOpenNext = true;
    });
    await page
      .getByLabel('Espaço ativo', { exact: true })
      .selectOption(rows[0].id);
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('SYNTHETIC', { exact: false }).count(),
      0,
    );
    assert.equal(await page.locator('.local-list li').count(), 0);
    await unlock();
  });
  await step('restored_initial_workspace_has_full_selector', async () => {
    await click('Bloquear agora');
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    const other = await browser.newContext();
    await other.addInitScript(installSyntheticWorkspaceBridge, { rows });
    const p = await other.newPage();
    await p.goto(host.url);
    await other.setOffline(true);
    await p
      .getByRole('button', { name: 'Continuar sem conta', exact: true })
      .click();
    await p
      .getByRole('button', { name: 'Restaurar backup', exact: true })
      .click();
    await p
      .getByLabel('Senha original do backup', { exact: true })
      .fill('SYNTHETIC restore password US035');
    await p
      .getByRole('button', { name: 'Validar e apresentar prévia', exact: true })
      .click();
    await p
      .getByRole('heading', { name: 'Prévia da restauração', exact: true })
      .waitFor();
    await p.getByRole('checkbox').check();
    await p
      .getByRole('button', { name: 'Restaurar como novo espaço', exact: true })
      .click();
    await p.getByLabel('Espaço ativo', { exact: true }).waitFor();
    assert.equal(
      await p
        .getByLabel('Espaço ativo', { exact: true })
        .locator('option')
        .count(),
      13,
    );
    await other.close();
    await page.bringToFront();
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    await unlock();
  });
  await step('accessible_responsive_and_forced_colors', async () => {
    await open(0);
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await click('Gerenciar espaços locais');
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await click('Criar outro espaço local');
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
    await page.getByLabel('Nome do espaço', { exact: true }).focus();
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'workspace-name',
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
  console.error('US036_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = managerHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateManagerEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
