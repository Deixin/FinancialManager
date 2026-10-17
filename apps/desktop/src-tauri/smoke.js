// Test executable only. Network/storage faults do not alter the user's OS or profile.
(() => {
  let attempts = 0;
  Object.defineProperty(navigator, 'onLine', { get: () => false });
  const deny = () => {
    attempts++;
    throw Error('ENTRY_SMOKE_FORBIDDEN_IO');
  };
  const originalFetch = window.fetch;
  window.fetch = (url, options) =>
    String(url).startsWith('http://ipc.localhost/finish_entry_smoke')
      ? originalFetch(url, options)
      : deny();
  window.XMLHttpRequest = deny;
  window.WebSocket = deny;
  Storage.prototype.setItem = deny;
  const wait = (condition) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (condition()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(Error('ENTRY_SMOKE_TIMEOUT'));
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
        checks.embedded_entry = document.title.includes('Boas-vindas');
        checks.cloud_disabled_offline =
          button('Entrar').disabled &&
          button('Criar conta').disabled &&
          document
            .querySelector('#cloud-status')
            .textContent.includes('sem internet');
        button('Continuar sem conta').click();
        await wait(
          () =>
            document.querySelector('.entry-badge')?.textContent ===
            'Modo local',
        );
        checks.local_without_identity =
          document.querySelector('h2').textContent === 'Primeiro espaço' &&
          !document.querySelector('input[type=email]');
        checks.local_heading_focus =
          document.activeElement === document.querySelector('h1');
        button('Voltar à entrada').click();
        await wait(() => button('Continuar sem conta'));
        checks.return_to_entry = !button('Continuar sem conta').disabled;
        checks.no_network_or_storage =
          attempts === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await window.__TAURI_INTERNALS__.invoke('finish_entry_smoke', {
          report: { passed: Object.values(checks).every(Boolean), checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_entry_smoke', {
          report: { passed: false, checks },
        });
      }
    },
    { once: true },
  );
})();
