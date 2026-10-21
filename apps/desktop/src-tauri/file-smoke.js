// FIN-002 synthetic driver. Excluded from the production frontend.
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
        stage = 1;
        await unlock();
        stage = 2;
        await click('SYNTHETIC FIN-002');
        stage = 3;
        await click('Importações');
        stage = 4;
        await click('Em preparação');
        stage = 5;
        await click('Selecionar arquivo para validar');
        stage = 6;
        await wait(() => document.getElementById('unlock-pin'));
        if (body().includes('SYNTHETIC-selected.csv'))
          throw Error('LOCKED_FILENAME');
        await unlock();
        stage = 7;
        await click('Validar arquivo');
        stage = 8;
        await wait(() => body().includes('Estrutura validada'));
        if (
          !body().includes('SYNTHETIC-selected.csv') ||
          body().includes('SYNTHETIC private row')
        )
          throw Error('METADATA_ONLY');
        checks.gui_picker_unlock_validate = true;
        stage = 10;
        const selected = await file({ action: 'SELECT', batch_id: b });
        let blocked = false;
        try {
          await file({
            action: 'VALIDATE',
            batch_id: b,
            selection_id: selected.selection_id,
            encoding: 'utf-8',
            delimiter: ',',
          });
        } catch (e) {
          blocked = e === 'LOCAL_LOCKED';
        }
        if (!blocked) throw Error('LOCK_GATE');
        checks.locked_no_validation = true;
        await invoke('unlock_local_session', { input: { pin } });
        let foreign = false;
        try {
          await file({
            action: 'VALIDATE',
            batch_id: '0199d050-0000-7000-8000-000000009999',
            selection_id: selected.selection_id,
            encoding: 'utf-8',
            delimiter: ',',
          });
        } catch {
          foreign = true;
        }
        if (!foreign) throw Error('SCOPE');
        const result = await file({
          action: 'VALIDATE',
          batch_id: b,
          selection_id: selected.selection_id,
          encoding: 'utf-8',
          delimiter: ',',
        });
        if (result.result.outcome !== 'VALIDATED' || result.workspace_id !== w)
          throw Error('RESULT');
        let replay = false;
        try {
          await file({
            action: 'VALIDATE',
            batch_id: b,
            selection_id: selected.selection_id,
            encoding: 'utf-8',
            delimiter: ',',
          });
        } catch {
          replay = true;
        }
        if (!replay) throw Error('REPLAY');
        checks.scoped_one_shot_selection = true;
        stage = 20;
        const candidate = await file({ action: 'SELECT', batch_id: b });
        await file({ action: 'CANCEL' });
        await invoke('unlock_local_session', { input: { pin } });
        let cancelled = false;
        try {
          await file({
            action: 'VALIDATE',
            batch_id: b,
            selection_id: candidate.selection_id,
            encoding: 'utf-8',
            delimiter: ',',
          });
        } catch {
          cancelled = true;
        }
        const detail = await invoke('read_local_import', {
          workspaceId: w,
          input: { id: b, effect_after: null, effect_limit: 1 },
        });
        if (
          !cancelled ||
          detail.counts.total_items !== '0' ||
          detail.counts.total_effects !== '0' ||
          detail.sources.length
        )
          throw Error('LEDGER_CHANGED');
        checks.cancel_preserves_ledger = true;
        if (
          forbidden ||
          window.localStorage.length ||
          window.sessionStorage.length
        )
          throw Error('IO');
        checks.no_storage_or_egress = true;
        await invoke('finish_file_smoke', { report: { passed: true, checks } });
      } catch {
        await invoke('finish_file_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    })();
  });
})();
