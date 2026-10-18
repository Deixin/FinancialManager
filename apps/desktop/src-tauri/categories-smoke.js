// SYNTHETIC_US044_DESKTOP_ONLY. Test-only WebView2 driver, excluded from default assets.
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
    wait = (condition) =>
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
      }),
    button = (name) =>
      [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') ?? b.textContent.trim()).startsWith(name),
      ),
    click = async (name) => {
      await wait(() => button(name) && !button(name).disabled);
      button(name).click();
    },
    fill = async (id, value) => {
      await wait(
        () =>
          document.getElementById(id) && !document.getElementById(id).disabled,
      );
      const e = document.getElementById(id),
        p =
          e.tagName === 'SELECT'
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(p, 'value').set.call(e, value);
      e.dispatchEvent(
        new Event(e.tagName === 'SELECT' ? 'change' : 'input', {
          bubbles: true,
        }),
      );
    };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      let stage = 0;
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const progress = async (n) => {
        stage = n;
        await invoke('finish_categories_smoke', {
          report: { passed: false, checks, progress: true, failure_stage: n },
        });
      };
      try {
        await progress(1);
        await wait(() => button('Continuar sem conta'));
        await click('Continuar sem conta');
        await fill('unlock-pin', '721947350682');
        await click('Desbloquear');
        await progress(2);
        await wait(() =>
          [...document.querySelectorAll('button')].some((b) =>
            b.textContent.includes('SYNTHETIC US044 EMPTY'),
          ),
        );
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent.includes('SYNTHETIC US044 EMPTY'))
          .click();
        await click('Configurações');
        await progress(3);
        await click('Gerenciar categorias');
        await click('Usar categorias sugeridas');
        await wait(
          () => document.querySelectorAll('.category-row').length === 9,
        );
        await progress(4);
        await click('Editar Alimentação');
        await fill('category-name', 'SYNTHETIC US044 RENAMED');
        await click('Salvar categoria');
        await wait(
          () =>
            document.querySelectorAll('.category-row').length === 9 &&
            text().includes('SYNTHETIC US044 RENAMED'),
        );
        await click('Descer SYNTHETIC US044 RENAMED');
        await wait(
          () =>
            !document
              .querySelector('.category-flow')
              .getAttribute('aria-busy') ||
            document
              .querySelector('.category-flow')
              .getAttribute('aria-busy') === 'false',
        );
        await click('Arquivar SYNTHETIC US044 RENAMED');
        await wait(() =>
          [...document.querySelectorAll('.category-row')].some(
            (r) =>
              r.textContent.includes('SYNTHETIC US044 RENAMED') &&
              r.textContent.includes('Arquivada') &&
              r.textContent.includes('Sugestão inicial'),
          ),
        );
        checks.archive_keeps_seed_provenance = true;
        await click('Reativar SYNTHETIC US044 RENAMED');
        await wait(() => button('Arquivar SYNTHETIC US044 RENAMED'));
        checks.category_crud_seed_and_order = true;
        await progress(5);
        await click('Nova categoria');
        await fill('category-name', 'SYNTHETIC US044 UI');
        await click('Salvar categoria');
        await wait(() => button('Repetir mesma tentativa'));
        if (!document.getElementById('category-name').matches(':disabled'))
          throw Error('MUTABLE_INTENT');
        await click('Repetir mesma tentativa');
        await wait(
          () => document.querySelectorAll('.category-row').length === 10,
        );
        if (
          [...document.querySelectorAll('.category-row')].filter((r) =>
            r.textContent.includes('SYNTHETIC US044 UI'),
          ).length !== 1
        )
          throw Error('DUPLICATE');
        checks.lost_ack_frozen_category_id = true;
        await progress(6);
        const selector = document.querySelector('.fm-workspace select'),
          workspace = selector.value,
          other = [...selector.options].find(
            (o) => o.value !== workspace,
          ).value;
        await fill(selector.id, other);
        await wait(() => text().includes('Seu espaço local está pronto'));
        if (
          document.querySelector('.category-flow') ||
          text().includes('SYNTHETIC US044 UI')
        )
          throw Error('ISOLATION');
        await fill(
          document.querySelector('.fm-workspace select').id,
          workspace,
        );
        await wait(() => text().includes('Seu espaço local está pronto'));
        await click('Configurações');
        await click('Gerenciar categorias');
        await wait(
          () => document.querySelectorAll('.category-row').length === 10,
        );
        checks.workspace_isolation = true;
        await progress(7);
        await click('Bloquear agora');
        await wait(() => document.getElementById('unlock-pin'));
        if (
          document.querySelector('.category-flow') ||
          text().includes('SYNTHETIC US044 UI')
        )
          throw Error('LOCK');
        let denied = false;
        try {
          await invoke('read_local_categories', { workspaceId: workspace });
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
        await invoke('finish_categories_smoke', {
          report: { passed: true, checks },
        });
      } catch {
        await invoke('finish_categories_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    },
    { once: true },
  );
})();
