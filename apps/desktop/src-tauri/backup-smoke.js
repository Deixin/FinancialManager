// Synthetic fixture only; this instrument is never embedded by the default host.
(() => {
  const PIN = '721947350682',
    PASSWORD = 'SYNTHETIC backup password US034';
  let forbidden = 0;
  const deny = () => {
    forbidden++;
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
  const text = () => document.body.textContent;
  const button = (name) =>
    [...document.querySelectorAll('button')].find((n) =>
      n.textContent.trim().startsWith(name),
    );
  const wait = (condition) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (condition()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 30000) {
          clearInterval(timer);
          reject(Error('TIMEOUT'));
        }
      }, 25);
    });
  const fill = async (id, value) => {
    await wait(
      () =>
        document.getElementById(id) && !document.getElementById(id).disabled,
    );
    const input = document.getElementById(id);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const unlock = async () => {
    await fill('unlock-pin', PIN);
    await wait(() => button('Desbloquear') && !button('Desbloquear').disabled);
    button('Desbloquear').click();
    await wait(() => document.querySelector('.local-list button'));
    document.querySelector('.local-list button').click();
    await wait(() => button('Backup local'));
    button('Backup local').click();
    await wait(() => document.getElementById('backup-password'));
  };
  const submit = async () => {
    await fill('backup-password', PASSWORD);
    await fill('backup-confirmation', PASSWORD);
    const ack = document.querySelector('.backup-ack input');
    if (!ack.checked) ack.click();
    await wait(
      () =>
        button('Criar backup criptografado') &&
        !button('Criar backup criptografado').disabled,
    );
    button('Criar backup criptografado').click();
    await wait(() => text().includes('Criando backup'));
    window.dispatchEvent(new Event('blur'));
    if (
      text().includes('SYNTHETIC') ||
      document.querySelector('#backup-password')
    )
      throw Error('PRIVATE_VIEW_REMAINS');
  };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      try {
        await wait(() => button('Continuar sem conta'));
        button('Continuar sem conta').click();
        await wait(() => text().includes('Aplicativo bloqueado'));
        await unlock();
        checks.backup_form_policy_and_validation =
          text().includes('não será guardada') &&
          text().includes('64 MiB') &&
          text().includes('Guarde-a separadamente') &&
          button('Criar backup criptografado').disabled;
        await submit();
        checks.ipc_export_hides_financial_tree = true;
        await wait(() =>
          text().includes('Backup criptografado criado e verificado'),
        );
        checks.verified_notice_keeps_pin_locked =
          text().includes('Aplicativo bloqueado') &&
          !text().includes('SYNTHETIC');
        await unlock();
        await submit();
        await wait(() => text().includes('Criação de backup cancelada'));
        checks.chooser_cancel_preserves_closed_state =
          text().includes('Aplicativo bloqueado') &&
          !text().includes('SYNTHETIC');
        await unlock();
        await submit();
        await wait(() => text().includes('Não foi possível usar o destino'));
        checks.sanitized_destination_error =
          text().includes('Aplicativo bloqueado') &&
          !text().includes('SYNTHETIC') &&
          !text().includes('.fmbackup-');
        checks.no_storage_or_egress =
          forbidden === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await window.__TAURI_INTERNALS__.invoke('finish_backup_smoke', {
          report: { passed: Object.values(checks).every(Boolean), checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_backup_smoke', {
          report: { passed: false, checks },
        });
      }
    },
    { once: true },
  );
})();
