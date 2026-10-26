// FIN-002 SYNTHETIC OFX driver. Excluded from the production frontend.
/* global window,document,Storage,HTMLInputElement,Event,setInterval,clearInterval */
(() => {
  let forbidden = 0;
  const deny = () => {
      forbidden++;
      throw Error('FORBIDDEN_IO');
    },
    nativeFetch = window.fetch;
  window.fetch = (url, args) =>
    String(url).startsWith('http://ipc.localhost/')
      ? nativeFetch(url, args)
      : deny();
  window.XMLHttpRequest = deny;
  window.WebSocket = deny;
  Storage.prototype.setItem = deny;
  const w = '0199d025-0000-7000-8000-000000000001',
    b = '0199d050-0000-7000-8000-000000000100',
    pin = '721947350682';
  const wait = (condition) =>
    new Promise((resolve, reject) => {
      const started = Date.now(),
        timer = setInterval(() => {
          if (condition()) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - started > 60000) {
            clearInterval(timer);
            reject(Error('TIMEOUT'));
          }
        }, 25);
    });
  const body = () => document.body.textContent;
  const button = (label) =>
    [...document.querySelectorAll('button')].find((e) =>
      (e.getAttribute('aria-label') ?? e.textContent.trim()).startsWith(label),
    );
  const click = async (label) => {
    await wait(() => button(label) && !button(label).disabled);
    button(label).click();
  };
  const invoke = (command, args) =>
    window.__TAURI_INTERNALS__.invoke(command, args);
  const unlock = async () => {
    await wait(() => document.getElementById('unlock-pin'));
    const field = document.getElementById('unlock-pin');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(field, pin);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await click('Desbloquear');
  };
  const file = (input) =>
    invoke('local_import_file', { workspaceId: w, input });
  window.addEventListener('DOMContentLoaded', () => {
    void (async () => {
      const checks = {};
      let stage = 0;
      try {
        await click('Continuar sem conta');
        await unlock();
        await click('SYNTHETIC FIN-002');
        await click('Importações');
        await click('Em preparação');
        stage = 1;
        await click('Selecionar arquivo para validar');
        await wait(() => document.getElementById('unlock-pin'));
        await unlock();
        stage = 11;
        await wait(() => document.getElementById('file-format'));
        const format = document.getElementById('file-format');
        Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          'value',
        ).set.call(format, 'OFX');
        format.dispatchEvent(new Event('change', { bubbles: true }));
        stage = 12;
        await click('Validar arquivo');
        await wait(() => body().includes('Prévia OFX'));
        stage = 13;
        if (
          !body().includes('24 válidos e 1 inválidos') ||
          document.querySelectorAll('article').length !== 20
        )
          throw Error('PREVIEW');
        await click('Próximos itens');
        await wait(() => body().includes('Item 25'));
        if (document.querySelectorAll('article').length !== 5)
          throw Error('PAGES');
        checks.ofx_gui_pages_and_invalid_rows = true;
        stage = 2;
        const selected = await file({ action: 'SELECT', batch_id: b });
        await invoke('unlock_local_session', { input: { pin } });
        const value = await file({
          action: 'VALIDATE',
          batch_id: b,
          selection_id: selected.selection_id,
          encoding: 'utf-8',
          delimiter: null,
        });
        const model = value.result.normalization;
        if (
          model.destination.workspace_id !== w ||
          model.source.file_hash !== value.result.file_hash ||
          model.items.length !== 25 ||
          model.items[1].source_transaction_type !== 'XFER' ||
          !model.items[1].provenance.fields.type.endsWith('/TRNTYPE')
        )
          throw Error('SOURCE');
        checks.ofx_source_scope_and_provenance = true;
        stage = 3;
        let replay = false;
        try {
          await file({
            action: 'VALIDATE',
            batch_id: b,
            selection_id: selected.selection_id,
            encoding: 'utf-8',
            delimiter: null,
          });
        } catch {
          replay = true;
        }
        if (!replay) throw Error('REPLAY');
        const next = await file({ action: 'SELECT', batch_id: b });
        await invoke('unlock_local_session', { input: { pin } });
        await file({ action: 'CANCEL' });
        let cancelled = false;
        try {
          await file({
            action: 'VALIDATE',
            batch_id: b,
            selection_id: next.selection_id,
            encoding: 'utf-8',
            delimiter: null,
          });
        } catch {
          cancelled = true;
        }
        if (!cancelled) throw Error('CANCEL');
        checks.ofx_one_shot_and_cancel = true;
        stage = 4;
        if (!document.getElementById('unlock-pin'))
          await click('Bloquear agora');
        await wait(() => document.getElementById('unlock-pin'));
        if (
          body().includes('SYNTHETIC OFX private') ||
          body().includes('Prévia OFX')
        )
          throw Error('PRIVACY');
        checks.ofx_locked_private_tree = true;
        if (
          forbidden ||
          window.localStorage.length ||
          window.sessionStorage.length
        )
          throw Error('IO');
        checks.ofx_no_storage_egress = true;
        await invoke('finish_file_smoke', { report: { passed: true, checks } });
      } catch {
        await invoke('finish_file_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    })();
  });
})();
