/* global document,window,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import {
  syntheticClassificationSnapshot,
  workspace,
  other,
  id,
  now,
} from './fixture.mjs';
import {
  classificationFilterHashes,
  pending,
  validateClassificationFilterEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us045-desktop-classification-filters/',
    import.meta.url,
  ),
  PIN = '721947350682',
  report = {
    format_version: 2,
    scope: 'us045-desktop-classification-filters-browser',
    passed: false,
    synthetic_only: true,
    checks: {},
    versions: { node: process.versions.node },
    pending,
  };
let host,
  browser,
  stage = 'startup',
  hold = false,
  release,
  reached,
  readReached = false,
  fault = '';
const step = async (name, run) => {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US045 filters browser: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge, {
    pin: PIN,
    rows: [workspace, other].map((w, n) => ({
      id: w,
      display_name: 'SYNTHETIC FILTER SPACE ' + n,
      purpose: 'PERSONAL',
      storage_mode: 'LOCAL',
      default_currency: 'BRL',
      created_at: now,
    })),
  });
  const page = await context.newPage(),
    errors = [],
    requests = [],
    calls = [];
  await page.exposeFunction(
    '__syntheticMovementHost',
    async (command, args) => {
      assert.equal(command, 'read_local_movements');
      calls.push(args);
      const value = syntheticClassificationSnapshot(args.workspaceId);
      if (!args.includeClassification) {
        delete value.classification;
        return { value };
      }
      if (hold) {
        hold = false;
        readReached = true;
        reached?.();
        await new Promise((r) => {
          release = r;
        });
      }
      if (fault === 'limit') return { error: 'MOVEMENT_LIMIT' };
      if (fault === 'invalid') delete value.classification;
      return { value };
    },
  );
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('request', (r) => {
    if (!r.url().startsWith(host.url)) requests.push('EXTERNAL');
  });
  const click = (name) =>
      page.getByRole('button', { name, exact: true }).click(),
    heading = (name) =>
      page.getByRole('heading', { name, exact: true }).waitFor(),
    open = async () => {
      await click('Movimentações');
      await heading('Suas movimentações');
      await click('Filtrar por classificação');
      await heading('Filtrar movimentações por classificação');
      await page
        .locator('.classification-results')
        .waitFor({ state: 'attached' });
    },
    count = async (n) =>
      assert.equal(
        await page.locator('.classification-results > li').count(),
        n,
      ),
    choose = async (w) => {
      await page.locator('.fm-workspace select').selectOption(w);
      await heading('Seu espaço local está pronto');
    },
    unlock = async () => {
      await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
      await click('Desbloquear');
    };
  await page.goto(host.url);
  await click('Continuar sem conta');
  await step('native_only_complete_snapshot', async () => {
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
    await page
      .getByRole('button', { name: /SYNTHETIC FILTER SPACE 0/ })
      .click();
    await open();
    await count(6);
    assert.ok(calls.some((r) => r.includeClassification === true));
  });
  await step('same_allocation_and_archived_references', async () => {
    await page
      .getByLabel('Categoria da consulta', { exact: true })
      .selectOption(id(10));
    await count(2);
    assert.equal(
      await page
        .locator('#classification-subcategory option[value="' + id(21) + '"]')
        .count(),
      0,
    );
    await page
      .getByLabel('Subcategoria da consulta', { exact: true })
      .selectOption(id(20));
    await count(2);
    await page
      .getByLabel('Categoria da consulta', { exact: true })
      .selectOption(id(12));
    await page
      .getByLabel('Subcategoria da consulta', { exact: true })
      .selectOption(id(22));
    await count(1);
    assert.match(
      await page.locator('.classification-results').innerText(),
      /SYNTHETIC RESULT 106/,
    );
  });
  await step('overlapping_tags_any_all_and_unclassified', async () => {
    await click('Limpar critérios');
    await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).check();
    await page.getByLabel('SYNTHETIC TAG 31', { exact: true }).check();
    await count(4);
    await page
      .getByLabel('Combinação de tags', { exact: true })
      .selectOption('ALL');
    await count(1);
    await click('Limpar critérios');
    await page
      .getByLabel('Somente sem classificação monetária', { exact: true })
      .check();
    await count(3);
    assert.equal(
      await page
        .getByLabel('Categoria da consulta', { exact: true })
        .isDisabled(),
      true,
    );
    await page.getByLabel('SYNTHETIC TAG 31', { exact: true }).check();
    await count(1);
  });
  await step('dates_accounts_and_exact_details', async () => {
    await click('Limpar critérios');
    await page
      .getByLabel('Conta da consulta', { exact: true })
      .selectOption(id(3));
    await count(1);
    await click('Limpar critérios');
    await page.getByLabel('A partir de', { exact: true }).fill('2026-01-01');
    await count(1);
    await page.getByRole('button', { name: /SYNTHETIC RESULT 106/ }).click();
    await heading('Classificação da movimentação');
    assert.match(
      await page.locator('.classification-filters-flow').innerText(),
      /90\.071\.992\.547\.409,93/,
    );
    assert.match(
      await page.locator('.classification-filters-flow').innerText(),
      /SYNTHETIC SUB 22/,
    );
    assert.match(
      await page.locator('.classification-filters-flow').innerText(),
      /SYNTHETIC COLLISION TAG 12/,
    );
    await click('Voltar aos resultados');
    await count(1);
    await page.getByLabel('Até a data', { exact: true }).fill('2020-01-01');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.classification-results').count(), 0);
    await click('Limpar critérios');
  });
  await step(
    'invalid_and_over_limit_reads_show_no_partial_results',
    async () => {
      for (const kind of ['invalid', 'limit']) {
        fault = kind;
        await click('Atualizar consulta de classificação');
        await page.getByRole('alert').waitFor();
        if (kind === 'invalid')
          assert.match(
            await page.getByRole('alert').innerText(),
            /Não foi possível consultar a classificação/,
          );
        assert.equal(await page.locator('.classification-results').count(), 0);
      }
      fault = '';
      await click('Atualizar consulta de classificação');
      await page
        .locator('.classification-results')
        .waitFor({ state: 'attached' });
      await count(6);
    },
  );
  await step('workspace_change_discards_late_read', async () => {
    hold = true;
    readReached = false;
    const started = new Promise((resolve) => {
      reached = resolve;
    });
    await click('Atualizar consulta de classificação');
    await started;
    assert.equal(readReached, true);
    await choose(other);
    release();
    await open();
    await count(0);
    assert.equal(
      await page.getByText('SYNTHETIC RESULT 106', { exact: false }).count(),
      0,
    );
    await choose(workspace);
    await open();
  });
  await step('lock_discards_late_read', async () => {
    hold = true;
    readReached = false;
    const started = new Promise((resolve) => {
      reached = resolve;
    });
    await click('Atualizar consulta de classificação');
    await started;
    assert.equal(readReached, true);
    await click('Bloquear agora');
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    release();
    assert.equal(await page.locator('.classification-filters-flow').count(), 0);
    await unlock();
    await page
      .getByRole('button', { name: /SYNTHETIC FILTER SPACE 0/ })
      .click();
    await open();
    await count(6);
  });
  await step(
    'keyboard_accessibility_reflow_and_no_persistence_or_egress',
    async () => {
      assert.equal(
        (await new AxeBuilder({ page }).analyze()).violations.length,
        0,
      );
      await page.getByLabel('Categoria da consulta', { exact: true }).focus();
      assert.equal(
        await page
          .getByLabel('Categoria da consulta', { exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
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
      await page
        .locator('.classification-filters-flow h2')
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: fileURLToPath(new URL('layout.png', directory)),
        fullPage: false,
      });
    },
  );
  report.passed = true;
} catch (error) {
  console.error(
    String(error.stack)
      .split('\n')
      .filter((line) =>
        line.includes('infra/classification-filters-desktop/browser.mjs'),
      )
      .join('\n'),
  );
  console.error('US045_FILTER_BROWSER_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  release?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = classificationFilterHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateClassificationFilterEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
