// SYNTHETIC_US042_DESKTOP_ONLY. Optional WebView2 instrumentation, excluded from default assets.
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
          await original('finish_transfers_smoke', {
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
        await click('SYNTHETIC US042 EMPTY');
        await wait(() => selector());
        const workspace = selector().value,
          other = [...selector().options].find(
            (o) => o.value !== workspace,
          ).value;
        await click('Movimentações');
        await click('Nova transferência');
        await wait(() => document.getElementById('transfer-source'));
        const create = async (name, amount) => {
          await fill('transfer-source', '0199d242-0000-7000-8000-000000000002');
          await fill('transfer-target', '0199d242-0000-7000-8000-000000000003');
          await fill('transfer-date', '2026-10-18');
          await fill('transfer-amount', amount);
          await fill('transfer-name', name);
          await fill('transfer-original', 'SYNTHETIC ORIGINAL');
          await tick('Confirmo os dois lados desta transferência.');
          await click('Confirmar transferência');
        };
        await progress(2);
        await create('SYNTHETIC TRANSFER', '500,00');
        await wait(() =>
          text().includes('Esta tentativa mantém o mesmo grupo'),
        );
        await click('Repetir a mesma tentativa');
        await wait(() => text().includes('A base mudou'));
        await click('Consultar resultado e atualizar');
        await click('SYNTHETIC TRANSFER');
        await wait(() => text().includes('Detalhe da transferência'));
        checks.lost_ack_frozen_group_and_members = true;
        await progress(3);
        await click('Editar transferência');
        await fill('transfer-source', '0199d242-0000-7000-8000-000000000003');
        await fill('transfer-target', '0199d242-0000-7000-8000-000000000002');
        await fill('transfer-amount', '750,00');
        await fill('transfer-name', 'SYNTHETIC TRANSFER EDIT');
        await tick('Confirmo os dois lados desta transferência.');
        await click('Salvar transferência');
        await wait(() => text().includes('Versão 2'));
        await click('Excluir transferência');
        await tick('Confirmo a exclusão lógica dos dois lados.');
        await click('Confirmar exclusão conjunta');
        await wait(() => text().includes('Versão 3'));
        await click('Restaurar transferência');
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
        await click('Voltar às transferências');
        await click('Nova transferência');
        await create('SYNTHETIC LARGE TRANSFER', '90071992547409,93');
        await wait(() => text().includes('Detalhe da transferência'));
        if (!text().includes('90.071.992.547.409,93')) throw Error('MONEY');
        checks.canonical_money_and_conserved_balances = true;
        await progress(5);
        await fill(selector().id, other);
        await wait(() => text().includes('Seu espaço local está pronto'));
        if (
          document.querySelector('.transfer-flow') ||
          text().includes('SYNTHETIC LARGE TRANSFER')
        )
          throw Error('ISOLATION');
        await fill(selector().id, workspace);
        await wait(() => text().includes('Seu espaço local está pronto'));
        await click('Movimentações');
        await click('Ver transferências');
        await click('SYNTHETIC TRANSFER EDIT');
        await wait(() => text().includes('Detalhe da transferência'));
        checks.workspace_isolation = true;
        await progress(6);
        await click('Bloquear agora');
        await wait(() => document.getElementById('unlock-pin'));
        if (
          document.querySelector('.transfer-flow') ||
          text().includes('SYNTHETIC TRANSFER EDIT')
        )
          throw Error('LOCK');
        let denied = false;
        try {
          await original('read_local_transfers', { workspaceId: workspace });
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
        await original('finish_transfers_smoke', {
          report: { passed: true, checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_transfers_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    },
    { once: true },
  );
})();
