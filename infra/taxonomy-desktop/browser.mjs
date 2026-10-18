/* global document,window,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticTaxonomyHost, workspace, other, now } from './fixture.mjs';
import {
  desktopTaxonomyHashes,
  pending,
  validateDesktopTaxonomyEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us045-desktop-taxonomy/',
    import.meta.url,
  ),
  PIN = '721947350682',
  h = syntheticTaxonomyHost();
const report = {
  format_version: 2,
  scope: 'us045-desktop-taxonomy-browser',
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
  console.log('US045 taxonomy browser: ' + name);
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
        display_name: 'SYNTHETIC US045 A',
        purpose: 'PERSONAL',
        storage_mode: 'LOCAL',
        default_currency: 'BRL',
        created_at: now,
      },
      {
        id: other,
        display_name: 'SYNTHETIC US045 B',
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
    '__syntheticTaxonomyHost',
    async (command, args) => {
      try {
        if (command === 'read_local_taxonomy') {
          const value = h.snapshot(args.workspaceId);
          if (holdRead) {
            holdRead = false;
            await new Promise((r) => {
              releaseRead = r;
            });
          }
          return { value };
        }
        intents.push(JSON.stringify(args.input));
        const result = await h.apply(args.workspaceId, args.input),
          value = {
            changed: result.changed,
            item_ids: result.item_ids,
            categories: result.categories,
            items: result.items,
          };
        if (holdSave) {
          holdSave = false;
          saveReached = true;
          await new Promise((r) => {
            releaseSave = r;
          });
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
    open = async () => {
      await click('Configurações');
      await click('Gerenciar subcategorias e tags');
      await heading('Subcategorias e tags');
    },
    create = async (kind, name) => {
      await click('Criar ' + kind);
      await page.getByLabel('Nome do item', { exact: true }).fill(name);
      await click('Salvar item');
      await page
        .getByRole('button', { name: 'Editar ' + name, exact: true })
        .waitFor();
    },
    unlock = async () => {
      await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
      await click('Desbloquear');
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
    await page.getByRole('button', { name: /SYNTHETIC US045 A/ }).click();
    await open();
  });
  await step('create_search_and_parent_immutable', async () => {
    await create('subcategoria', 'SYNTHETIC FIRST');
    await create('subcategoria', 'SYNTHETIC SECOND');
    await create('tag', 'Férias');
    await page
      .getByLabel('Pesquisar subcategorias e tags', { exact: true })
      .fill(' ＦÉＲＩＡＳ ');
    assert.equal(await page.locator('.category-row').count(), 1);
    await page
      .getByLabel('Pesquisar subcategorias e tags', { exact: true })
      .fill('');
    await click('Editar SYNTHETIC FIRST');
    assert.equal(
      await page
        .getByLabel('Categoria da subcategoria', { exact: true })
        .count(),
      0,
    );
    await click('Cancelar edição');
    assert.equal(h.snapshot(workspace).items.length, 3);
  });
  await step('archive_reactivate_and_active_order', async () => {
    await click('Descer SYNTHETIC FIRST');
    await page.waitForFunction(() =>
      document
        .querySelectorAll('.category-row')[0]
        ?.textContent.includes('SYNTHETIC SECOND'),
    );
    await click('Arquivar SYNTHETIC FIRST');
    await page
      .getByRole('button', { name: 'Reativar SYNTHETIC FIRST', exact: true })
      .waitFor();
    await page
      .getByLabel('Filtrar estado dos itens', { exact: true })
      .selectOption('ACTIVE');
    assert.equal(
      await page
        .getByRole('button', { name: 'Editar SYNTHETIC FIRST', exact: true })
        .count(),
      0,
    );
    await page
      .getByLabel('Filtrar estado dos itens', { exact: true })
      .selectOption('ALL');
    await click('Reativar SYNTHETIC FIRST');
    await page
      .getByRole('button', { name: 'Arquivar SYNTHETIC FIRST', exact: true })
      .waitFor();
  });
  await step('lost_ack_reuses_frozen_create_id', async () => {
    await click('Criar tag');
    await page
      .getByLabel('Nome do item', { exact: true })
      .fill('SYNTHETIC RETRY');
    loseAck = true;
    await click('Salvar item');
    await page
      .getByRole('button', { name: 'Repetir mesma tentativa', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Nome do item', { exact: true }).isDisabled(),
      true,
    );
    await click('Repetir mesma tentativa');
    await page
      .getByRole('button', { name: 'Editar SYNTHETIC RETRY', exact: true })
      .waitFor();
    assert.equal(intents.at(-1), intents.at(-2));
    assert.equal(
      h.snapshot(workspace).items.filter((r) => r.name === 'SYNTHETIC RETRY')
        .length,
      1,
    );
  });
  await step('normalized_name_conflict_and_explicit_review', async () => {
    await click('Criar tag');
    await page.getByLabel('Nome do item', { exact: true }).fill(' férias ');
    await click('Salvar item');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Já existe um item ativo' })
      .waitFor();
    assert.equal(h.snapshot(workspace).items.length, 4);
    await click('Atualizar catálogo');
    await page
      .getByRole('button', { name: 'Editar Férias', exact: true })
      .waitFor();
  });
  await step('stale_base_is_not_rebased', async () => {
    await click('Editar SYNTHETIC FIRST');
    const base = h
      .snapshot(workspace)
      .items.find((r) => r.name === 'SYNTHETIC FIRST');
    await h.apply(workspace, {
      kind: 'UPDATE',
      base,
      item: { ...base, name: 'SYNTHETIC EXTERNAL' },
    });
    await page
      .getByLabel('Nome do item', { exact: true })
      .fill('SYNTHETIC STALE');
    await click('Salvar item');
    await page
      .getByRole('alert')
      .filter({ hasText: 'O catálogo mudou' })
      .waitFor();
    assert.equal(
      h.snapshot(workspace).items.find((r) => r.id === base.id).name,
      'SYNTHETIC EXTERNAL',
    );
    await click('Atualizar catálogo');
  });
  await step('workspace_switch_drops_late_catalog', async () => {
    holdRead = true;
    await click('Atualizar catálogo');
    await page.locator('.fm-workspace select').selectOption(other);
    await heading('Seu espaço local está pronto');
    releaseRead();
    await open();
    assert.equal(
      await page.getByText('SYNTHETIC EXTERNAL', { exact: true }).count(),
      0,
    );
    assert.equal(h.snapshot(other).items.length, 0);
    await create('tag', 'SYNTHETIC OTHER');
    await page.locator('.fm-workspace select').selectOption(workspace);
    await heading('Seu espaço local está pronto');
    await open();
    assert.equal(
      await page.getByText('SYNTHETIC OTHER', { exact: true }).count(),
      0,
    );
  });
  await step('lock_and_late_save_remove_taxonomy_tree', async () => {
    await click('Criar tag');
    await page
      .getByLabel('Nome do item', { exact: true })
      .fill('SYNTHETIC LATE');
    holdSave = true;
    saveReached = false;
    await click('Salvar item');
    assert.equal(saveReached, true);
    await click('Bloquear agora');
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    assert.equal(await page.locator('.taxonomy-flow').count(), 0);
    releaseSave();
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByText('SYNTHETIC LATE', { exact: true }).count(),
      0,
    );
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US045 A/ }).click();
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
      await click('Criar tag');
      await page.getByLabel('Nome do item', { exact: true }).focus();
      assert.equal(
        await page
          .getByLabel('Nome do item', { exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
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
      await page.screenshot({
        path: fileURLToPath(new URL('layout.png', directory)),
        fullPage: true,
      });
    },
  );
  report.passed = true;
} catch {
  console.error('US045_TAXONOMY_BROWSER_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  releaseRead?.();
  releaseSave?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopTaxonomyHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopTaxonomyEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
