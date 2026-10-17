/* global Event */
/* global innerWidth */
/* global document,navigator,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from './browser-fixture.mjs';
import {
  workspaceHashes,
  validateWorkspaceEvidence,
  pending,
} from './evidence.mjs';
const directory = new URL('../../.tools/us031-workspaces/', import.meta.url);
const report = {
  format_version: 1,
  scope: 'us031-local-workspace-browser',
  passed: false,
  checks: {},
  versions: { node: process.versions.node },
  pending,
};
let browser,
  host,
  stage = 'startup';
const step = async (name, run) => {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US-031 check: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const preview = await browser.newPage();
  await preview.goto(host.url);
  await preview.getByRole('button', { name: 'Continuar sem conta' }).click();
  await step('preview_refuses_fake_persistence', async () => {
    await preview.getByText(/Esta visualização não salva dados/).waitFor();
    assert.equal(
      await preview
        .getByRole('button', { name: 'Criar espaço local' })
        .isDisabled(),
      true,
    );
  });
  await preview.close();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge);
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('CONSOLE');
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(host.url);
  await step('offline_local_form_without_identity', async () => {
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Continuar sem conta' }).click();
    await page
      .getByRole('heading', { name: 'Primeiro espaço', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('input[type=email],input[type=password]').count(),
      0,
    );
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    await page.getByLabel('Nome do espaço').waitFor();
  });
  await step('required_name_and_purpose', async () => {
    assert.equal(
      await page
        .getByRole('button', { name: 'Criar espaço local' })
        .isDisabled(),
      true,
    );
    assert.equal(await page.getByLabel('Finalidade').inputValue(), 'PERSONAL');
    await page.getByLabel('Nome do espaço').fill('SYNTHETIC <img src=x> FIRST');
    await page.getByLabel('Finalidade').selectOption('BUSINESS');
  });
  await step('single_submit_and_real_result_handoff', async () => {
    await page.evaluate(() => {
      globalThis.__syntheticWorkspace.hold = true;
    });
    await page.getByRole('button', { name: 'Criar espaço local' }).click();
    await page
      .locator('form')
      .evaluate((form) =>
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
      );
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.__syntheticWorkspace.calls.filter(
            (name) => name === 'create_local_workspace',
          ).length,
      ),
      1,
    );
    await page.evaluate(() => globalThis.__syntheticWorkspace.release());
    await page
      .getByRole('heading', { name: 'Seu espaço local está pronto' })
      .waitFor();
    assert.equal(
      await page
        .getByRole('heading', { name: 'Nenhuma conta financeira cadastrada' })
        .count(),
      1,
    );
    assert.equal(await page.getByText('R$', { exact: false }).count(), 0);
  });
  await step('reopen_local_and_preserve_name_as_text', async () => {
    await page.getByRole('button', { name: 'Voltar à entrada' }).click();
    await page.getByRole('button', { name: 'Continuar sem conta' }).click();
    await page
      .getByRole('button', { name: /SYNTHETIC <img src=x> FIRST/ })
      .click();
    await page
      .getByRole('heading', { name: 'Seu espaço local está pronto' })
      .waitFor();
    assert.equal(await page.locator('img').count(), 0);
    await page.getByRole('button', { name: 'Ver espaços locais' }).click();
  });
  await step('sanitized_failure_and_lost_ack_recovery', async () => {
    const fresh = await browser.newContext();
    await fresh.addInitScript(installSyntheticWorkspaceBridge);
    const failed = await fresh.newPage();
    await failed.goto(host.url);
    await failed.getByRole('button', { name: 'Continuar sem conta' }).click();
    await failed.getByLabel('Nome do espaço').fill('SYNTHETIC ACK');
    await failed.evaluate(() => {
      globalThis.__syntheticWorkspace.failNext = true;
    });
    await failed.getByRole('button', { name: 'Criar espaço local' }).click();
    await failed.getByRole('alert').waitFor();
    assert.equal(
      (await failed.locator('body').innerText()).includes('SYNTHETIC_PRIVATE'),
      false,
    );
    await failed.evaluate(() => {
      globalThis.__syntheticWorkspace.loseAck = true;
    });
    await failed.getByRole('button', { name: 'Criar espaço local' }).click();
    await failed.getByRole('alert').waitFor();
    await failed
      .getByRole('button', { name: 'Verificar espaços locais' })
      .click();
    await failed.getByRole('button', { name: /SYNTHETIC ACK/ }).waitFor();
    assert.equal(
      await failed.evaluate(() => globalThis.__syntheticWorkspace.rows.length),
      1,
    );
    await fresh.close();
  });
  await step('accessible_form_list_and_overview', async () => {
    await context.setOffline(false);
    const list = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    assert.equal(list.violations.length, 0);
    await page
      .getByRole('button', { name: /SYNTHETIC <img src=x> FIRST/ })
      .click();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    assert.equal(result.violations.length, 0);
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
  });
  await step('no_web_storage_or_remote_requests', async () => {
    assert.deepEqual(errors, []);
    assert.ok(requests.every((url) => url.startsWith(host.url)));
    assert.deepEqual(
      await page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        dbs: (await indexedDB.databases()).length,
        cookie: document.cookie,
      })),
      { local: 0, session: 0, dbs: 0, cookie: '' },
    );
  });
  report.passed = true;
} catch {
  process.exitCode = 1;
  console.error('US031_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  try {
    await browser?.close();
    await host?.close();
    report.resources_closed = true;
  } catch {
    report.passed = false;
    process.exitCode = 1;
  }
  report.source_sha256 = workspaceHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateWorkspaceEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
