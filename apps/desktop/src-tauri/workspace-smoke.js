// Test binary only; production has no fixture globals or report command.
(() => {
  const mode = '__WORKSPACE_SMOKE_MODE__';
  let attempts = 0;
  Object.defineProperty(navigator, 'onLine', { get: () => false });
  const deny = () => {
    attempts++;
    throw Error('SYNTHETIC_FORBIDDEN_IO');
  };
  const original = window.fetch;
  window.fetch = (url, options) =>
    String(url).startsWith('http://ipc.localhost/')
      ? original(url, options)
      : deny();
  window.XMLHttpRequest = deny;
  window.WebSocket = deny;
  Storage.prototype.setItem = deny;
  const wait = (condition) =>
    new Promise((resolve, reject) => {
      const start = Date.now(),
        timer = setInterval(() => {
          if (condition()) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - start > 15000) {
            clearInterval(timer);
            reject(Error('SMOKE_TIMEOUT'));
          }
        }, 25);
    });
  const button = (text) =>
    [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim().startsWith(text),
    );
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      try {
        await wait(() => button('Continuar sem conta'));
        button('Continuar sem conta').click();
        await wait(() =>
          mode === 'create'
            ? document.getElementById('workspace-name') &&
              !document.getElementById('workspace-name').disabled
            : button('SYNTHETIC US031 FIRST') &&
              !button('SYNTHETIC US031 FIRST').disabled,
        );
        checks.local_form_without_identity =
          !document.querySelector('input[type=email]') &&
          navigator.onLine === false;
        if (mode === 'create') {
          const field = document.getElementById('workspace-name');
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          ).set.call(field, 'SYNTHETIC US031 FIRST');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(
            () =>
              button('Criar espaço local') &&
              !button('Criar espaço local').disabled,
          );
          button('Criar espaço local').click();
        } else button('SYNTHETIC US031 FIRST').click();
        await wait(() =>
          [...document.querySelectorAll('h2')].some(
            (node) => node.textContent === 'Seu espaço local está pronto',
          ),
        );
        checks.created_via_narrow_ipc = document.body.textContent.includes(
          'SYNTHETIC US031 FIRST',
        );
        checks.empty_overview_without_fake_balance =
          document.body.textContent.includes(
            'Nenhuma conta financeira cadastrada',
          ) && !document.body.textContent.includes('R$');
        button('Ver espaços locais').click();
        await wait(() => button('SYNTHETIC US031 FIRST'));
        checks.reopened_or_listed = true;
        checks.no_web_storage_or_egress =
          attempts === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await window.__TAURI_INTERNALS__.invoke('finish_workspace_smoke', {
          report: { passed: Object.values(checks).every(Boolean), checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_workspace_smoke', {
          report: { passed: false, checks },
        });
      }
    },
    { once: true },
  );
})();
