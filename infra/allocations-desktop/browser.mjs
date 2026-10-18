/* global document,window,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import {
  syntheticAllocationHost,
  workspace,
  other,
  id,
  now,
} from './fixture.mjs';
import {
  desktopAllocationHashes,
  pending,
  validateDesktopAllocationEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us046-desktop-allocations/',
    import.meta.url,
  ),
  PIN = '721947350682',
  h = syntheticAllocationHost(),
  report = {
    format_version: 1,
    scope: 'us046-desktop-allocations-browser',
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
  stale = false,
  archive = '',
  badAck = false,
  hold = false,
  release,
  reached;
const intents = [],
  reads = [];
const step = async (name, run) => {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US046 allocations browser: ' + name);
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
      display_name: 'SYNTHETIC EDIT SPACE ' + n,
      purpose: 'PERSONAL',
      storage_mode: 'LOCAL',
      default_currency: 'BRL',
      created_at: now,
    })),
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  await page.exposeFunction(
    '__syntheticMovementHost',
    async (command, args) => {
      if (command !== 'read_local_movements')
        throw Error('SYNTHETIC_UNEXPECTED_COMMAND');
      reads.push(args.workspaceId);
      const value = h.read(args.workspaceId);
      if (!args.includeClassification) delete value.classification;
      return { value };
    },
  );
  await page.exposeFunction('__syntheticAllocationHost', async (args) => {
    intents.push(JSON.stringify(args.input));
    try {
      if (stale) {
        stale = false;
        const c = args.input[0],
          base = h
            .read(args.workspaceId)
            .transactions.find((r) => r.id === c.base.id);
        await h.apply(args.workspaceId, [
          { base, allocation: { kind: 'CLEAR' } },
        ]);
      }
      if (archive) {
        h.data
          .get(args.workspaceId)
          .classification.categories.find((r) => r.id === archive).status =
          'ARCHIVED';
        archive = '';
      }
      const value = await h.apply(args.workspaceId, args.input);
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
  });
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
      await page
        .locator('.classification-results')
        .waitFor({ state: 'attached' });
    },
    edit = async (n) => {
      await page
        .getByRole('button', {
          name: new RegExp('SYNTHETIC (?:RESULT|CARD SIDE) ' + n + ' —'),
        })
        .first()
        .click();
      await click('Editar rateio');
      await heading('Editar rateio');
      await page.locator('.classification-editor form').waitFor();
    },
    back = async () => {
      await click('Voltar aos resultados');
      await page
        .locator('.classification-results')
        .waitFor({ state: 'attached' });
    },
    saved = () =>
      page
        .getByRole('button', { name: 'Voltar aos resultados', exact: true })
        .waitFor(),
    unlock = async () => {
      await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
      await click('Desbloquear');
    },
    choose = async (w) => {
      await page.locator('.fm-workspace select').selectOption(w);
      await heading('Seu espaço local está pronto');
    };
  await page.goto(host.url);
  await click('Continuar sem conta');

  const mode = () => page.getByLabel('Ação sobre o rateio', { exact: true });
  const fillRow = async (n, cat, amount, note = null, sub = null) => {
    await page
      .getByLabel('Categoria da parcela ' + n, { exact: true })
      .selectOption(id(cat));
    await page
      .getByLabel('Valor da parcela ' + n, { exact: true })
      .fill(amount);
    if (note !== null)
      await page.getByLabel('Nota da parcela ' + n, { exact: true }).fill(note);
    if (sub !== null)
      await page
        .getByLabel('Subcategoria da parcela ' + n, { exact: true })
        .selectOption(id(sub));
  };
  const addSplit = async () => {
    await mode().selectOption('REPLACE');
    await click('Adicionar parcela');
    await click('Adicionar parcela');
    await fillRow(1, 10, '0,40', 'SYNTHETIC PARCEL NOTE', 20);
    await fillRow(2, 11, '0,60');
  };
  const save = async () => {
    await click('Salvar rateio');
    await saved();
  };
  await step('native_only_exact_split_and_import_origin', async () => {
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
    await page.getByRole('button', { name: /SYNTHETIC EDIT SPACE 0/ }).click();
    await open();
    await edit(102);
    const before = h.read(workspace).transactions.find((r) => r.id === id(102));
    await addSplit();
    await page.getByLabel('Valor da parcela 2', { exact: true }).fill('0,59');
    assert.equal(
      await page
        .getByRole('button', { name: 'Salvar rateio', exact: true })
        .isDisabled(),
      true,
    );
    await page.getByText('Diferença: R$ 0,01').waitFor();
    await page.getByLabel('Valor da parcela 2', { exact: true }).fill('0,60');
    await save();
    const after = h.read(workspace).transactions.find((r) => r.id === id(102));
    assert.equal(after.content.allocations.length, 2);
    assert.equal(after.content.origin_kind, 'IMPORT');
    for (const key of Object.keys(before.content).filter(
      (k) => k !== 'allocations',
    ))
      assert.deepEqual(after.content[key], before.content[key]);
  });
  await step('lost_ack_frozen_identity_explicit_review', async () => {
    await click('Editar rateio');
    await mode().selectOption('REPLACE');
    await page
      .getByLabel('Nota da parcela 1', { exact: true })
      .fill('SYNTHETIC LOST ACK NOTE');
    loseAck = true;
    await click('Salvar rateio');
    await page
      .getByRole('button', { name: 'Repetir mesma tentativa', exact: true })
      .waitFor();
    assert.equal(await mode().isDisabled(), true);
    const first = intents.at(-1);
    await click('Repetir mesma tentativa');
    await page
      .getByText(/A base mudou ou esta tentativa já foi registrada/)
      .waitFor();
    assert.equal(intents.at(-1), first);
    await click('Consultar resultado e revisar');
    await saved();
    assert.equal(
      h.read(workspace).transactions.find((r) => r.id === id(102)).version,
      '3',
    );
  });
  await step('stale_base_and_archived_reference_review', async () => {
    await back();
    await edit(101);
    await mode().selectOption('REPLACE');
    await page
      .getByLabel('Nota da parcela 1', { exact: true })
      .fill('SYNTHETIC STALE');
    stale = true;
    await click('Salvar rateio');
    await page.getByText(/A base mudou/).waitFor();
    await click('Consultar resultado e revisar');
    await saved();
    await click('Editar rateio');
    await mode().selectOption('REPLACE');
    await click('Adicionar parcela');
    await fillRow(1, 11, '1,00');
    archive = id(11);
    await click('Salvar rateio');
    await page
      .getByText(/Uma referência escolhida está indisponível/)
      .waitFor();
    await click('Consultar resultado e revisar');
    await saved();
    h.data
      .get(workspace)
      .classification.categories.find((r) => r.id === id(11)).status = 'ACTIVE';
  });
  await step('split_edit_notes_and_exact_sum', async () => {
    await back();
    await edit(100);
    const before = h.read(workspace).transactions.find((r) => r.id === id(100));
    await mode().selectOption('REPLACE');
    await fillRow(1, 10, '0,50', 'SYNTHETIC REVISED PARCEL', 20);
    await fillRow(2, 11, '0,50', null, 21);
    await save();
    const after = h.read(workspace).transactions.find((r) => r.id === id(100));
    assert.deepEqual(
      after.content.allocations.map((a) => a.id),
      before.content.allocations.map((a) => a.id),
    );
    assert.deepEqual(after.content.tag_ids, before.content.tag_ids);
    assert.equal(after.content.allocations[0].note, 'SYNTHETIC REVISED PARCEL');
  });
  await step('paired_transfer_and_card_preserve_partner', async () => {
    await back();
    for (const [n, partner] of [
      [104, 105],
      [107, 108],
    ]) {
      const other = h
        .read(workspace)
        .transactions.find((r) => r.id === id(partner));
      await edit(n);
      await addSplit();
      await save();
      assert.equal(
        h.read(workspace).transactions.find((r) => r.id === other.id).version,
        other.version,
      );
      await back();
    }
  });
  await step('clear_noop_and_before_after_history', async () => {
    stage = 'collapse_open';
    await edit(102);
    await mode().selectOption('REPLACE');
    const previous = h
      .read(workspace)
      .transactions.find((r) => r.id === id(102));
    await click('Remover parcela 2');
    await fillRow(1, 10, '1,00');
    stage = 'collapse_save';
    await save();
    const one = h.read(workspace).transactions.find((r) => r.id === id(102));
    assert.equal(one.content.allocations.length, 1);
    assert.equal(
      one.content.allocations[0].id,
      previous.content.allocations[0].id,
    );
    await click('Editar rateio');
    await mode().selectOption('CLEAR');
    stage = 'clear_save';
    await save();
    assert.deepEqual(
      h.read(workspace).transactions.find((r) => r.id === id(102)).content
        .allocations,
      [],
    );
    const count = h.read(workspace).history.length;
    await click('Editar rateio');
    stage = 'noop_save';
    await save();
    assert.equal(h.read(workspace).history.length, count);
    stage = 'history_check';
    await page
      .getByText('Ver classificação da versão 2', { exact: true })
      .click();
    await page
      .getByText(/Antes:/)
      .first()
      .waitFor();
    await page
      .getByText(/Depois:/)
      .first()
      .waitFor();
  });
  await step('malformed_ack_keeps_intent', async () => {
    await back();
    await edit(101);
    await mode().selectOption('REPLACE');
    await click('Adicionar parcela');
    await fillRow(1, 10, '1,00');
    badAck = true;
    await click('Salvar rateio');
    await page
      .getByRole('button', {
        name: 'Consultar resultado e revisar',
        exact: true,
      })
      .waitFor();
    assert.equal(await mode().isDisabled(), true);
    await click('Consultar resultado e revisar');
    await saved();
  });
  await step(
    'workspace_switch_discards_late_save_without_followup_read',
    async () => {
      await back();
      await edit(102);
      await addSplit();
      let arrive;
      const done = new Promise((r) => {
        arrive = r;
      });
      reached = arrive;
      hold = true;
      await click('Salvar rateio');
      await done;
      await choose(other);
      const count = reads.length;
      release();
      await page.waitForTimeout(100);
      assert.equal(reads.length, count);
      assert.equal(await page.locator('.allocation-editor').count(), 0);
      assert.equal(await page.getByText(/SYNTHETIC RESULT/).count(), 0);
    },
  );
  await step('lock_discards_late_save_and_tree', async () => {
    await choose(workspace);
    await open();
    await edit(101);
    await mode().selectOption('REPLACE');
    await page
      .getByLabel('Nota da parcela 1', { exact: true })
      .fill('SYNTHETIC BEFORE LOCK');
    let arrive;
    const done = new Promise((r) => {
      arrive = r;
    });
    reached = arrive;
    hold = true;
    await click('Salvar rateio');
    await done;
    await click('Bloquear agora');
    await page
      .getByRole('button', { name: 'Desbloquear', exact: true })
      .waitFor();
    release();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.allocation-editor').count(), 0);
    assert.equal(await page.getByText(/SYNTHETIC RESULT/).count(), 0);
    await unlock();
  });
  await step(
    'keyboard_accessibility_reflow_forced_colors_no_persistence_or_egress',
    async () => {
      await page
        .getByRole('button', { name: /SYNTHETIC EDIT SPACE 0/ })
        .click();
      await open();
      await edit(100);
      await mode().selectOption('REPLACE');
      await page.keyboard.press('Tab');
      const analysis = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(analysis.violations, []);
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
      await page.locator('.allocation-editor h2').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: fileURLToPath(new URL('layout.png', directory)),
        fullPage: false,
      });
    },
  );
  report.passed = true;
} catch (e) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage)
    await failedPage.screenshot({
      path: fileURLToPath(new URL('synthetic-failure.png', directory)),
      fullPage: true,
    });
  console.error(
    String(e.stack)
      .split('\n')
      .filter((line) => line.includes('infra/allocations-desktop/browser.mjs'))
      .join('\n'),
  );
  console.error('US046_ALLOCATIONS_BROWSER_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  release?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopAllocationHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopAllocationEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
