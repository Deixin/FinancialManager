// SYNTHETIC_US041_DESKTOP_ONLY. Optional WebView2 instrumentation, excluded from default assets.
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
        stage = 1;
        await original('finish_movements_smoke', {
          report: {
            passed: false,
            checks,
            failure_stage: stage,
            progress: true,
          },
        });
        await click('Continuar sem conta');
        await fill('unlock-pin', '721947350682');
        await click('Desbloquear');
        await click('SYNTHETIC US041 EMPTY');
        await wait(() => selector());
        const workspace = selector().value,
          other = [...selector().options].find(
            (o) => o.value !== workspace,
          ).value;
        await click('Movimentações');
        await wait(() => text().includes('Suas movimentações'));
        const create = async (kind, name, amount) => {
          await click('Nova movimentação');
          await fill(
            'movement-account',
            '0199d141-0000-7000-8000-000000000002',
          );
          await fill('movement-kind', kind);
          await fill('movement-date', '2026-10-17');
          await fill('movement-amount', amount);
          await fill('movement-name', name);
          await fill('movement-original', 'SYNTHETIC ORIGINAL');
          await click('Salvar movimentação');
        };
        stage = 2;
        await original('finish_movements_smoke', {
          report: {
            passed: false,
            checks,
            failure_stage: stage,
            progress: true,
          },
        });
        await create('INCOME', 'SYNTHETIC INCOME', '500,00');
        await wait(() =>
          text().includes('Os dados desta tentativa estão preservados'),
        );
        await click('Repetir a mesma tentativa');
        await wait(() => text().includes('A base mudou'));
        await click('Consultar resultado e atualizar');
        await wait(
          () =>
            text().includes('Suas movimentações') && button('SYNTHETIC INCOME'),
        );
        checks.lost_ack_frozen_intent = true;
        stage = 3;
        await original('finish_movements_smoke', {
          report: {
            passed: false,
            checks,
            failure_stage: stage,
            progress: true,
          },
        });
        await create('EXPENSE', 'SYNTHETIC EXPENSE', '200,00');
        await wait(() => text().includes('Detalhe da movimentação'));
        await click('Voltar às movimentações');
        await click('SYNTHETIC INCOME');
        await click('Editar movimentação');
        await fill('movement-name', 'SYNTHETIC EDIT');
        await click('Salvar alteração');
        await wait(() => text().includes('Versão 2.'));
        await click('Excluir movimentação');
        await tick('Confirmo a exclusão lógica e seu efeito no saldo.');
        await click('Confirmar exclusão');
        await wait(() => text().includes('Versão 3.'));
        await click('Restaurar movimentação');
        await tick('Confirmo a restauração e seu efeito no saldo.');
        await click('Confirmar restauração');
        await wait(() => text().includes('Versão 4.'));
        if (
          !text().includes('SYNTHETIC ORIGINAL') ||
          !text().includes('Versão 1')
        )
          throw Error('HISTORY');
        checks.crud_history_and_soft_deletion = true;
        stage = 4;
        await original('finish_movements_smoke', {
          report: {
            passed: false,
            checks,
            failure_stage: stage,
            progress: true,
          },
        });
        await click('Contas e cartões');
        await click('SYNTHETIC US041 ACCOUNT 2');
        await click('Registrar ajuste identificado');
        await fill('movement-date', '2026-10-17');
        await fill('movement-amount', '1,23');
        await fill('movement-reason', 'SYNTHETIC EXPLICIT');
        await tick('Confirmo o ajuste identificado e seu efeito no saldo.');
        await click('Registrar ajuste');
        await wait(
          () =>
            text().includes('Detalhe da movimentação') &&
            text().includes('Ajuste de saldo: SYNTHETIC EXPLICIT'),
        );
        checks.explicit_adjustment = true;
        stage = 5;
        await original('finish_movements_smoke', {
          report: {
            passed: false,
            checks,
            failure_stage: stage,
            progress: true,
          },
        });
        await fill(selector().id, other);
        await wait(() => text().includes('Seu espaço local está pronto'));
        if (text().includes('SYNTHETIC EDIT')) throw Error('ISOLATION');
        await fill(selector().id, workspace);
        await wait(() => text().includes('Seu espaço local está pronto'));
        await click('Movimentações');
        await wait(() => button('SYNTHETIC EDIT'));
        checks.workspace_isolation = true;
        stage = 6;
        await original('finish_movements_smoke', {
          report: {
            passed: false,
            checks,
            failure_stage: stage,
            progress: true,
          },
        });
        await click('Bloquear agora');
        await wait(() => document.getElementById('unlock-pin'));
        if (
          document.querySelector('.movement-flow') ||
          text().includes('SYNTHETIC EDIT')
        )
          throw Error('LOCK');
        let denied = false;
        try {
          await original('read_local_movements', { workspaceId: workspace });
        } catch (e) {
          denied = e === 'LOCAL_LOCKED';
        }
        if (!denied) throw Error('NATIVE_LOCK');
        checks.lock_removes_financial_data = true;
        if (
          forbidden ||
          localStorage.length ||
          sessionStorage.length ||
          (await indexedDB.databases()).length
        )
          throw Error('IO');
        checks.no_storage_or_egress = true;
        await original('finish_movements_smoke', {
          report: { passed: true, checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_movements_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    },
    { once: true },
  );
})();
