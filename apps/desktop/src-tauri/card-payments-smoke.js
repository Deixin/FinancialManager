// SYNTHETIC_US043_DESKTOP_ONLY. Optional WebView2 instrumentation, excluded from default assets.
(() => {
  let forbidden = 0;
  const deny = () => {
      forbidden++;
      throw Error('SYNTHETIC_FORBIDDEN_IO');
    },
    fetch = window.fetch;
  window.fetch = (url, args) =>
    String(url).startsWith('http://ipc.localhost/') ? fetch(url, args) : deny();
  window.XMLHttpRequest = deny;
  window.WebSocket = deny;
  Storage.prototype.setItem = deny;
  const text = () => document.body.textContent,
    button = (name) =>
      [...document.querySelectorAll('button')].find((b) =>
        b.textContent.trim().startsWith(name),
      ),
    selector = () => document.querySelector('.fm-workspace select');
  const wait = (condition) =>
    new Promise((resolve, reject) => {
      const start = Date.now(),
        timer = setInterval(() => {
          if (condition()) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - start > 120000) {
            clearInterval(timer);
            reject(Error('TIMEOUT'));
          }
        }, 25);
    });
  const click = async (name) => {
    await wait(() => button(name) && !button(name).disabled);
    button(name).click();
  };
  const fill = async (id, value) => {
    await wait(
      () =>
        document.getElementById(id) && !document.getElementById(id).disabled,
    );
    const el = document.getElementById(id),
      prototype =
        el.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  };
  const tick = async (label) => {
    await wait(() =>
      [...document.querySelectorAll('label')].some(
        (l) => l.textContent.trim() === label,
      ),
    );
    [...document.querySelectorAll('label')]
      .find((l) => l.textContent.trim() === label)
      .querySelector('input[type=checkbox]')
      .click();
  };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      let stage = 0;
      try {
        const original = window.__TAURI_INTERNALS__.invoke;
        const progress = async (n) => {
          stage = n;
          await original('finish_card_payments_smoke', {
            report: {
              passed: false,
              checks,
              failure_stage: stage,
              progress: true,
            },
          });
        };
        await progress(1);
        await click('Continuar sem conta');
        await fill('unlock-pin', '721947350682');
        await click('Desbloquear');
        await click('SYNTHETIC US043 EMPTY');
        await wait(() => selector());
        const workspace = selector().value,
          other = [...selector().options].find(
            (o) => o.value !== workspace,
          ).value;
        await click('Movimentações');
        await click('Novo pagamento de cartão');
        await wait(() => document.getElementById('card-payment-source'));
        const create = async (name, amount) => {
          await fill(
            'card-payment-source',
            '0199d243-0000-7000-8000-000000000002',
          );
          await fill(
            'card-payment-target',
            '0199d243-0000-7000-8000-000000000003',
          );
          await fill('card-payment-date', '2026-10-18');
          await fill('card-payment-amount', amount);
          await fill('card-payment-name', name);
          await fill('card-payment-original', 'SYNTHETIC ORIGINAL');
          await tick('Confirmo os dois lados deste pagamento de cartão.');
          await click('Confirmar pagamento de cartão');
        };
        await progress(2);
        await create('SYNTHETIC CARD_PAYMENT', '500,00');
        await wait(() =>
          text().includes('Esta tentativa mantém o mesmo grupo'),
        );
        await click('Repetir a mesma tentativa');
        await wait(() => text().includes('A base mudou'));
        await click('Consultar resultado e atualizar');
        await click('SYNTHETIC CARD_PAYMENT');
        await wait(() => text().includes('Detalhe do pagamento de cartão'));
        checks.lost_ack_frozen_group_and_members = true;
        await progress(3);
        await click('Editar pagamento de cartão');
        await fill(
          'card-payment-source',
          '0199d243-0000-7000-8000-000000000002',
        );
        await fill(
          'card-payment-target',
          '0199d243-0000-7000-8000-000000000003',
        );
        await fill('card-payment-amount', '750,00');
        await fill('card-payment-name', 'SYNTHETIC CARD_PAYMENT EDIT');
        await tick('Confirmo os dois lados deste pagamento de cartão.');
        await click('Salvar pagamento de cartão');
        await wait(() => text().includes('Versão 2'));
        await click('Excluir pagamento de cartão');
        await tick('Confirmo a exclusão lógica dos dois lados.');
        await click('Confirmar exclusão conjunta');
        await wait(() => text().includes('Versão 3'));
        await click('Restaurar pagamento de cartão');
        await tick('Confirmo a restauração dos dois lados.');
        await click('Confirmar restauração conjunta');
        await wait(() => text().includes('Versão 4'));
        if (
          !text().includes('SYNTHETIC ORIGINAL') ||
          document.querySelectorAll('summary').length !== 2
        )
          throw Error('PAIR_HISTORY');
        checks.paired_crud_and_history = true;
        await progress(4);
        await click('Voltar aos pagamentos de cartão');
        await click('Novo pagamento de cartão');
        await create('SYNTHETIC LARGE CARD_PAYMENT', '90071992547409,93');
        await wait(() => text().includes('Detalhe do pagamento de cartão'));
        if (!text().includes('90.071.992.547.409,93')) throw Error('MONEY');
        checks.canonical_money_and_net_worth = true;
        await progress(5);
        await fill(selector().id, other);
        await wait(() => text().includes('Seu espaço local está pronto'));
        if (
          document.querySelector('.card-payment-flow') ||
          text().includes('SYNTHETIC LARGE CARD_PAYMENT')
        )
          throw Error('ISOLATION');
        await fill(selector().id, workspace);
        await wait(() => text().includes('Seu espaço local está pronto'));
        await click('Movimentações');
        await click('Cartões e pagamentos');
        await click('SYNTHETIC CARD_PAYMENT EDIT');
        await wait(() => text().includes('Detalhe do pagamento de cartão'));
        checks.workspace_isolation = true;
        await progress(6);
        await click('Bloquear agora');
        await wait(() => document.getElementById('unlock-pin'));
        if (
          document.querySelector('.card-payment-flow') ||
          text().includes('SYNTHETIC CARD_PAYMENT EDIT')
        )
          throw Error('LOCK');
        let denied = false;
        try {
          await original('read_local_card_payments', {
            workspaceId: workspace,
          });
        } catch (e) {
          denied = e === 'LOCAL_LOCKED';
        }
        if (!denied) throw Error('NATIVE_LOCK');
        checks.lock_removes_financial_tree = true;
        if (
          forbidden ||
          localStorage.length ||
          sessionStorage.length ||
          (await indexedDB.databases()).length
        )
          throw Error('IO');
        checks.no_storage_or_egress = true;
        await original('finish_card_payments_smoke', {
          report: { passed: true, checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_card_payments_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    },
    { once: true },
  );
})();
