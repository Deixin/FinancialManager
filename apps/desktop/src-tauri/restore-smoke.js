// SYNTHETIC_US035_ONLY. Feature-only WebView2 instrument, never a default asset.
(() => {
  const PIN = '721947350682',
    PASSWORD = 'SYNTHETIC restore password US035';
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
  const text = () => document.body.textContent,
    button = (name) =>
      [...document.querySelectorAll('button')].find(
        (n) =>
          n.textContent.trim() === name ||
          n.textContent.trim().startsWith(name),
      );
  const wait = (condition) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (condition()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 60000) {
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
  const click = async (name) => {
    await wait(() => button(name) && !button(name).disabled);
    button(name).click();
  };
  const unlock = async () => {
    await fill('unlock-pin', PIN);
    await click('Desbloquear');
    await wait(() => !text().includes('Aplicativo bloqueado'));
  };
  const select = async () => {
    await click('Restaurar backup');
    await wait(() => text().includes('Aplicativo bloqueado'));
  };
  const preview = async (password) => {
    await fill('restore-password', password);
    await click('Validar e apresentar prévia');
    await wait(() => text().includes('Processando restauração'));
    if (
      document.getElementById('restore-password') ||
      text().includes('SYNTHETIC existing')
    )
      throw Error('PRIVATE_FIELDS_VISIBLE');
  };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      let stage = 1;
      try {
        await click('Continuar sem conta');
        await wait(() => text().includes('Aplicativo bloqueado'));
        await unlock();
        await select();
        await wait(() => text().includes('Seleção de backup cancelada'));
        await unlock();
        await select();
        checks.picker_policy_and_reauthentication =
          text().includes('Aplicativo bloqueado') &&
          !document.getElementById('restore-password');
        await unlock();
        await wait(() => document.getElementById('restore-password'));
        stage = 2;
        await preview('SYNTHETIC incorrect secret');
        await wait(() =>
          text().includes('Senha incorreta ou pacote adulterado'),
        );
        checks.invalid_secret_preserves_existing =
          document.getElementById('restore-password').value === '' &&
          !text().includes(PASSWORD);
        stage = 3;
        await preview(PASSWORD);
        await wait(() => text().includes('Prévia da restauração'));
        checks.verified_preview_counts_and_no_publication =
          text().includes('Saldos de referência') &&
          text().includes('Revisões históricas') &&
          button('Restaurar como novo espaço').disabled;
        stage = 4;
        await click('Cancelar restauração');
        await wait(() => button('Restaurar backup'));
        checks.canceled_preview_removes_stage =
          !text().includes('Prévia da restauração') &&
          !document.getElementById('restore-password');
        stage = 5;
        await select();
        await unlock();
        stage = 6;
        await preview(PASSWORD);
        await wait(() => text().includes('Prévia da restauração'));
        stage = 7;
        document.querySelector('.backup-ack input').click();
        await click('Restaurar como novo espaço');
        stage = 8;
        await wait(
          () =>
            text().includes('Restauração concluída') ||
            document.querySelector('[role=alert]') ||
            text().includes('Aplicativo bloqueado'),
        );
        if (!text().includes('Restauração concluída'))
          throw Error('CONFIRMATION_NOT_ACCEPTED');
        stage = 9;
        await wait(
          () =>
            text().includes('Backup local') ||
            document.querySelector('[role=alert]') ||
            text().includes('Aplicativo bloqueado'),
        );
        if (!text().includes('Backup local'))
          throw Error('RESTORED_WORKSPACE_NOT_OPEN');
        checks.confirmed_restore_opens_new_local_workspace =
          text().includes('(restaurado)') &&
          text().includes('Local') &&
          !text().includes('Prévia da restauração');
        checks.no_storage_or_egress =
          forbidden === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await window.__TAURI_INTERNALS__.invoke('finish_restore_smoke', {
          report: { passed: Object.values(checks).every(Boolean), checks },
        });
      } catch {
        const state = text().includes('Aplicativo bloqueado')
          ? 1
          : text().includes('Não foi possível validar ou concluir')
            ? 2
            : text().includes('Não foi possível acessar')
              ? 3
              : text().includes('chave deste espaço')
                ? 4
                : text().includes('Processando restauração')
                  ? 5
                  : 0;
        await window.__TAURI_INTERNALS__.invoke('finish_restore_smoke', {
          report: { passed: false, checks, failure_stage: stage * 10 + state },
        });
      }
    },
    { once: true },
  );
})();
