/* global window,document,localStorage,sessionStorage,indexedDB,structuredClone,setInterval,clearInterval,setTimeout,Event */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticSnapshot } from './fixture.mjs';
import { canonicalFixture as fixture } from '../../packages/test-fixtures/dist/canonical.js';
import { planAccountChange } from '../../packages/domain/dist/index.js';
import {
  captureLocalAccountChange,
  formatBrlMinor,
} from '../../apps/desktop/dist/local-accounts.js';
import {
  desktopAccountHashes,
  pending,
  validateDesktopAccountEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us040-desktop-accounts/',
    import.meta.url,
  ),
  PIN = '721947350682',
  now = '2026-10-17T12:00:00.000Z',
  a = fixture.workspace_a,
  b = fixture.workspace_b;
const workspaceRows = [a, b].map((id, i) => ({
  id,
  display_name: 'SYNTHETIC US040 ' + (i ? 'B' : 'A'),
  purpose: i ? 'BUSINESS' : 'PERSONAL',
  storage_mode: 'LOCAL',
  default_currency: 'BRL',
  created_at: now,
}));
const snapshots = new Map([
  [a, syntheticSnapshot(a)],
  [b, { workspace_id: b, read_at: now, accounts: [], movements: [] }],
]);
const report = {
  format_version: 7,
  scope: 'us040-desktop-accounts-browser',
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
  saveReached = false,
  applyCount = 0;
const step = async (name, fn) => {
  stage = name;
  await fn();
  report.checks[name] = true;
  console.log('US-040 Desktop browser: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  host = await serveDesktopEntry();
  browser = await chromium.launch();
  report.versions.chromium = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(installSyntheticWorkspaceBridge, {
    rows: workspaceRows,
    pin: PIN,
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  await page.exposeFunction('__syntheticAccountHost', async (command, args) => {
    try {
      const snapshot = snapshots.get(args.workspaceId);
      if (!snapshot) throw Error();
      if (command === 'read_local_accounts') {
        if (holdRead) {
          holdRead = false;
          await new Promise((r) => {
            releaseRead = r;
          });
        }
        return { value: structuredClone(snapshot) };
      }
      applyCount++;
      const input = captureLocalAccountChange(args.input, args.workspaceId),
        id =
          input.kind === 'CREATE'
            ? input.account.id
            : input.kind === 'UPDATE'
              ? input.base.id
              : input.account_id;
      const current =
          snapshot.accounts.find((s) => s.account.id === id) ?? null,
        plan = planAccountChange(args.workspaceId, current, input, now);
      if (plan.changed)
        snapshot.accounts = [
          ...snapshot.accounts.filter((s) => s.account.id !== id),
          plan.state,
        ];
      if (holdSave) {
        holdSave = false;
        saveReached = true;
        await new Promise((r) => {
          releaseSave = r;
        });
      }
      if (loseAck) {
        loseAck = false;
        return { error: 'SYNTHETIC_LOST_ACK' };
      }
      return {
        value: {
          changed: plan.changed,
          account_id: id,
          reference_id: plan.reference_id,
        },
      };
    } catch (error) {
      return { error: error.code ?? 'SYNTHETIC_HOST_ERROR' };
    }
  });
  page.on('pageerror', () => errors.push('RUNTIME'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE');
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(host.url);
  await context.setOffline(true);
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click();
  const unlock = async () => {
    await page.getByLabel('PIN do aplicativo', { exact: true }).fill(PIN);
    await click('Desbloquear');
  };
  const open = async (id) => {
    await page
      .getByRole('button', {
        name: new RegExp(workspaceRows.find((r) => r.id === id).display_name),
      })
      .click();
    await click('Contas e cartões');
    await page
      .getByRole('heading', { name: 'Suas contas', exact: true })
      .waitFor();
  };
  const back = async () => {
    await click('Voltar às contas');
    await page
      .getByRole('heading', { name: 'Suas contas', exact: true })
      .waitFor();
  };
  const detail = async (name) => {
    await page
      .getByRole('button', {
        name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .click();
    await page
      .getByRole('heading', { name: 'Detalhe da conta', exact: true })
      .waitFor();
  };
  await click('Continuar sem conta');
  await step('native_only_no_browser_vault', async () => {
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
    assert.equal(
      await preview
        .getByRole('button', { name: 'Contas e cartões', exact: true })
        .count(),
      0,
    );
    await preview.close();
    await page.bringToFront();
    await unlock();
  });
  await step('snapshot_balances_debt_and_incompleteness', async () => {
    await open(a);
    await page
      .getByLabel('Saldo até a data', { exact: true })
      .fill('2026-09-30');
    for (const expected of fixture.expected.balances.filter(
      (e) => e.workspace_id === a && e.as_of === '2026-09-30',
    )) {
      const name = snapshots
        .get(a)
        .accounts.find((s) => s.account.id === expected.account_id)
        .account.name;
      assert.ok(
        (
          await page.getByRole('button', { name: new RegExp(name) }).innerText()
        ).includes(formatBrlMinor(expected.amount_minor)),
      );
    }
    await page
      .getByRole('region', { name: 'Disponibilidades', exact: true })
      .waitFor();
    await page
      .getByRole('region', { name: 'Cartões e dívidas', exact: true })
      .waitFor();
    await page
      .getByLabel('Saldo até a data', { exact: true })
      .fill('2026-10-17');
  });
  let createdId;
  await step('create_explicit_reference_and_canonical_money', async () => {
    await click('Nova conta');
    await page
      .getByLabel('Nome da conta', { exact: true })
      .fill('SYNTHETIC UI ACCOUNT');
    await page
      .getByLabel('Tipo de conta', { exact: true })
      .selectOption('CASH');
    await page
      .getByLabel('Informar saldo de referência', { exact: true })
      .check();
    await page
      .getByLabel('Saldo de referência (R$)', { exact: true })
      .fill('1000,00');
    await page
      .getByLabel('Data de referência', { exact: true })
      .fill('2026-10-17');
    const before = applyCount;
    await click('Criar conta');
    assert.equal(applyCount, before);
    await page
      .getByLabel('Posição no dia', { exact: true })
      .selectOption('START_OF_DAY');
    await click('Criar conta');
    await page
      .getByRole('heading', { name: 'Detalhe da conta', exact: true })
      .waitFor();
    createdId = snapshots
      .get(a)
      .accounts.find((s) => s.account.name === 'SYNTHETIC UI ACCOUNT')
      .account.id;
    assert.equal(
      snapshots.get(a).accounts.find((s) => s.account.id === createdId)
        .references[0].amount_minor,
      '100000',
    );
  });
  await step('observed_balance_is_read_only', async () => {
    const before = applyCount;
    await page
      .getByLabel('Saldo observado (R$)', { exact: true })
      .fill('1001,00');
    await click('Conferir saldo');
    await page.getByText('Diferença: R$ 1,00', { exact: true }).waitFor();
    await page
      .getByLabel('Saldo observado (R$)', { exact: true })
      .fill('1000,00');
    await click('Conferir saldo');
    await page.getByText('Os saldos conferem.', { exact: true }).waitFor();
    assert.equal(applyCount, before);
  });
  await step('metadata_edit_and_stale_conflict', async () => {
    await click('Editar conta');
    await page
      .getByLabel('Nome da conta', { exact: true })
      .fill('SYNTHETIC <img src=x> EDIT');
    await page
      .getByLabel('Instituição (opcional)', { exact: true })
      .fill('SYNTHETIC BANK');
    await click('Salvar conta');
    await page
      .getByRole('heading', { name: 'SYNTHETIC <img src=x> EDIT', exact: true })
      .waitFor();
    assert.equal(await page.locator('img').count(), 0);
    await click('Editar conta');
    const snapshot = snapshots.get(a),
      state = snapshot.accounts.find((s) => s.account.id === createdId);
    snapshot.accounts = snapshot.accounts.map((s) =>
      s.account.id === createdId
        ? planAccountChange(
            a,
            state,
            {
              kind: 'UPDATE',
              base: state.account,
              name: 'SYNTHETIC EXTERNAL',
              institution_name: null,
              status: 'ACTIVE',
            },
            now,
          ).state
        : s,
    );
    await page
      .getByLabel('Nome da conta', { exact: true })
      .fill('SYNTHETIC STALE');
    await click('Salvar conta');
    await page
      .getByText('A conta ou a referência mudou.', { exact: false })
      .waitFor();
    await click('Recarregar contas');
    await detail('SYNTHETIC EXTERNAL');
    assert.equal(
      snapshots.get(a).accounts.find((s) => s.account.id === createdId).account
        .name,
      'SYNTHETIC EXTERNAL',
    );
  });
  await step('archive_reactivate_preserves_history', async () => {
    const before = structuredClone(
      snapshots.get(a).accounts.find((s) => s.account.id === createdId)
        .references,
    );
    await click('Arquivar conta');
    await page
      .getByRole('button', { name: 'Reativar conta', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Adicionar ou corrigir referência',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await click('Reativar conta');
    await page
      .getByRole('button', { name: 'Arquivar conta', exact: true })
      .waitFor();
    assert.deepEqual(
      snapshots.get(a).accounts.find((s) => s.account.id === createdId)
        .references,
      before,
    );
  });
  await step('reference_correction_preserves_history_and_ack', async () => {
    const previous = snapshots
      .get(a)
      .accounts.find((s) => s.account.id === createdId).references[0];
    await click('Adicionar ou corrigir referência');
    await page
      .getByLabel('Referência a substituir', { exact: true })
      .selectOption(previous.id);
    await page
      .getByLabel('Saldo de referência (R$)', { exact: true })
      .fill('1100,00');
    await page
      .getByLabel('Data de referência', { exact: true })
      .fill('2026-10-17');
    await page
      .getByLabel('Posição no dia', { exact: true })
      .selectOption('END_OF_DAY');
    assert.equal(
      await page
        .getByRole('button', { name: 'Salvar referência', exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel(
        'Reconheço a alteração da referência e a preservação do histórico.',
        { exact: true },
      )
      .check();
    await click('Salvar referência');
    await page
      .getByRole('heading', { name: 'Detalhe da conta', exact: true })
      .waitFor();
    const refs = snapshots
      .get(a)
      .accounts.find((s) => s.account.id === createdId).references;
    assert.equal(refs.length, 2);
    assert.equal(refs.find((r) => r.id === previous.id).status, 'SUPERSEDED');
    assert.equal(
      refs.find((r) => r.status === 'ACTIVE').amount_minor,
      '110000',
    );
  });
  await step('lost_ack_same_frozen_intent_without_duplicate', async () => {
    await back();
    await click('Nova conta');
    await page
      .getByLabel('Nome da conta', { exact: true })
      .fill('SYNTHETIC LOST ACK');
    loseAck = true;
    await click('Criar conta');
    await page.getByRole('alert').waitFor();
    assert.equal(
      await page.getByLabel('Nome da conta', { exact: true }).isDisabled(),
      true,
    );
    await click('Repetir a mesma alteração');
    await page
      .getByRole('heading', { name: 'Detalhe da conta', exact: true })
      .waitFor();
    assert.equal(
      snapshots
        .get(a)
        .accounts.filter((s) => s.account.name === 'SYNTHETIC LOST ACK').length,
      1,
    );
  });
  await step('workspace_switch_drops_old_tree_and_response', async () => {
    holdRead = true;
    const readReached = new Promise((r) => {
      const timer = setInterval(() => {
        if (releaseRead) {
          clearInterval(timer);
          r();
        }
      }, 10);
    });
    await click('Voltar às contas');
    await readReached;
    assert.equal(
      await page.getByText('SYNTHETIC EXTERNAL', { exact: true }).count(),
      0,
    );
    await page.getByLabel('Espaço ativo', { exact: true }).selectOption(b);
    await page
      .getByRole('heading', {
        name: 'Seu espaço local está pronto',
        exact: true,
      })
      .waitFor();
    releaseRead();
    await click('Contas e cartões');
    await page
      .getByRole('heading', { name: 'Suas contas', exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('SYNTHETIC EXTERNAL', { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator('.account-flow .local-list li').count(), 0);
  });
  await step('native_lock_and_late_save_hide_financial_data', async () => {
    await page.evaluate(() => {
      window.__syntheticWorkspace.lockAccountNext = true;
    });
    await click('Atualizar contas');
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('SYNTHETIC', { exact: false }).count(),
      0,
    );
    await unlock();
    await open(a);
    await click('Nova conta');
    await page
      .getByLabel('Nome da conta', { exact: true })
      .fill('SYNTHETIC LATE SAVE');
    holdSave = true;
    await click('Criar conta');
    await page.waitForFunction(() =>
      document.body.textContent.includes('Aguarde a leitura ou gravação'),
    );
    while (!saveReached) await new Promise((r) => setTimeout(r, 10));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page
      .getByRole('heading', { name: 'Aplicativo bloqueado', exact: true })
      .waitFor();
    releaseSave();
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByText('SYNTHETIC', { exact: false }).count(),
      0,
    );
    await unlock();
    await open(a);
    assert.equal(
      snapshots
        .get(a)
        .accounts.filter((s) => s.account.name === 'SYNTHETIC LATE SAVE')
        .length,
      1,
    );
  });
  await step('accessibility_responsive_and_forced_colors', async () => {
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await detail('SYNTHETIC EXTERNAL');
    assert.equal(
      (await new AxeBuilder({ page }).analyze()).violations.length,
      0,
    );
    await click('Adicionar ou corrigir referência');
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
    await page.getByLabel('Saldo de referência (R$)', { exact: true }).focus();
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'account-amount',
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
  console.error('US040_DESKTOP_BROWSER_FAILED_' + stage.toUpperCase());
} finally {
  releaseRead?.();
  releaseSave?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopAccountHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopAccountEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
