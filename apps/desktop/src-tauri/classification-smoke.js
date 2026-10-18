// SYNTHETIC_US045_CLASSIFICATION_ONLY. Test-only driver; never a product asset.
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
  const id = (n) => '0199d345-0000-7000-8000-' + String(n).padStart(12, '0'),
    text = () => document.body.textContent,
    wait = (condition) =>
      new Promise((resolve, reject) => {
        const start = Date.now(),
          timer = setInterval(() => {
            if (condition()) {
              clearInterval(timer);
              resolve();
            } else if (Date.now() - start > 90000) {
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
    field = (id) => document.getElementById(id),
    fill = async (id, value) => {
      await wait(
        () =>
          field(id) &&
          !field(id).matches(':disabled') &&
          (field(id).tagName !== 'SELECT' ||
            [...field(id).options].some((o) => o.value === value)),
      );
      const e = field(id),
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
    tag = async (name) => {
      await wait(() =>
        [...document.querySelectorAll('.classification-editor label')].some(
          (l) => l.textContent.includes(name),
        ),
      );
      const e = [...document.querySelectorAll('.classification-editor label')]
        .find((l) => l.textContent.includes(name))
        .querySelector('input');
      if (!e.checked) e.click();
    },
    choose = async (w) => {
      await wait(() => document.querySelector('.fm-workspace select'));
      const e = document.querySelector('.fm-workspace select');
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(e, w);
      e.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => text().includes('Seu espaço local está pronto'));
    },
    open = async () => {
      await click('Movimentações');
      await click('Filtrar por classificação');
      await wait(() => document.querySelector('.classification-results'));
    },
    edit = async (name) => {
      await click(name);
      await click('Editar classificação e tags');
      await wait(() => document.querySelector('.classification-editor form'));
    },
    back = async () => {
      await click('Voltar aos resultados');
      await wait(() => document.querySelector('.classification-results'));
    },
    save = async () => {
      await click('Salvar classificação');
      await wait(() => button('Voltar aos resultados'));
    };
  window.addEventListener('DOMContentLoaded', async () => {
    const checks = {},
      invoke = window.__TAURI_INTERNALS__.invoke;
    let stage = 1;
    try {
      stage = 10;
      await click('Continuar sem conta');
      await fill('unlock-pin', '721947350682');
      await click('Desbloquear');
      stage = 11;
      await click('SYNTHETIC US045 EMPTY');
      stage = 12;
      await wait(() => document.querySelector('.fm-workspace select'));
      const w = document.querySelector('.fm-workspace select').value,
        read = () =>
          invoke('read_local_movements', {
            workspaceId: w,
            includeClassification: true,
          });
      const before = await read(),
        splitBefore = JSON.stringify(
          before.transactions.find((r) => r.id === id(812)).content.allocations,
        );
      await click('Movimentações');
      stage = 13;
      await click('SYNTHETIC CLASSIFICATION IMPORT');
      stage = 14;
      await click('Classificar movimentação');
      await click('Editar classificação e tags');
      stage = 15;
      await fill('classification-edit-mode', 'SET');
      await fill('classification-edit-category', id(700));
      await fill('classification-edit-subcategory', id(702));
      await tag('SYNTHETIC CLASSIFICATION TAG 701');
      stage = 16;
      await click('Salvar classificação');
      await wait(() => button('Repetir mesma tentativa'));
      stage = 17;
      if (!field('classification-edit-mode').matches(':disabled'))
        throw Error('INTENT_EDITABLE');
      await click('Repetir mesma tentativa');
      await wait(() =>
        text().includes('A base mudou ou esta tentativa já foi registrada'),
      );
      stage = 18;
      await click('Consultar resultado e revisar');
      await wait(() => button('Voltar aos resultados'));
      stage = 19;
      const imported = (await read()).transactions.find(
        (r) => r.id === id(810),
      );
      if (
        imported.version !== '2' ||
        imported.content.origin_kind !== 'IMPORT' ||
        imported.content.allocations[0]?.subcategory_id !== id(702)
      )
        throw Error('IMPORT_HISTORY');
      checks.import_lost_ack_frozen_base = true;
      stage = 2;
      await back();
      await edit('SYNTHETIC CLASSIFICATION TRANSFER');
      await fill('classification-edit-mode', 'SET');
      await fill('classification-edit-category', id(700));
      await save();
      await back();
      await edit('SYNTHETIC CLASSIFICATION CARD');
      await tag('SYNTHETIC CLASSIFICATION TAG 706');
      await save();
      const grouped = await read();
      for (const n of [820, 830]) {
        const pair = grouped.transactions.filter(
          (r) => r.content.group_id === id(n),
        );
        if (
          pair.length !== 2 ||
          pair.filter((r) => r.version === '2').length !== 1 ||
          pair.filter((r) => r.version === '1').length !== 1
        )
          throw Error('PARTNER_REVISION');
      }
      checks.paired_transfer_and_card = true;
      stage = 3;
      await back();
      await edit('SYNTHETIC CLASSIFICATION SPLIT');
      if (
        !field('classification-edit-mode').querySelector('option[value="SET"]')
          .disabled ||
        !field('classification-edit-mode').querySelector(
          'option[value="CLEAR"]',
        ).disabled
      )
        throw Error('SPLIT_EDITABLE');
      await tag('SYNTHETIC CLASSIFICATION TAG 706');
      await save();
      if (
        JSON.stringify(
          (await read()).transactions.find((r) => r.id === id(812)).content
            .allocations,
        ) !== splitBefore
      )
        throw Error('SPLIT_CHANGED');
      checks.split_tags_preserve_allocations = true;
      stage = 4;
      await back();
      await edit('SYNTHETIC CLASSIFICATION IMPORT');
      await save();
      if (
        (await read()).transactions.find((r) => r.id === id(810)).version !==
        '2'
      )
        throw Error('NOOP_AUDIT');
      await click('Editar classificação e tags');
      await fill('classification-edit-mode', 'CLEAR');
      await save();
      const cleared = (await read()).transactions.find((r) => r.id === id(810));
      if (
        cleared.version !== '3' ||
        cleared.content.allocations.length ||
        !cleared.content.tag_ids.includes(id(701))
      )
        throw Error('CLEAR');
      if (!text().includes('Versão 3')) throw Error('HISTORY_MISSING');
      checks.clear_noop_and_history = true;
      stage = 5;
      const rows = await invoke('list_local_workspaces');
      await choose(rows.find((r) => r.id !== w).id);
      await open();
      if (text().includes('SYNTHETIC CLASSIFICATION IMPORT'))
        throw Error('WORKSPACE_LEAK');
      await choose(w);
      await open();
      checks.workspace_isolation = true;
      stage = 6;
      await edit('SYNTHETIC CLASSIFICATION IMPORT');
      await click('Bloquear agora');
      await wait(() => field('unlock-pin'));
      if (
        document.querySelector('.classification-editor') ||
        text().includes('SYNTHETIC CLASSIFICATION IMPORT')
      )
        throw Error('LOCK_LEAK');
      checks.lock_removes_editor_tree = true;
      if (
        forbidden ||
        localStorage.length ||
        sessionStorage.length ||
        (await indexedDB.databases()).length
      )
        throw Error('PERSISTENCE');
      checks.no_storage_or_egress = true;
      await invoke('finish_classification_smoke', {
        report: { passed: true, checks },
      });
    } catch (error) {
      const allowed = [
        'TIMEOUT',
        'INTENT_EDITABLE',
        'IMPORT_HISTORY',
        'PARTNER_REVISION',
        'SPLIT_EDITABLE',
        'SPLIT_CHANGED',
        'NOOP_AUDIT',
        'CLEAR',
        'HISTORY_MISSING',
        'WORKSPACE_LEAK',
        'LOCK_LEAK',
        'PERSISTENCE',
      ];
      const code = allowed.includes(error?.message)
        ? error.message
        : 'UNEXPECTED';
      await invoke('finish_classification_smoke', {
        report: {
          passed: false,
          checks,
          failure_stage: stage,
          failure_code: code,
        },
      });
    }
  });
})();
