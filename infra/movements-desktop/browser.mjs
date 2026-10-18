/* global window, document, localStorage, sessionStorage, indexedDB, setTimeout */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticHost, workspace, id, now } from './fixture.mjs';
import { movementAccount } from '../../apps/desktop/dist/local-movements.js';
import { accountRows } from '../../apps/desktop/dist/local-accounts.js';
import {
  movementHashes,
  pending,
  validateMovementEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us041-desktop-movements/',
    import.meta.url,
  ),
  PIN = '721947350682',
  financial = syntheticHost(),
  other = id(90),
  report = {
    format_version: 3,
    scope: 'us041-desktop-movements-browser',
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
const step = async (name, fn) => {
  stage = name;
  await fn();
  report.checks[name] = true;
  console.log('US041 Desktop browser: ' + name);
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
        display_name: 'SYNTHETIC US041 A',
        purpose: 'PERSONAL',
        storage_mode: 'LOCAL',
        default_currency: 'BRL',
        created_at: now,
      },
      {
        id: other,
        display_name: 'SYNTHETIC US041 B',
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
    '__syntheticMovementHost',
    async (command, args) => {
      try {
        if (command === 'read_local_movements') {
          if (holdRead) {
            holdRead = false;
            await new Promise((r) => {
              releaseRead = r;
            });
          }
          return {
            value:
              args.workspaceId === workspace
                ? financial.snapshot()
                : {
                    balance: {
                      workspace_id: other,
                      read_at: now,
                      accounts: [],
                      movements: [],
                    },
                    transactions: [],
                    history: [],
                  },
          };
        }
        const value = await financial.apply(args.input);
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
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE');
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(host.url);
  await context.setOffline(true);
  const click = (name) =>
      page.getByRole('button', { name, exact: true }).click(),
    heading = (name) =>
      page.getByRole('heading', { name, exact: true }).waitFor(),
    unlock = async () => {
      await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
      await click('Desbloquear');
    },
    back = async () => {
      await click('Voltar às movimentações');
      await heading('Suas movimentações');
    },
    detail = async (name) => {
      await page.getByRole('button', { name: new RegExp(name) }).click();
      await heading('Detalhe da movimentação');
    },
    create = async (kind, name, amount) => {
      await click('Nova movimentação');
      await page
        .getByLabel('Conta da movimentação', { exact: true })
        .selectOption(id(2));
      await page
        .getByLabel('Tipo de movimentação', { exact: true })
        .selectOption(kind);
      await page
        .getByLabel('Data financeira', { exact: true })
        .fill('2026-10-17');
      await page
        .getByLabel('Valor positivo (R$)', { exact: true })
        .fill(amount);
      await page.getByLabel('Nome da movimentação', { exact: true }).fill(name);
      await page
        .getByLabel('Descrição original (opcional)', { exact: true })
        .fill('SYNTHETIC ORIGINAL');
      await click('Salvar movimentação');
    };
  await click('Continuar sem conta');
  await step('native_only_no_browser_vault', async () => {
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
    await p.close();
    await page.bringToFront();
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US041 A/ }).click();
    await click('Movimentações');
    await heading('Suas movimentações');
  });
  await step('create_income_expense_and_account_balance', async () => {
    await create('INCOME', 'SYNTHETIC INCOME', '500,00');
    await heading('Detalhe da movimentação');
    await back();
    await create('EXPENSE', 'SYNTHETIC EXPENSE', '200,00');
    await heading('Detalhe da movimentação');
    const rows = accountRows(financial.snapshot().balance, '2026-10-17');
    assert.equal(
      rows.find((r) => r.state.account.id === id(2)).value.balance.amount_minor,
      '130000',
    );
    assert.equal(
      rows.find((r) => r.state.account.id === id(3)).value.balance.amount_minor,
      '200000',
    );
    assert.equal(financial.history.length, 2);
  });
  await step('edit_preserves_original_and_history', async () => {
    await click('Editar movimentação');
    await page
      .getByLabel('Nome da movimentação', { exact: true })
      .fill('SYNTHETIC EDIT');
    await click('Salvar alteração');
    await heading('Detalhe da movimentação');
    assert.ok(
      (await page.locator('.movement-flow').innerText()).includes(
        'SYNTHETIC ORIGINAL',
      ),
    );
    await page.getByText('Ver alteração da versão 2', { exact: true }).click();
    assert.ok(
      (await page.locator('.movement-flow').innerText()).includes(
        'Antes: SYNTHETIC EXPENSE',
      ),
    );
  });
  await step('delete_restore_with_explicit_ack', async () => {
    await click('Excluir movimentação');
    assert.equal(
      await page
        .getByRole('button', { name: 'Confirmar exclusão', exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel('Confirmo a exclusão lógica e seu efeito no saldo.', {
        exact: true,
      })
      .check();
    await click('Confirmar exclusão');
    await heading('Detalhe da movimentação');
    assert.equal(
      accountRows(financial.snapshot().balance, '2026-10-17')[0].value.balance
        .amount_minor,
      '150000',
    );
    await click('Restaurar movimentação');
    await page
      .getByLabel('Confirmo a restauração e seu efeito no saldo.', {
        exact: true,
      })
      .check();
    await click('Confirmar restauração');
    await heading('Detalhe da movimentação');
    assert.equal(financial.history.length, 5);
  });
  await step('lost_ack_frozen_intent_and_consult', async () => {
    await back();
    loseAck = true;
    await create('INCOME', 'SYNTHETIC LOST ACK', '0,01');
    await page
      .getByText(/Os dados desta tentativa estão preservados/)
      .waitFor();
    const count = financial.states.size;
    assert.equal(
      await page
        .getByLabel('Nome da movimentação', { exact: true })
        .isDisabled(),
      true,
    );
    await click('Repetir a mesma tentativa');
    await page.getByText(/A base mudou/).waitFor();
    assert.equal(financial.states.size, count);
    await click('Consultar resultado e atualizar');
    await heading('Suas movimentações');
    assert.equal(
      await page.getByRole('button', { name: /SYNTHETIC LOST ACK/ }).count(),
      1,
    );
  });
  await step('explicit_signed_adjustment', async () => {
    await financial.apply({
      kind: 'ADJUST',
      id: id(81),
      account: movementAccount(financial.accounts[0].account),
      financial_date: '2026-10-17',
      delta_minor: '-123',
      reason: 'SYNTHETIC EXPLICIT',
    });
    await click('Consultar resultado e atualizar');
    await heading('Suas movimentações');
    await detail('Ajuste de saldo: SYNTHETIC EXPLICIT');
    assert.equal(
      await page
        .getByRole('button', { name: 'Editar movimentação', exact: true })
        .isDisabled(),
      true,
    );
    assert.ok(
      (await page.locator('.movement-flow').innerText()).includes('R$ -1,23'),
    );
  });
  await step('read_only_origins_and_legacy_history', async () => {
    const s = [...financial.states.values()].find(
      (s) => s.content.display_name === 'SYNTHETIC INCOME',
    );
    s.content.origin_kind = 'IMPORT';
    const h = financial.history.find((h) => h.transaction_id === s.id);
    h.compatible = false;
    h.snapshot = null;
    await back();
    await detail('SYNTHETIC INCOME');
    assert.equal(
      await page
        .getByRole('button', { name: 'Editar movimentação', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Excluir movimentação', exact: true })
        .isDisabled(),
      true,
    );
    await page.getByText(/Histórico legado preservado/).waitFor();
  });
  await step('workspace_switch_drops_old_response', async () => {
    await back();
    holdRead = true;
    await click('Consultar resultado e atualizar');
    while (!releaseRead) await new Promise((r) => setTimeout(r, 10));
    await page.locator('.fm-workspace select').selectOption(other);
    await heading('Seu espaço local está pronto');
    releaseRead();
    await click('Movimentações');
    await heading('Suas movimentações');
    assert.ok(
      !(await page.locator('.movement-flow').innerText()).includes(
        'SYNTHETIC EDIT',
      ),
    );
    await page.locator('.fm-workspace select').selectOption(workspace);
    await heading('Seu espaço local está pronto');
    await click('Movimentações');
    await heading('Suas movimentações');
  });
  await step('lock_and_late_save_hide_data', async () => {
    holdSave = true;
    saveReached = false;
    await create('INCOME', 'SYNTHETIC LATE', '0,01');
    while (!saveReached) await new Promise((r) => setTimeout(r, 10));
    await click('Bloquear agora');
    releaseSave();
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    assert.equal(await page.locator('.movement-flow').count(), 0);
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US041 A/ }).click();
    await click('Movimentações');
    await heading('Suas movimentações');
    await page.evaluate(() => {
      globalThis.__syntheticWorkspace.lockMovementNext = true;
    });
    await click('Consultar resultado e atualizar');
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    assert.equal(await page.locator('.movement-flow').count(), 0);
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US041 A/ }).click();
    await click('Movimentações');
    await heading('Suas movimentações');
  });
  await step('accessibility_reflow_and_forced_colors', async () => {
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await click('Nova movimentação');
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
    await page.getByLabel('Valor positivo (R$)', { exact: true }).focus();
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'movement-amount',
    );
    await page.screenshot({
      path: fileURLToPath(new URL('layout.png', directory)),
      fullPage: true,
    });
  });
  await step('no_storage_egress_or_runtime_errors', async () => {
    assert.deepEqual(errors, []);
    assert.ok(
      requests.every((u) => u.startsWith(new URL(host.url).origin + '/')),
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
  process.exitCode = 1;
  console.error('US041_DESKTOP_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  releaseRead?.();
  releaseSave?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = movementHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateMovementEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
