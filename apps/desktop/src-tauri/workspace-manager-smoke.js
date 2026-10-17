// SYNTHETIC_US036_ONLY. Optional WebView2 instrumentation, never a default asset.
(() => {
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
        } else if (Date.now() - started > 120000) {
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
    const input = document.getElementById(id);
    const prototype =
      input.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  };
  const selector = () => document.querySelector('.fm-workspace select');
  const create = async (name, purpose) => {
    await click('Criar outro espaço local');
    await fill('workspace-name', name);
    await fill('workspace-purpose', purpose);
    await click('Criar espaço local');
    await wait(() => selector());
  };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      try {
        await click('Continuar sem conta');
        await wait(
          () => document.querySelectorAll('.local-list li').length === 13,
        );
        await fill('workspace-filter', 'cloud');
        await wait(() => text().includes('exigem conta'));
        if (document.querySelector('.local-list li'))
          throw Error('CLOUD_MISREPRESENTED');
        await fill('workspace-filter', 'local');
        await click('SYNTHETIC US036 PRIMARY');
        await wait(() => selector());
        checks.catalog_purpose_local_and_cloud_unavailable =
          selector().options.length === 13 &&
          selector().textContent.includes('Local') &&
          selector().textContent.includes('Empresa');
        await click('Criar outro espaço local');
        await wait(() => document.getElementById('workspace-name'));
        if (
          !text().includes('Novo espaço local') ||
          document.getElementById('workspace-name').value !== ''
        )
          throw Error('OLD_FORM_RETAINED');
        await click('Cancelar criação');
        await wait(
          () => document.querySelectorAll('.local-list li').length === 13,
        );
        await create('SYNTHETIC US036 UI A', 'PERSONAL');
        const first = selector().value;
        if (selector().options.length !== 14) throw Error('CATALOG_TRUNCATED');
        await click('Configurações');
        await wait(() => text().includes('Configurações do espaço'));
        selector().value = '0199d025-0000-7000-8000-000000000001';
        selector().dispatchEvent(new Event('change', { bubbles: true }));
        await wait(() => !document.querySelector('.fm-shell'));
        await wait(() => selector());
        checks.switch_resets_context_and_route =
          text().includes('Seu espaço local está pronto') &&
          !text().includes('Nome: SYNTHETIC US036 UI A');
        await create('SYNTHETIC US036 UI B', 'BUSINESS');
        checks.create_multiple_and_cancel =
          selector().value !== first && selector().options.length === 15;
        await click('Voltar à entrada');
        await click('Continuar sem conta');
        await wait(
          () => document.querySelectorAll('.local-list li').length === 15,
        );
        await click('SYNTHETIC US036 UI B');
        await wait(() => selector());
        checks.full_selector_after_reentry =
          selector().options.length === 15 &&
          text().includes('SYNTHETIC US036 UI B');
        checks.no_storage_or_egress =
          forbidden === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await window.__TAURI_INTERNALS__.invoke(
          'finish_workspace_manager_smoke',
          { report: { passed: Object.values(checks).every(Boolean), checks } },
        );
      } catch {
        await window.__TAURI_INTERNALS__.invoke(
          'finish_workspace_manager_smoke',
          { report: { passed: false, checks } },
        );
      }
    },
    { once: true },
  );
})();
