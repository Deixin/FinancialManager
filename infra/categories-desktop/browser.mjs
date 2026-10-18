/* global document,window,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticCategoryHost, workspace, other, now } from './fixture.mjs';
import {
  desktopCategoryHashes,
  pending,
  validateDesktopCategoryEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us044-desktop-categories/',
    import.meta.url,
  ),
  PIN = '721947350682',
  h = syntheticCategoryHost(),
  report = {
    format_version: 1,
    scope: 'us044-desktop-categories-browser',
    passed: false,
    synthetic_only: true,
    checks: {},
    versions: { node: process.versions.node },
    pending,
  };
let host,
  browser,
  stage = 'startup',
  loseAck = false,
  holdRead = false,
  releaseRead,
  holdSave = false,
  releaseSave,
  saveReached = false;
const intents = [];
const step = async (name, run) => {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US044 category browser: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge, {
    pin: PIN,
    rows: [
      {
        id: workspace,
        display_name: 'SYNTHETIC US044 A',
        purpose: 'PERSONAL',
        storage_mode: 'LOCAL',
        default_currency: 'BRL',
        created_at: now,
      },
      {
        id: other,
        display_name: 'SYNTHETIC US044 B',
        purpose: 'BUSINESS',
        storage_mode: 'LOCAL',
        default_currency: 'BRL',
        created_at: now,
      },
    ],
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  await page.exposeFunction(
    '__syntheticCategoryHost',
    async (command, args) => {
      try {
        if (command === 'read_local_categories') {
          const value = h.snapshot(args.workspaceId);
          if (holdRead) {
            holdRead = false;
            await new Promise((r) => (releaseRead = r));
          }
          return { value };
        }
        intents.push(JSON.stringify(args.input));
        const value = await h.apply(args.workspaceId, args.input);
        if (holdSave) {
          holdSave = false;
          saveReached = true;
          await new Promise((r) => (releaseSave = r));
        }
        if (loseAck) {
          loseAck = false;
          return { error: 'STORAGE_UNAVAILABLE' };
        }
        return { value };
      } catch (e) {
        return { error: e.code ?? 'STORAGE_UNAVAILABLE' };
      }
    },
  );
  page.on('pageerror', (e) => errors.push(e));
  page.on('request', (r) => {
    if (!r.url().startsWith(host.url)) requests.push(r.url());
  });
  await page.goto(host.url);
  const click = (name) =>
      page.getByRole('button', { name, exact: true }).click(),
    heading = (name) =>
      page.getByRole('heading', { name, exact: true }).waitFor(),
    unlock = async () => {
      await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
      await click('Desbloquear');
    },
    open = async () => {
      await click('Configurações');
      await click('Gerenciar categorias');
      await heading('Suas categorias');
    };
  await click('Continuar sem conta');
  await step('native_only_without_browser_vault', async () => {
    const preview = await browser.newPage();
    await preview.goto(host.url);
    await preview
      .getByRole('button', { name: 'Continuar sem conta', exact: true })
      .click();
    assert.equal(
      await preview
        .getByRole('button', { name: 'Criar espaço local', exact: true })
        .isDisabled(),
      true,
    );
    await preview.close();
    await page.bringToFront();
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US044 A/ }).click();
    await open();
  });
  await step('purpose_seed_once_and_edit_keeps_provenance', async () => {
    await page.getByText('Salário', { exact: false }).first().waitFor();
    await click('Usar categorias sugeridas');
    await page.locator('.category-row').nth(8).waitFor();
    assert.equal(h.snapshot(workspace).categories.length, 9);
    await click('Editar Alimentação');
    await page
      .getByLabel('Nome da categoria', { exact: true })
      .fill('SYNTHETIC RENAMED');
    await click('Salvar categoria');
    await page
      .getByRole('button', { name: 'Editar SYNTHETIC RENAMED', exact: true })
      .waitFor();
    assert.equal(
      h
        .snapshot(workspace)
        .categories.find((r) => r.name === 'SYNTHETIC RENAMED').is_seeded,
      true,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Usar categorias sugeridas', exact: true })
        .count(),
      0,
    );
  });
  await step('archive_reactivate_and_active_order', async () => {
    await click('Arquivar SYNTHETIC RENAMED');
    await page
      .getByRole('button', { name: 'Reativar SYNTHETIC RENAMED', exact: true })
      .waitFor();
    await click('Reativar SYNTHETIC RENAMED');
    await page
      .getByRole('button', { name: 'Arquivar SYNTHETIC RENAMED', exact: true })
      .waitFor();
    await click('Descer SYNTHETIC RENAMED');
    await page.waitForFunction(() =>
      document
        .querySelectorAll('.category-row')[1]
        ?.textContent.includes('SYNTHETIC RENAMED'),
    );
    assert.equal(
      h
        .snapshot(workspace)
        .categories.find((r) => r.name === 'SYNTHETIC RENAMED').sort_order,
      1,
    );
  });
  await step('lost_ack_reuses_frozen_create_id', async () => {
    await click('Nova categoria');
    await page
      .getByLabel('Nome da categoria', { exact: true })
      .fill('SYNTHETIC MANUAL');
    loseAck = true;
    await click('Salvar categoria');
    await page
      .getByRole('button', { name: 'Repetir mesma tentativa', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Nome da categoria', { exact: true }).isDisabled(),
      true,
    );
    await click('Repetir mesma tentativa');
    await page
      .getByRole('button', { name: 'Editar SYNTHETIC MANUAL', exact: true })
      .waitFor();
    assert.equal(intents.at(-1), intents.at(-2));
    assert.equal(
      h
        .snapshot(workspace)
        .categories.filter((r) => r.name === 'SYNTHETIC MANUAL').length,
      1,
    );
    assert.equal(
      h
        .snapshot(workspace)
        .categories.find((r) => r.name === 'SYNTHETIC MANUAL').is_seeded,
      false,
    );
  });
  await step('normalized_name_conflict_and_explicit_review', async () => {
    await click('Nova categoria');
    await page
      .getByLabel('Nome da categoria', { exact: true })
      .fill(' ＳＡＬÁＲＩＯ ');
    await click('Salvar categoria');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Já existe uma categoria ativa' })
      .waitFor();
    assert.equal(h.snapshot(workspace).categories.length, 10);
    await click('Atualizar catálogo e revisar');
    await heading('Suas categorias');
  });
  await step('stale_base_is_not_rebased', async () => {
    await click('Editar SYNTHETIC RENAMED');
    const row = h
      .snapshot(workspace)
      .categories.find((r) => r.name === 'SYNTHETIC RENAMED');
    await h.apply(workspace, {
      kind: 'UPDATE',
      base: row,
      name: 'SYNTHETIC EXTERNAL',
      status: row.status,
      sort_order: row.sort_order,
    });
    await page
      .getByLabel('Nome da categoria', { exact: true })
      .fill('SYNTHETIC STALE');
    await click('Salvar categoria');
    await page
      .getByRole('alert')
      .filter({ hasText: 'O catálogo mudou' })
      .waitFor();
    assert.equal(
      h.snapshot(workspace).categories.find((r) => r.id === row.id).name,
      'SYNTHETIC EXTERNAL',
    );
    await click('Atualizar catálogo e revisar');
    await heading('Suas categorias');
  });
  await step(
    'workspace_switch_drops_late_catalog_and_business_defaults',
    async () => {
      holdRead = true;
      await click('Atualizar catálogo');
      await page.locator('.fm-workspace select').selectOption(other);
      await heading('Seu espaço local está pronto');
      releaseRead();
      await open();
      await page.getByText('Fornecedores', { exact: false }).first().waitFor();
      assert.equal(
        await page.getByText('SYNTHETIC EXTERNAL', { exact: true }).count(),
        0,
      );
      await click('Usar categorias sugeridas');
      await page.locator('.category-row').nth(8).waitFor();
      assert.ok(h.snapshot(other).categories.some((r) => r.name === 'Vendas'));
      assert.equal(h.snapshot(workspace).categories.length, 10);
      await page.locator('.fm-workspace select').selectOption(workspace);
      await heading('Seu espaço local está pronto');
      await open();
    },
  );
  await step('lock_and_late_save_remove_category_tree', async () => {
    await click('Nova categoria');
    await page
      .getByLabel('Nome da categoria', { exact: true })
      .fill('SYNTHETIC LATE');
    holdSave = true;
    saveReached = false;
    await click('Salvar categoria');
    assert.equal(saveReached, true);
    await click('Bloquear agora');
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    assert.equal(await page.locator('.category-flow').count(), 0);
    releaseSave();
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByText('SYNTHETIC LATE', { exact: true }).count(),
      0,
    );
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US044 A/ }).click();
    await open();
  });
  await step(
    'accessibility_reflow_forced_colors_no_storage_or_egress',
    async () => {
      assert.equal(
        (await new AxeBuilder({ page }).analyze()).violations.length,
        0,
      );
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(
        () => (document.documentElement.style.fontSize = '200%'),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page.emulateMedia({ forcedColors: 'active' });
      await click('Nova categoria');
      await page.getByLabel('Nome da categoria', { exact: true }).focus();
      assert.equal(
        await page.locator(':focus').getAttribute('id'),
        'category-name',
      );
      assert.deepEqual(
        await page.evaluate(async () => [
          localStorage.length,
          sessionStorage.length,
          (await indexedDB.databases()).length,
        ]),
        [0, 0, 0],
      );
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
    },
  );
  report.passed = true;
} catch {
  console.error('US044_CATEGORY_BROWSER_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  releaseRead?.();
  releaseSave?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopCategoryHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopCategoryEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
