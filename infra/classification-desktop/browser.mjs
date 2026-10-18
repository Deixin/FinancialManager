/* global document,window,localStorage,sessionStorage,indexedDB */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticEditorHost, workspace, other, id, now } from './fixture.mjs';
import {
  desktopClassificationHashes,
  pending,
  validateDesktopClassificationEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us045-desktop-classification/',
    import.meta.url,
  ),
  PIN = '721947350682',
  h = syntheticEditorHost(),
  report = {
    format_version: 1,
    scope: 'us045-desktop-classification-browser',
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
  console.log('US045 classification browser: ' + name);
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
  await page.exposeFunction('__syntheticClassificationHost', async (args) => {
    intents.push(JSON.stringify(args.input));
    try {
      if (stale) {
        stale = false;
        const c = args.input[0],
          base = h
            .read(args.workspaceId)
            .transactions.find((r) => r.id === c.base.id);
        await h.apply(args.workspaceId, [
          { base, classification: { kind: 'KEEP' }, tag_ids: [id(31)] },
        ]);
      }
      if (archive) {
        h.data
          .get(args.workspaceId)
          .classification.items.find(
            (r) => r.kind === 'TAG' && r.id === archive,
          ).status = 'ARCHIVED';
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
      await click('Editar classificação e tags');
      await heading('Editar classificação e tags');
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
    set = async (cat = 10, sub = 20) => {
      await page
        .getByLabel('Classificação monetária', { exact: true })
        .selectOption('SET');
      await page
        .getByLabel('Categoria da movimentação', { exact: true })
        .selectOption(id(cat));
      if (sub !== null)
        await page
          .getByLabel('Subcategoria da movimentação', { exact: true })
          .selectOption(id(sub));
    },
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
  await step('native_only_and_import_classification', async () => {
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
    await set();
    await click('Salvar classificação');
    await saved();
    const row = h.read(workspace).transactions.find((r) => r.id === id(102));
    assert.equal(row.version, '2');
    assert.equal(row.content.origin_kind, 'IMPORT');
    assert.equal(row.content.allocations[0].subcategory_id, id(20));
  });
  await step('lost_ack_frozen_identity_explicit_review', async () => {
    await click('Editar classificação e tags');
    await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).check();
    loseAck = true;
    await click('Salvar classificação');
    await page
      .getByRole('button', { name: 'Repetir mesma tentativa', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel('Classificação monetária', { exact: true })
        .isDisabled(),
      true,
    );
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
  await step('stale_base_and_archived_new_reference_refused', async () => {
    await back();
    await edit(101);
    await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).uncheck();
    stale = true;
    await click('Salvar classificação');
    await page
      .getByText(/A base mudou ou esta tentativa já foi registrada/)
      .waitFor();
    await click('Consultar resultado e revisar');
    await saved();
    await click('Editar classificação e tags');
    await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).check();
    archive = id(30);
    await click('Salvar classificação');
    await page
      .getByText(/Uma referência escolhida está indisponível/)
      .waitFor();
    h.data
      .get(workspace)
      .classification.items.find(
        (r) => r.kind === 'TAG' && r.id === id(30),
      ).status = 'ACTIVE';
    await click('Consultar resultado e revisar');
    await saved();
  });
  await step('split_tags_preserve_allocations', async () => {
    const before = JSON.stringify(
      h.read(workspace).transactions.find((r) => r.id === id(100)).content
        .allocations,
    );
    await back();
    await edit(100);
    assert.equal(
      await page
        .locator('#classification-edit-mode option[value="SET"]')
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .locator('#classification-edit-mode option[value="CLEAR"]')
        .isDisabled(),
      true,
    );
    await page.getByLabel('SYNTHETIC TAG 31', { exact: true }).uncheck();
    await click('Salvar classificação');
    await saved();
    assert.equal(
      JSON.stringify(
        h.read(workspace).transactions.find((r) => r.id === id(100)).content
          .allocations,
      ),
      before,
    );
  });
  await step('paired_transfer_and_card_preserve_partner', async () => {
    for (const n of [104, 107]) {
      const snapshot = h.read(workspace),
        before = snapshot.transactions.find((r) => r.id === id(n)),
        partner = snapshot.transactions.find(
          (r) =>
            r.content.group_id === before.content.group_id &&
            r.id !== before.id,
        );
      await back();
      await edit(n);
      await set(10, null);
      await click('Salvar classificação');
      await saved();
      const after = h.read(workspace);
      assert.deepEqual(
        after.transactions.find((r) => r.id === partner.id),
        partner,
      );
      assert.equal(
        after.transactions.find((r) => r.id === before.id).content
          .economic_kind,
        before.content.economic_kind,
      );
      assert.equal(JSON.parse(intents.at(-1)).length, 2);
    }
  });
  await step('clear_noop_and_before_after_history', async () => {
    await back();
    await edit(102);
    const count = h.read(workspace).history.length;
    await click('Salvar classificação');
    await saved();
    await page
      .getByText('A classificação já confere.', { exact: true })
      .waitFor();
    assert.equal(h.read(workspace).history.length, count);
    await click('Editar classificação e tags');
    await page
      .getByLabel('Classificação monetária', { exact: true })
      .selectOption('CLEAR');
    await click('Salvar classificação');
    await saved();
    const row = h.read(workspace).transactions.find((r) => r.id === id(102));
    assert.equal(row.content.allocations.length, 0);
    assert.ok(row.content.tag_ids.includes(id(30)));
    await page
      .getByText('Ver classificação da versão ' + row.version, { exact: true })
      .click();
    assert.match(
      await page.locator('details[open]').innerText(),
      /SYNTHETIC CATEGORY 10/,
    );
  });
  await step('malformed_ack_keeps_intent', async () => {
    await click('Editar classificação e tags');
    await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).uncheck();
    badAck = true;
    await click('Salvar classificação');
    await page
      .getByRole('button', { name: 'Repetir mesma tentativa', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel('Classificação monetária', { exact: true })
        .isDisabled(),
      true,
    );
    await click('Consultar resultado e revisar');
    await saved();
  });
  await step(
    'workspace_switch_discards_late_save_without_followup_read',
    async () => {
      await click('Editar classificação e tags');
      await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).check();
      hold = true;
      const started = new Promise((r) => {
        reached = r;
      });
      await click('Salvar classificação');
      await started;
      await choose(other);
      const before = reads.filter((w) => w === workspace).length;
      release();
      await open();
      assert.equal(
        await page.locator('.classification-results > li').count(),
        0,
      );
      assert.equal(reads.filter((w) => w === workspace).length, before);
      await choose(workspace);
      await open();
    },
  );
  await step('lock_discards_late_save_and_tree', async () => {
    await edit(102);
    await page.getByLabel('SYNTHETIC TAG 30', { exact: true }).uncheck();
    hold = true;
    const started = new Promise((r) => {
      reached = r;
    });
    await click('Salvar classificação');
    await started;
    await click('Bloquear agora');
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    release();
    assert.equal(await page.locator('.classification-editor').count(), 0);
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC EDIT SPACE 0/ }).click();
    await open();
    await edit(102);
  });
  await step(
    'keyboard_accessibility_reflow_forced_colors_no_persistence_or_egress',
    async () => {
      assert.equal(
        (await new AxeBuilder({ page }).analyze()).violations.length,
        0,
      );
      await page.getByLabel('Classificação monetária', { exact: true }).focus();
      assert.equal(
        await page
          .getByLabel('Classificação monetária', { exact: true })
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
      await page.locator('.classification-editor h2').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: fileURLToPath(new URL('layout.png', directory)),
        fullPage: false,
      });
    },
  );
  report.passed = true;
} catch (e) {
  console.error(
    String(e.stack)
      .split('\n')
      .filter((line) =>
        line.includes('infra/classification-desktop/browser.mjs'),
      )
      .join('\n'),
  );
  console.error('US045_CLASSIFICATION_BROWSER_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  release?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopClassificationHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopClassificationEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
