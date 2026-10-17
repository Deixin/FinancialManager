// Synthetic-only native WebView protocol, never included in the product default.
(() => {
  const PIN = '721947350682';
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
          } else if (Date.now() - start > 20000) {
            clearInterval(timer);
            reject(Error('SMOKE_TIMEOUT'));
          }
        }, 25);
    });
  const button = (text) =>
    [...document.querySelectorAll('button')].find((node) =>
      node.textContent.trim().startsWith(text),
    );
  const text = () => document.body.textContent;
  const fill = async (id, value) => {
    await wait(
      () =>
        document.getElementById(id) && !document.getElementById(id).disabled,
    );
    const field = document.getElementById(id);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const submit = async () => {
    await wait(() => button('Desbloquear') && !button('Desbloquear').disabled);
    button('Desbloquear').click();
  };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      try {
        await wait(() => button('Continuar sem conta'));
        button('Continuar sem conta').click();
        await wait(() => text().includes('Aplicativo bloqueado'));
        checks.boot_locked_without_names =
          !text().includes('SYNTHETIC') &&
          !document.querySelector('#workspace-name');
        await fill('unlock-pin', '682035741921');
        await submit();
        await wait(() => text().includes('PIN incorreto'));
        checks.wrong_pin_preserves_closed_view =
          text().includes('Aplicativo bloqueado') &&
          !text().includes('SYNTHETIC') &&
          document.getElementById('unlock-pin').value === '';
        await fill('unlock-pin', PIN);
        await submit();
        await wait(() => text().includes('Seus espaços locais'));
        const row = () =>
          [...document.querySelectorAll('.local-list button')][0];
        await wait(() => row());
        row().click();
        await wait(() => text().includes('Seu espaço local está pronto'));
        checks.unlock_through_native_commands = text().includes('SYNTHETIC');
        button('Bloquear agora').click();
        await wait(() => text().includes('Aplicativo bloqueado'));
        if (text().includes('SYNTHETIC')) throw Error('STALE_FINANCIAL_VIEW');
        await fill('unlock-pin', PIN);
        await submit();
        await wait(() => row());
        row().click();
        await wait(() => text().includes('Seu espaço local está pronto'));
        window.dispatchEvent(new Event('blur'));
        await wait(() => text().includes('Aplicativo bloqueado'));
        checks.manual_and_blur_remove_financial_tree =
          !text().includes('SYNTHETIC');
        await fill('unlock-pin', PIN);
        await submit();
        await wait(() => button('Privacidade local'));
        button('Privacidade local').click();
        await wait(() => document.getElementById('disable-pin'));
        if (
          !text().includes('reiniciar') ||
          !text().includes('30 segundos') ||
          !text().includes('Windows Hello')
        )
          throw Error('POLICY_MISSING');
        await fill('disable-pin', PIN);
        await wait(
          () => button('Desativar PIN') && !button('Desativar PIN').disabled,
        );
        button('Desativar PIN').click();
        await wait(() => text().includes('Proteção por PIN desativada.'));
        checks.policy_and_disable_with_current_pin =
          !document.getElementById('disable-pin') && !button('Bloquear agora');
        checks.no_storage_or_egress =
          attempts === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await window.__TAURI_INTERNALS__.invoke('finish_lock_smoke', {
          report: { passed: Object.values(checks).every(Boolean), checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_lock_smoke', {
          report: { passed: false, checks },
        });
      }
    },
    { once: true },
  );
})();
