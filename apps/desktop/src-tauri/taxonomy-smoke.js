// SYNTHETIC_US045_DESKTOP_ONLY. Test-only driver excluded from production assets.
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
      await wait(() => button(name) && !button(name).matches(':disabled'));
      button(name).click();
    },
    field = (label) =>
      document.getElementById(label) ??
      document.querySelector(`[aria-label="${label}"]`),
    fill = async (label, value) => {
      await wait(() => field(label) && !field(label).matches(':disabled'));
      const e = field(label),
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
    },
    choose = async (value) => {
      await wait(() => document.querySelector('.fm-workspace select'));
      const e = document.querySelector('.fm-workspace select');
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(e, value);
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
  window.addEventListener('DOMContentLoaded', async () => {
    const checks = {},
      invoke = window.__TAURI_INTERNALS__.invoke;
    let stage = 0;
    const progress = async (n) => {
        stage = n;
        await invoke('finish_taxonomy_smoke', {
          report: { passed: false, checks, progress: true, failure_stage: n },
        });
      },
      open = async () => {
        await click('Configurações');
        await click('Gerenciar subcategorias e tags');
        await wait(() => document.querySelector('.taxonomy-flow'));
      },
      create = async (kind, name) => {
        await click('Criar ' + kind);
        await fill('Nome do item', name);
        await click('Salvar item');
        await wait(() => button('Editar ' + name));
      };
    try {
      await progress(1);
      await click('Continuar sem conta');
      await fill('unlock-pin', '721947350682');
      await click('Desbloquear');
      await wait(() => button('SYNTHETIC US045 EMPTY'));
      await click('SYNTHETIC US045 EMPTY');
      await open();
      await progress(2);
      await click('Criar tag');
      await fill('Nome do item', 'SYNTHETIC INITIAL TAG');
      await click('Salvar item');
      await wait(() => button('Repetir mesma tentativa'));
      if (!field('Nome do item').matches(':disabled'))
        throw Error('INTENTION_EDITABLE');
      await click('Repetir mesma tentativa');
      await wait(() => button('Editar SYNTHETIC INITIAL TAG'));
      checks.lost_ack_frozen_taxonomy_id = true;
      await click('Editar SYNTHETIC INITIAL TAG');
      await fill('Nome do item', 'SYNTHETIC US045 UI');
      await click('Salvar item');
      await wait(() => button('Editar SYNTHETIC US045 UI'));
      await progress(3);
      await create('subcategoria', 'SYNTHETIC SUB FIRST');
      await create('subcategoria', 'SYNTHETIC SUB SECOND');
      await click('Descer SYNTHETIC SUB FIRST');
      await wait(() =>
        document
          .querySelector('.category-row')
          ?.textContent.includes('SYNTHETIC SUB SECOND'),
      );
      checks.taxonomy_crud_and_parent_order = true;
      await click('Arquivar SYNTHETIC SUB FIRST');
      await wait(() => button('Reativar SYNTHETIC SUB FIRST'));
      await click('Reativar SYNTHETIC SUB FIRST');
      await wait(() => button('Arquivar SYNTHETIC SUB FIRST'));
      await click('Editar SYNTHETIC SUB FIRST');
      if (field('Categoria da subcategoria')) throw Error('PARENT_MUTABLE');
      await click('Cancelar edição');
      checks.archive_retains_parent_identity = true;
      await progress(4);
      const current = document.querySelector('.fm-workspace select').value,
        other = [
          ...document.querySelector('.fm-workspace select').options,
        ].find((o) => o.value !== current && o.value).value;
      await choose(other);
      await wait(() => text().includes('Seu espaço local está pronto'));
      await open();
      if (text().includes('SYNTHETIC US045 UI')) throw Error('WORKSPACE_LEAK');
      await choose(current);
      await wait(() => text().includes('Seu espaço local está pronto'));
      await open();
      await wait(() => button('Editar SYNTHETIC US045 UI'));
      checks.workspace_isolation = true;
      await progress(5);
      await click('Bloquear agora');
      await wait(() => document.getElementById('unlock-pin'));
      if (
        document.querySelector('.taxonomy-flow') ||
        text().includes('SYNTHETIC US045 UI')
      )
        throw Error('LOCK_TREE_REMAINS');
      checks.lock_removes_financial_tree = true;
      await fill('unlock-pin', '721947350682');
      await click('Desbloquear');
      await click('SYNTHETIC US045 EMPTY');
      await open();
      await wait(() => button('Editar SYNTHETIC US045 UI'));
      await progress(6);
      if (
        forbidden ||
        localStorage.length ||
        sessionStorage.length ||
        (await indexedDB.databases()).length
      )
        throw Error('PERSISTENCE_OR_EGRESS');
      checks.no_storage_or_egress = true;
      await invoke('finish_taxonomy_smoke', {
        report: { passed: true, checks },
      });
    } catch {
      await invoke('finish_taxonomy_smoke', {
        report: { passed: false, checks, failure_stage: stage },
      });
    }
  });
})();
