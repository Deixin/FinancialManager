/* global window,localStorage,sessionStorage,indexedDB,document */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticImportHost, workspace, other, now } from './fixture.mjs';
import { hashes, pending, validateEvidence } from './evidence.mjs';
const directory = new URL(
    '../../.tools/us050-desktop-imports/',
    import.meta.url,
  ),
  h = syntheticImportHost(),
  PIN = '721947350682';
const report = {
  format_version: 1,
  scope: 'us050-desktop-imports-browser',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: { node: process.versions.node },
  pending,
};
let host,
  browser,
  stage = 'startup',
  lose = false,
  bad = false,
  hold = false,
  release,
  reached;
const intents = [];
async function step(name, run) {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US050 browser: ' + name);
}
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge, {
    pin: PIN,
    rows: [workspace, other].map((id, n) => ({
      id,
      display_name: 'SYNTHETIC IMPORT SPACE ' + n,
      purpose: 'PERSONAL',
      storage_mode: 'LOCAL',
      default_currency: 'BRL',
      created_at: now,
    })),
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith(host.url)) requests.push(r.url());
  });
  await page.exposeFunction('__syntheticAccountHost', async (_c, a) => ({
    value: h.financial.read(a.workspaceId).balance,
  }));
  await page.exposeFunction('__syntheticMovementHost', async (_c, a) => {
    const value = h.financial.read(a.workspaceId);
    if (!a.includeClassification) delete value.classification;
    return { value };
  });
  await page.exposeFunction('__syntheticImportHost', async (c, a) => {
    try {
      if (c === 'prepare_local_import') intents.push(JSON.stringify(a.input));
      const value = await h.call(c, a);
      if (hold && c === 'prepare_local_import') {
        hold = false;
        reached?.();
        await new Promise((r) => {
          release = r;
        });
      }
      if (c === 'prepare_local_import' && lose) {
        lose = false;
        throw Error('SYNTHETIC_LOST_ACK');
      }
      if (c === 'prepare_local_import' && bad) {
        bad = false;
        return { value: { ...value, created: true, counts: {} } };
      }
      return { value };
    } catch (e) {
      return { error: e.code ?? 'STORAGE_UNAVAILABLE' };
    }
  });
  const click = (name) =>
      page.getByRole('button', { name, exact: true }).click(),
    heading = (name) =>
      page.getByRole('heading', { name, exact: true }).waitFor();
  await page.goto(host.url);
  await click('Continuar sem conta');
  await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
  await click('Desbloquear');
  await page.getByRole('button', { name: /SYNTHETIC IMPORT SPACE 0/ }).click();
  await click('Importações');
  await step('filters_detail_and_history_links', async () => {
    await page
      .getByLabel('Estado do lote', { exact: true })
      .selectOption('COMMITTED');
    await page
      .getByRole('button', { name: /Concluído.*SYNTHETIC-extrato/ })
      .click();
    await heading('Detalhes do lote');
    assert.ok(
      (await page.locator('main').textContent()).includes('2026-01-31'),
    );
    await click('Ver movimentação e histórico');
    await page.getByText(/Descrição original:/).waitFor();
    await click('Importações');
    await page.getByLabel('Conta de destino', { exact: true }).waitFor();
  });
  await step('lost_ack_and_malformed_ack_keep_frozen_intent', async () => {
    await page
      .getByLabel('Conta de destino', { exact: true })
      .selectOption(h.account);
    lose = true;
    await click('Preparar lote');
    await page
      .getByRole('button', { name: 'Repetir mesmo pedido', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Conta de destino', { exact: true }).isDisabled(),
      true,
    );
    bad = true;
    await click('Repetir mesmo pedido');
    await page.getByRole('alert').waitFor();
    await click('Repetir mesmo pedido');
    await heading('Detalhes do lote');
    assert.equal(new Set(intents.slice(-3)).size, 1);
    await click('Voltar aos lotes');
  });
  await step('workspace_switch_discards_late_write', async () => {
    await page
      .getByLabel('Conta de destino', { exact: true })
      .selectOption(h.account);
    hold = true;
    const ready = new Promise((r) => {
      reached = r;
    });
    await click('Preparar lote');
    await ready;
    await page.locator('.fm-workspace select').selectOption(other);
    release();
    await heading('Seu espaço local está pronto');
    await click('Importações');
    await page
      .getByText('Nenhum lote encontrado para estes filtros.', { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('heading', { name: 'Detalhes do lote', exact: true })
        .count(),
      0,
    );
  });
  await step('lock_discards_late_write_and_private_tree', async () => {
    await page.locator('.fm-workspace select').selectOption(workspace);
    await heading('Seu espaço local está pronto');
    await click('Importações');
    await page
      .getByLabel('Conta de destino', { exact: true })
      .selectOption(h.account);
    hold = true;
    const ready = new Promise((r) => {
      reached = r;
    });
    await click('Preparar lote');
    await ready;
    await click('Bloquear agora');
    release();
    await page
      .getByRole('button', { name: 'Desbloquear', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Conta de destino', { exact: true }).count(),
      0,
    );
  });
  await step('accessibility_reflow_no_storage_egress_or_errors', async () => {
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
    await click('Desbloquear');
    await page
      .getByRole('button', { name: /SYNTHETIC IMPORT SPACE 0/ })
      .click();
    await heading('Seu espaço local está pronto');
    await click('Importações');
    await page.getByLabel('Conta de destino', { exact: true }).waitFor();
    const axe = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(axe.violations, []);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    assert.deepEqual(
      await page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        indexed: (await indexedDB.databases()).length,
      })),
      { local: 0, session: 0, indexed: 0 },
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  });
  report.passed = true;
} catch (error) {
  writeFileSync(new URL('browser-diagnostic.log', directory), String(error));
  report.passed = false;
  report.failure_stage = stage;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = hashes();
  if (report.passed) validateEvidence(report);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
