// SYNTHETIC US050 driver. Never bundled into the product frontend.
(() => {
  let forbidden = 0;
  const deny = () => {
      forbidden++;
      throw Error('FORBIDDEN_IO');
    },
    fetch = window.fetch;
  window.fetch = (url, args) =>
    String(url).startsWith('http://ipc.localhost/') ? fetch(url, args) : deny();
  window.XMLHttpRequest = deny;
  window.WebSocket = deny;
  Storage.prototype.setItem = deny;
  const w = '0199d025-0000-7000-8000-000000000001',
    wait = (condition) =>
      new Promise((resolve, reject) => {
        const start = Date.now(),
          timer = setInterval(() => {
            if (condition()) {
              clearInterval(timer);
              resolve();
            } else if (Date.now() - start > 60000) {
              clearInterval(timer);
              reject(Error('TIMEOUT'));
            }
          }, 25);
      }),
    text = () => document.body.textContent,
    button = (name) =>
      [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') ?? b.textContent.trim()).startsWith(name),
      ),
    click = async (name) => {
      await wait(() => button(name) && !button(name).disabled);
      button(name).click();
    },
    select = async (id, value) => {
      await wait(
        () =>
          document.getElementById(id) && !document.getElementById(id).disabled,
      );
      const e = document.getElementById(id);
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(e, value);
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    invoke = (c, args) => window.__TAURI_INTERNALS__.invoke(c, args);
  window.addEventListener('DOMContentLoaded', () => {
    void (async () => {
      const checks = {};
      let stage = 0;
      try {
        await click('Continuar sem conta');
        await wait(() => document.getElementById('unlock-pin'));
        const pin = document.getElementById('unlock-pin');
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        ).set.call(pin, '721947350682');
        pin.dispatchEvent(new Event('input', { bubbles: true }));
        await click('Desbloquear');
        await click('SYNTHETIC FIN-002');
        await click('Importações');
        await wait(() => text().includes('SYNTHETIC-extrato.ofx'));
        await select('import-status-filter', 'COMMITTED');
        await click('Concluído');
        await wait(() => text().includes('Detalhes do lote'));
        if (
          !text().includes('SYNTHETIC-extrato.ofx') ||
          !text().includes('2026-01-31')
        )
          throw Error('DETAIL');
        checks.list_filter_detail = true;
        stage = 1;
        await click('Ver movimentação e histórico');
        await wait(() => text().includes('Descrição original'));
        checks.revision_link = true;
        await click('Importações');
        await wait(
          () =>
            document.getElementById('import-target-account') &&
            [...document.getElementById('import-target-account').options].some(
              (o) => o.value,
            ),
        );
        const a = [
          ...document.getElementById('import-target-account').options,
        ].find((o) => o.value).value;
        await select('import-target-account', a);
        await click('Preparar lote');
        await wait(() => button('Repetir mesmo pedido'));
        if (!document.getElementById('import-target-account').disabled)
          throw Error('INTENT');
        await click('Repetir mesmo pedido');
        await wait(() => text().includes('Detalhes do lote'));
        checks.lost_ack_same_intent = true;
        stage = 2;
        const empty = await invoke('create_local_workspace', {
          input: {
            workspace_id: '0199d050-0000-7000-8000-000000009999',
            display_name: 'SYNTHETIC EMPTY US050',
            purpose: 'OTHER',
          },
        });
        const e = document.querySelector('.fm-workspace select');
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        ).set.call(e, empty.id);
        e.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(() => text().includes('Seu espaço local está pronto'));
        await click('Importações');
        await wait(() => text().includes('Nenhum lote encontrado'));
        if (text().includes('SYNTHETIC-extrato.ofx')) throw Error('ISOLATION');
        checks.workspace_isolation = true;
        await click('Bloquear agora');
        await wait(() => text().includes('Desbloquear'));
        if (
          text().includes('Conta de destino') ||
          text().includes('SYNTHETIC-extrato.ofx')
        )
          throw Error('LOCK');
        for (const [command, input] of [
          [
            'list_local_imports',
            { statuses: [], account_id: null, cursor: null, limit: 1 },
          ],
          [
            'read_local_import',
            {
              id: '0199d050-0000-7000-8000-000000000103',
              effect_after: null,
              effect_limit: 1,
            },
          ],
          [
            'prepare_local_import',
            {
              id: '0199d050-0000-7000-8000-000000009900',
              target_account_id: a,
            },
          ],
        ]) {
          let locked = false;
          try {
            await invoke(command, { workspaceId: w, input });
          } catch (e) {
            locked = e === 'LOCAL_LOCKED';
          }
          if (!locked) throw Error('LOCK_GATE');
        }
        checks.lock_hides_tree = true;
        stage = 3;
        if (forbidden || localStorage.length || sessionStorage.length)
          throw Error('IO');
        checks.no_storage_or_egress = true;
        await invoke('finish_imports_smoke', {
          report: { passed: true, checks },
        });
      } catch {
        await invoke('finish_imports_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    })();
  });
})();
