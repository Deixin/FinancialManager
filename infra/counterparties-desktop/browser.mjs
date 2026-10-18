/* global document,window,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import {
  syntheticCounterpartyHost,
  workspace,
  other,
  id,
  now,
} from './fixture.mjs';
import {
  desktopCounterpartyHashes,
  pending,
  validateDesktopCounterpartyEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us047-desktop-counterparties/',
    import.meta.url,
  ),
  PIN = '721947350682',
  h = syntheticCounterpartyHost();
const report = {
  format_version: 1,
  scope: 'us047-desktop-counterparties-browser',
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
  badAck = false,
  hold = false,
  release,
  reached;
const intents = [],
  reads = [];
async function step(name, run) {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US047 counterparties browser: ' + name);
}
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
      display_name: 'SYNTHETIC COUNTERPARTY SPACE ' + n,
      purpose: 'PERSONAL',
      storage_mode: 'LOCAL',
      default_currency: 'BRL',
      created_at: now,
    })),
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  await page.exposeFunction('__syntheticMovementHost', async (_c, args) => {
    const s = h.read(args.workspaceId);
    if (!args.includeClassification) delete s.classification;
    return { value: s };
  });
  await page.exposeFunction(
    '__syntheticCounterpartyHost',
    async (command, args) => {
      try {
        if (command === 'read_local_counterparties') {
          reads.push(args.workspaceId);
          return {
            value: args.includeMovements
              ? h.full(args.workspaceId)
              : h.snapshot(args.workspaceId),
          };
        }
        intents.push(JSON.stringify(args.input));
        const value =
          command === 'apply_local_counterparty_change'
            ? h.change(args.workspaceId, args.input)
            : await h.apply(args.workspaceId, args.input);
        if (hold) {
          hold = false;
          reached?.();
          await new Promise((r) => {
            release = r;
          });
        }
        if (loseAck) {
          loseAck = false;
          return { error: 'STORAGE_UNAVAILABLE' };
        }
        if (badAck) {
          badAck = false;
          return {
            value: {
              entries: value.entries.map((r) => ({ ...r, version: '999' })),
            },
          };
        }
        return { value };
      } catch (e) {
        return { error: e.code ?? 'STORAGE_UNAVAILABLE' };
      }
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
    status = (text) =>
      page.getByRole('status').filter({ hasText: text }).waitFor(),
    select = () => page.getByLabel('Escolha da contraparte', { exact: true });
  const catalog = async () => {
    await click('Configurações');
    await click('Gerenciar contrapartes');
    await heading('Gerenciar contrapartes');
    await page
      .getByRole('button', { name: 'Nova contraparte', exact: true })
      .waitFor();
  };
  const edit = async (n) => {
    if (
      await page
        .getByRole('heading', { name: 'Editar contraparte', exact: true })
        .count()
    )
      await click('Voltar sem nova gravação');
    await click('Movimentações');
    await heading('Suas movimentações');
    await page.getByLabel('Data inicial', { exact: true }).fill('2020-01-01');
    await page
      .getByRole('button', {
        name: new RegExp('SYNTHETIC (?:RESULT|CARD SIDE) ' + n + ' —'),
      })
      .first()
      .click();
    await click('Editar contraparte');
    await select().waitFor();
  };
  await page.goto(host.url);
  await click('Continuar sem conta');
  await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
  await click('Desbloquear');
  await page
    .getByRole('button', { name: /SYNTHETIC COUNTERPARTY SPACE 0/ })
    .click();
  await step('catalog_homonyms_identifiers_archive_search', async () => {
    await catalog();
    await click('Nova contraparte');
    await page
      .getByLabel('Nome da contraparte', { exact: true })
      .fill('SYNTHETIC Café 900');
    await page
      .getByLabel('Tipo de identificador', { exact: true })
      .selectOption('CPF');
    await page.getByLabel('Identificador', { exact: true }).fill('00000000000');
    await click('Salvar cadastro');
    await status('Cadastro salvo.');
    assert.equal(
      h.catalogs
        .get(workspace)
        .filter((r) => r.display_name === 'SYNTHETIC Café 900').length,
      2,
    );
    await page.getByLabel('Buscar contraparte', { exact: true }).fill('cafe');
    await status('3 contraparte');
    await page
      .getByRole('button', { name: 'Editar SYNTHETIC Café 901', exact: true })
      .click();
    await page
      .getByLabel('Estado do cadastro', { exact: true })
      .selectOption('ACTIVE');
    await click('Salvar cadastro');
    await status('Cadastro salvo.');
    await page
      .getByLabel('Estado das contrapartes', { exact: true })
      .selectOption('ARCHIVED');
    await status('0 contraparte');
  });
  await step('lost_ack_frozen_retry_original_and_history', async () => {
    await edit(100);
    const before = h.read(workspace).transactions.find((r) => r.id === id(100));
    await select().selectOption(id(900));
    loseAck = true;
    await click('Salvar contraparte');
    await click('Repetir mesma tentativa');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Os dados mudaram' })
      .waitFor();
    assert.equal(intents.at(-1), intents.at(-2));
    assert.equal(await select().isDisabled(), true);
    await click('Consultar resultado e revisar');
    await select().waitFor();
    const after = h.read(workspace).transactions.find((r) => r.id === id(100));
    assert.deepEqual(after.content, {
      ...before.content,
      counterparty_id: id(900),
    });
    assert.equal(after.version, '2');
    await click('Salvar contraparte');
    await status('sem nova revisão');
    await select().selectOption('CLEAR');
    await click('Salvar contraparte');
    await status('Histórico atualizado');
    assert.equal(
      h.read(workspace).transactions.find((r) => r.id === id(100)).content
        .counterparty_id,
      null,
    );
  });
  await step(
    'archived_reference_review_and_full_group_partner_noop',
    async () => {
      for (const [n, partner] of [
        [104, 105],
        [107, 108],
      ]) {
        await edit(n);
        const before = h
          .read(workspace)
          .transactions.find((r) => r.id === id(partner));
        await select().selectOption(id(900));
        await click('Salvar contraparte');
        await status('Histórico atualizado');
        assert.deepEqual(
          h.read(workspace).transactions.find((r) => r.id === id(partner)),
          before,
        );
      }
      await edit(101);
      await select().selectOption(id(900));
      h.catalogs.get(workspace).find((r) => r.id === id(900)).status =
        'ARCHIVED';
      await click('Salvar contraparte');
      await page
        .getByRole('alert')
        .filter({ hasText: 'foi arquivada' })
        .waitFor();
      assert.equal(await select().isDisabled(), true);
      await click('Consultar resultado e revisar');
      await select().waitFor();
      assert.equal(
        await select()
          .locator('option[value="' + id(900) + '"]')
          .count(),
        0,
      );
      h.catalogs.get(workspace).find((r) => r.id === id(900)).status = 'ACTIVE';
    },
  );
  await step('malformed_ack_keeps_intent_and_explicit_review', async () => {
    await edit(102);
    await select().selectOption(id(900));
    badAck = true;
    await click('Salvar contraparte');
    await page
      .getByRole('button', { name: 'Repetir mesma tentativa', exact: true })
      .waitFor();
    assert.equal(await select().isDisabled(), true);
    await click('Consultar resultado e revisar');
    await select().waitFor();
  });
  await step('workspace_switch_discards_late_write_reply', async () => {
    await select().selectOption('CLEAR');
    hold = true;
    const signal = new Promise((r) => {
      reached = r;
    });
    await click('Salvar contraparte');
    await signal;
    const count = reads.length;
    await page.locator('.fm-workspace select').selectOption(other);
    await heading('Seu espaço local está pronto');
    release();
    await page.waitForTimeout(100);
    assert.equal(reads.length, count);
    assert.equal(
      await page
        .getByRole('heading', { name: 'Editar contraparte', exact: true })
        .count(),
      0,
    );
  });
  await step('lock_discards_late_write_reply_and_private_tree', async () => {
    await page.locator('.fm-workspace select').selectOption(workspace);
    await heading('Seu espaço local está pronto');
    await edit(101);
    await select().selectOption(id(900));
    hold = true;
    const signal = new Promise((r) => {
      reached = r;
    });
    await click('Salvar contraparte');
    await signal;
    const count = reads.length;
    await click('Bloquear agora');
    await heading('Aplicativo bloqueado');
    release();
    await page.waitForTimeout(100);
    assert.equal(reads.length, count);
    assert.equal(await page.getByText(/SYNTHETIC Café/).count(), 0);
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
    await click('Desbloquear');
    await page
      .getByRole('button', { name: /SYNTHETIC COUNTERPARTY SPACE 0/ })
      .click();
  });
  await step('keyboard_accessibility_reflow_no_storage_or_egress', async () => {
    await catalog();
    await click('Nova contraparte');
    await page.keyboard.press('Tab');
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
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
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    await page.screenshot({
      path: fileURLToPath(new URL('layout.png', directory)),
    });
  });
  report.passed = true;
} catch (e) {
  console.error(
    String(e.stack)
      .split('\n')
      .filter((l) => l.includes('infra/counterparties-desktop/browser.mjs'))
      .join('\n'),
  );
  console.error('US047_COUNTERPARTIES_BROWSER_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page)
    await page.screenshot({
      path: fileURLToPath(new URL('failure.png', directory)),
    });
} finally {
  release?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopCounterpartyHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopCounterpartyEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
