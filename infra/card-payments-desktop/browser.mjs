/* global document, window, localStorage, sessionStorage, indexedDB, setTimeout */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveDesktopEntry } from '../entry/host.mjs';
import { installSyntheticWorkspaceBridge } from '../local-workspaces/browser-fixture.mjs';
import { syntheticCardPaymentHost, workspace, id, now } from './fixture.mjs';
import {
  cardPaymentBase,
  decodeCardPaymentsSnapshot,
} from '../../apps/desktop/dist/local-card-payments.js';
import { movementAccount } from '../../apps/desktop/dist/local-movements.js';
import { accountRows } from '../../apps/desktop/dist/local-accounts.js';
import { planTransactionRevision } from '../../packages/domain/dist/revisions.js';
import {
  captureManualMovement,
  manualMovementChange,
} from '../../packages/domain/dist/manual-movements.js';
import {
  desktopCardPaymentHashes,
  pending,
  validateDesktopCardPaymentEvidence,
} from './evidence.mjs';
const directory = new URL(
    '../../.tools/us043-desktop-card-payments/',
    import.meta.url,
  ),
  PIN = '721947350682',
  h = syntheticCardPaymentHost(),
  other = id(90),
  report = {
    format_version: 2,
    scope: 'us043-desktop-card-payments-browser',
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
const step = async (name, run) => {
  stage = name;
  await run();
  report.checks[name] = true;
  console.log('US043 Desktop browser: ' + name);
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
        display_name: 'SYNTHETIC US043 A',
        purpose: 'PERSONAL',
        storage_mode: 'LOCAL',
        default_currency: 'BRL',
        created_at: now,
      },
      {
        id: other,
        display_name: 'SYNTHETIC US043 B',
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
  await page.exposeFunction('__syntheticMovementHost', async (_, args) => ({
    value:
      args.workspaceId === workspace
        ? h.snapshot().movements
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
  }));
  await page.exposeFunction(
    '__syntheticCardPaymentHost',
    async (command, args) => {
      try {
        if (command === 'read_local_card_payments') {
          if (holdRead) {
            holdRead = false;
            await new Promise((r) => {
              releaseRead = r;
            });
          }
          return {
            value:
              args.workspaceId === workspace
                ? h.snapshot()
                : {
                    movements: {
                      balance: {
                        workspace_id: other,
                        read_at: now,
                        accounts: [],
                        movements: [],
                      },
                      transactions: [],
                      history: [],
                    },
                    groups: [],
                  },
          };
        }
        const value = await h.apply(args.input);
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
      await click('Voltar aos pagamentos de cartão');
      await heading('Seus pagamentos de cartão');
    },
    detail = async (name) => {
      await click(name);
      await heading('Detalhe do pagamento de cartão');
    },
    create = async (name, amount) => {
      await page
        .getByLabel('Conta de origem', { exact: true })
        .selectOption(id(2));
      await page
        .getByLabel('Cartão de crédito', { exact: true })
        .selectOption(id(3));
      await page
        .getByLabel('Data do pagamento', { exact: true })
        .fill('2026-10-18');
      await page.getByLabel('Valor a pagar (R$)', { exact: true }).fill(amount);
      await page.getByLabel('Nome do pagamento', { exact: true }).fill(name);
      await page
        .getByLabel('Descrição original (opcional)', { exact: true })
        .fill('SYNTHETIC ORIGINAL');
      await page
        .getByLabel('Confirmo os dois lados deste pagamento de cartão.', {
          exact: true,
        })
        .check();
      await click('Confirmar pagamento de cartão');
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
    await page.getByRole('button', { name: /SYNTHETIC US043 A/ }).click();
    await click('Movimentações');
    await heading('Suas movimentações');
    await click('Novo pagamento de cartão');
    await heading('Novo pagamento de cartão');
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Confirmar pagamento de cartão',
          exact: true,
        })
        .isDisabled(),
      true,
    );
  });
  await step('create_pair_confirmation_and_debt_reduction', async () => {
    await create('SYNTHETIC CARD_PAYMENT', '50,00');
    await heading('Detalhe do pagamento de cartão');
    const rows = accountRows(h.snapshot().movements.balance, '2026-10-18');
    assert.deepEqual(
      rows.map((r) => r.value.balance.amount_minor),
      ['95000', '195000'],
    );
    assert.equal(h.states.size, 2);
    assert.equal(h.groups.size, 1);
    assert.equal(h.history.length, 2);
  });
  await step('edit_pair_roles_and_preserve_original', async () => {
    await click('Editar pagamento de cartão');
    await page
      .getByLabel('Conta de origem', { exact: true })
      .selectOption(id(2));
    await page
      .getByLabel('Cartão de crédito', { exact: true })
      .selectOption(id(3));
    await page.getByLabel('Valor a pagar (R$)', { exact: true }).fill('25,00');
    await page
      .getByLabel('Nome do pagamento', { exact: true })
      .fill('SYNTHETIC EDIT');
    await page
      .getByLabel('Confirmo os dois lados deste pagamento de cartão.', {
        exact: true,
      })
      .check();
    await click('Salvar pagamento de cartão');
    await heading('Detalhe do pagamento de cartão');
    assert.deepEqual(
      accountRows(h.snapshot().movements.balance, '2026-10-18').map(
        (r) => r.value.balance.amount_minor,
      ),
      ['97500', '197500'],
    );
    assert.equal(
      [...h.states.values()].filter(
        (s) => s.content.original_description === 'SYNTHETIC ORIGINAL',
      ).length,
      2,
    );
  });
  await step('delete_restore_both_sides_and_history', async () => {
    await click('Excluir pagamento de cartão');
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Confirmar exclusão conjunta',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel('Confirmo a exclusão lógica dos dois lados.', { exact: true })
      .check();
    await click('Confirmar exclusão conjunta');
    await heading('Detalhe do pagamento de cartão');
    assert.equal(h.snapshot().movements.balance.movements.length, 0);
    await click('Restaurar pagamento de cartão');
    await page
      .getByLabel('Confirmo a restauração dos dois lados.', { exact: true })
      .check();
    await click('Confirmar restauração conjunta');
    await heading('Detalhe do pagamento de cartão');
    assert.ok(
      [...h.states.values()].every(
        (s) => s.version === '4' && !s.content.deleted,
      ),
    );
    assert.equal(h.history.length, 8);
    await page
      .getByText('Histórico deste lado', { exact: true })
      .first()
      .click();
    await page.getByText('Antes:', { exact: false }).first().waitFor();
  });
  await step('lost_ack_reuses_three_ids_and_pair_base', async () => {
    await back();
    await click('Novo pagamento de cartão');
    loseAck = true;
    await create('SYNTHETIC LOST ACK', '0,01');
    await page.getByText(/Esta tentativa mantém o mesmo grupo/).waitFor();
    const count = h.states.size,
      groups = h.groups.size,
      history = h.history.length;
    assert.equal(
      await page.getByLabel('Nome do pagamento', { exact: true }).isDisabled(),
      true,
    );
    await click('Repetir a mesma tentativa');
    await page.getByText(/A base mudou/).waitFor();
    assert.equal(h.states.size, count);
    assert.equal(h.groups.size, groups);
    assert.equal(h.history.length, history);
    await click('Consultar resultado e atualizar');
    await heading('Seus pagamentos de cartão');
    assert.equal(
      await page
        .getByRole('button', { name: 'SYNTHETIC LOST ACK', exact: true })
        .count(),
      1,
    );
  });
  await step('stale_pair_is_not_rebased', async () => {
    await detail('SYNTHETIC EDIT');
    await click('Editar pagamento de cartão');
    const group = [...h.groups.keys()][0],
      base = cardPaymentBase(
        decodeCardPaymentsSnapshot(h.snapshot(), workspace),
        group,
      );
    await h.apply({
      kind: 'EDIT',
      base,
      source_account: movementAccount(h.accounts[0].account),
      target_account: movementAccount(h.accounts[1].account),
      financial_date: '2026-10-18',
      amount_minor: '2500',
      display_name: 'SYNTHETIC RACE',
    });
    await page
      .getByLabel('Nome do pagamento', { exact: true })
      .fill('SYNTHETIC STALE');
    await page
      .getByLabel('Confirmo os dois lados deste pagamento de cartão.', {
        exact: true,
      })
      .check();
    await click('Salvar pagamento de cartão');
    await page.getByText(/A base mudou/).waitFor();
    assert.ok(
      ![...h.states.values()].some(
        (s) => s.content.display_name === 'SYNTHETIC STALE',
      ),
    );
    await click('Consultar resultado e atualizar');
    await heading('Seus pagamentos de cartão');
  });
  await step('large_money_and_account_role_selection', async () => {
    h.accounts.push({
      account: {
        ...h.accounts[0].account,
        id: id(7),
        account_kind: 'LOAN_SIMPLE',
        balance_nature: 'LIABILITY',
        name: 'SYNTHETIC CARD',
      },
      references: [],
    });
    await click('Consultar resultado e atualizar');
    await heading('Seus pagamentos de cartão');
    await click('Novo pagamento de cartão');
    assert.equal(
      await page
        .getByRole('option', { name: 'SYNTHETIC CARD', exact: true })
        .count(),
      0,
    );
    await create('SYNTHETIC LARGE', '90071992547409,93');
    await heading('Detalhe do pagamento de cartão');
    const rows = accountRows(
      h.snapshot().movements.balance,
      '2026-10-18',
    ).filter((r) => r.state.account.id !== id(7));
    assert.equal(
      rows.reduce(
        (s, r) =>
          s +
          (r.state.account.balance_nature === 'ASSET' ? 1n : -1n) *
            BigInt(r.value.balance.amount_minor),
        0n,
      ),
      -100000n,
    );
    assert.equal(
      [...h.states.values()].filter(
        (s) => s.content.account_amount_minor === '-9007199254740993',
      ).length,
      2,
    );
  });
  await step(
    'card_overview_separates_purchase_credit_and_payment',
    async () => {
      const purchase = captureManualMovement(
        {
          kind: 'CREATE',
          id: id(800),
          account: movementAccount(h.accounts[1].account),
          financial_date: '2026-09-15',
          amount_minor: '12000',
          movement_kind: 'EXPENSE',
          display_name: 'SYNTHETIC CARD PURCHASE',
          original_description: 'SYNTHETIC PURCHASE SOURCE',
        },
        workspace,
      );
      const state = planTransactionRevision(
        workspace,
        null,
        manualMovementChange(purchase),
        now,
      ).after;
      h.states.set(state.id, state);
      await back();
      await page.getByText(/Crédito no cartão:/).waitFor();
      await page.getByText(/SYNTHETIC CARD PURCHASE · Compra\/gasto/).waitFor();
      await page
        .getByText(
          /Fatura\/período e conciliação de itens ainda não estão disponíveis/,
        )
        .waitFor();
      const reference = h.accounts[1].references[0],
        original = reference.amount_minor;
      const delta = [...h.states.values()]
        .filter(
          (s) =>
            s.content.account_id === id(3) &&
            !s.content.deleted &&
            s.content.financial_date >= reference.reference_date &&
            s.content.financial_date <= '2026-10-18',
        )
        .reduce((n, s) => n + BigInt(s.content.account_amount_minor), 0n);
      reference.amount_minor = (-9223372036854775808n - delta).toString();
      await click('Consultar resultado e atualizar');
      await heading('Seus pagamentos de cartão');
      await page
        .getByText(/Crédito no cartão: R\$ 92\.233\.720\.368\.547\.758,08/)
        .waitFor();
      reference.amount_minor = original;
      await click('Consultar resultado e atualizar');
      await heading('Seus pagamentos de cartão');
      await detail('SYNTHETIC LARGE');
      await page.getByText(/Pagamento de cartão sem detalhamento/).waitFor();
      assert.equal(
        [...h.states.values()].filter(
          (s) => s.content.economic_kind === 'EXPENSE',
        ).length,
        1,
      );
      h.states.delete(state.id);
    },
  );
  await step('broken_imported_and_legacy_groups_read_only', async () => {
    const group = [...h.groups.keys()][0];
    h.groups.get(group).state = 'BROKEN';
    await back();
    await detail('SYNTHETIC RACE');
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Editar pagamento de cartão',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    h.groups.get(group).state = 'ACTIVE';
    const s = [...h.states.values()].find((s) => s.content.group_id === group);
    s.content.origin_kind = 'IMPORT';
    const hist = h.history.find((r) => r.transaction_id === s.id);
    hist.compatible = false;
    hist.snapshot = null;
    await back();
    await detail('SYNTHETIC RACE');
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Excluir pagamento de cartão',
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page
      .getByText('Histórico deste lado', { exact: true })
      .first()
      .click();
    assert.ok(
      (await page.locator('.card-payment-flow').innerText()).includes(
        'Histórico legado preservado',
      ),
    );
  });
  await step('workspace_switch_drops_old_cardPayment_response', async () => {
    await back();
    holdRead = true;
    await click('Consultar resultado e atualizar');
    while (!releaseRead) await new Promise((r) => setTimeout(r, 10));
    await page.locator('.fm-workspace select').selectOption(other);
    await heading('Seu espaço local está pronto');
    releaseRead();
    await click('Movimentações');
    await click('Cartões e pagamentos');
    await heading('Seus pagamentos de cartão');
    assert.ok(
      !(await page.locator('.card-payment-flow').innerText()).includes(
        'SYNTHETIC RACE',
      ),
    );
    await page.locator('.fm-workspace select').selectOption(workspace);
    await heading('Seu espaço local está pronto');
    await click('Movimentações');
    await click('Novo pagamento de cartão');
    await heading('Novo pagamento de cartão');
  });
  await step('lock_and_late_save_remove_financial_tree', async () => {
    holdSave = true;
    saveReached = false;
    await create('SYNTHETIC LATE', '0,01');
    while (!saveReached) await new Promise((r) => setTimeout(r, 10));
    await click('Bloquear agora');
    releaseSave();
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    assert.equal(await page.locator('.card-payment-flow').count(), 0);
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US043 A/ }).click();
    await click('Movimentações');
    await click('Cartões e pagamentos');
    await heading('Seus pagamentos de cartão');
    await page.evaluate(() => {
      globalThis.__syntheticWorkspace.lockCardPaymentNext = true;
    });
    await click('Consultar resultado e atualizar');
    await page.getByLabel('PIN do aplicativo', { exact: true }).waitFor();
    assert.equal(await page.locator('.card-payment-flow').count(), 0);
    await unlock();
    await page.getByRole('button', { name: /SYNTHETIC US043 A/ }).click();
    await click('Movimentações');
    await click('Novo pagamento de cartão');
    await heading('Novo pagamento de cartão');
  });
  await step('accessibility_reflow_forced_colors_and_no_egress', async () => {
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
    await page.getByLabel('Valor a pagar (R$)', { exact: true }).focus();
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'card-payment-amount',
    );
    await page.screenshot({
      path: fileURLToPath(new URL('layout.png', directory)),
      fullPage: true,
    });
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
  console.error(
    'US043_DESKTOP_CARD_PAYMENT_BROWSER_FAILED_' + stage.toUpperCase(),
  );
} finally {
  releaseRead?.();
  releaseSave?.();
  await browser?.close();
  await host?.close();
  report.resources_closed = true;
  report.source_sha256 = desktopCardPaymentHashes();
  report.completed_at_utc = new Date().toISOString();
  if (report.passed) validateDesktopCardPaymentEvidence(report);
  writeFileSync(
    new URL('browser.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
