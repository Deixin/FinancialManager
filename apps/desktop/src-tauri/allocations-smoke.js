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
      await click('Editar rateio');
      await wait(() => document.querySelector('.classification-editor form'));
    },
    back = async () => {
      await click('Voltar aos resultados');
      await wait(() => document.querySelector('.classification-results'));
    },
    save = async () => {
      await click('Salvar rateio');
      await wait(() => button('Voltar aos resultados'));
    };

  const rowFields = () => [
    ...document.querySelectorAll('[id^="allocation-category-"]'),
  ];
  const row = async (index, cat, amount, note = '') => {
    await wait(() => rowFields().length > index);
    const suffix = rowFields()[index].id.slice('allocation-category-'.length);
    await fill('allocation-category-' + suffix, id(cat));
    await fill('allocation-amount-' + suffix, amount);
    await fill('allocation-note-' + suffix, note);
  };
  const split = async () => {
    await fill('allocation-edit-mode', 'REPLACE');
    await click('Adicionar parcela');
    await click('Adicionar parcela');
    await row(0, 700, '7,00', 'SYNTHETIC SPLIT NOTE');
    await row(1, 704, '2,99');
    if (
      !button('Salvar rateio').matches(':disabled') ||
      !text().includes('Diferença: R$ 0,01')
    )
      throw Error('TOTAL');
    await row(1, 704, '3,00');
  };
  window.addEventListener('DOMContentLoaded', async () => {
    const checks = {},
      invoke = window.__TAURI_INTERNALS__.invoke;
    let stage = 1;
    try {
      await click('Continuar sem conta');
      await fill('unlock-pin', '721947350682');
      await click('Desbloquear');
      await click('SYNTHETIC US045 EMPTY');
      await wait(() => document.querySelector('.fm-workspace select'));
      const w = document.querySelector('.fm-workspace select').value,
        read = () =>
          invoke('read_local_movements', {
            workspaceId: w,
            includeClassification: true,
          }),
        before = await read();
      await click('Movimentações');
      await click('SYNTHETIC CLASSIFICATION IMPORT');
      await click('Classificar movimentação');
      await click('Editar rateio');
      await wait(() => document.querySelector('.allocation-editor form'));
      stage = 2;
      await split();
      await click('Salvar rateio');
      await wait(() => button('Repetir mesma tentativa'));
      if (
        !document
          .querySelector('.allocation-editor fieldset')
          .matches(':disabled')
      )
        throw Error('INTENT');
      await click('Repetir mesma tentativa');
      await wait(() => text().includes('A base mudou'));
      await click('Consultar resultado e revisar');
      await wait(() => button('Voltar aos resultados'));
      let s = await read(),
        imported = s.transactions.find((r) => r.id === id(810));
      if (
        imported.version !== '2' ||
        imported.content.origin_kind !== 'IMPORT' ||
        imported.content.allocations.length !== 2
      )
        throw Error('IMPORT');
      checks.import_split_lost_ack_frozen_base = true;
      stage = 3;
      await click('Editar rateio');
      await fill('allocation-edit-mode', 'CLEAR');
      await save();
      await back();
      for (const [n, partner] of [
        [821, 822],
        [831, 832],
      ]) {
        const before = await read(),
          source = before.transactions.find((r) => r.id === id(n)),
          other = before.transactions.find((r) => r.id === id(partner));
        await fill('classification-account', source.content.account_id);
        await edit(source.content.display_name);
        await split();
        await save();
        const after = await read();
        if (
          after.transactions.find((r) => r.id === other.id).version !==
          other.version
        )
          throw Error('PARTNER');
        await back();
        await fill('classification-account', '');
      }
      checks.paired_transfer_and_card = true;
      stage = 4;
      const splitBefore = (await read()).transactions.find(
        (r) => r.id === id(812),
      );
      await edit(splitBefore.content.display_name);
      await fill('allocation-edit-mode', 'REPLACE');
      await wait(() => rowFields().length === 2);
      const suffix = rowFields()[0].id.slice('allocation-category-'.length);
      await fill('allocation-note-' + suffix, 'SYNTHETIC REVISED SPLIT NOTE');
      await save();
      const splitAfter = (await read()).transactions.find(
        (r) => r.id === id(812),
      );
      if (
        JSON.stringify(splitAfter.content.allocations.map((a) => a.id)) !==
          JSON.stringify(splitBefore.content.allocations.map((a) => a.id)) ||
        splitAfter.content.allocations[0].note !==
          'SYNTHETIC REVISED SPLIT NOTE'
      )
        throw Error('PARCEL');
      await back();
      checks.split_edit_notes_and_exact_sum = true;
      stage = 5;
      await edit('SYNTHETIC CLASSIFICATION MANUAL');
      await split();
      await save();
      const manual = (await read()).transactions.find((r) => r.id === id(811));
      await click('Editar rateio');
      await fill('allocation-edit-mode', 'REPLACE');
      await click('Remover parcela 2');
      await row(0, 700, '10,00', 'SYNTHETIC SPLIT NOTE');
      await save();
      let current = await read(),
        one = current.transactions.find((r) => r.id === id(811));
      if (
        one.content.allocations.length !== 1 ||
        one.content.allocations[0].id !== manual.content.allocations[0].id
      )
        throw Error('COLLAPSE');
      const count = current.history.length;
      await click('Editar rateio');
      await save();
      current = await read();
      if (current.history.length !== count) throw Error('NOOP');
      imported = current.transactions.find((r) => r.id === id(810));
      if (
        imported.version !== '3' ||
        imported.content.allocations.length ||
        !text().includes('Antes:')
      )
        throw Error('HISTORY');
      for (const original of before.transactions) {
        const changed = current.transactions.find((r) => r.id === original.id);
        if (
          JSON.stringify(original.content.tag_ids) !==
          JSON.stringify(changed.content.tag_ids)
        )
          throw Error('TAGS');
      }
      checks.collapse_clear_noop_and_history = true;
      stage = 6;
      await click('Editar rateio');
      const spaces = await invoke('list_local_workspaces');
      await choose(spaces.find((r) => r.id !== w).id);
      if (
        document.querySelector('.allocation-editor') ||
        text().includes('SYNTHETIC CLASSIFICATION IMPORT')
      )
        throw Error('WORKSPACE');
      checks.workspace_isolation = true;
      await choose(w);
      await open();
      await edit('SYNTHETIC CLASSIFICATION IMPORT');
      await click('Bloquear agora');
      await wait(() => text().includes('Desbloquear'));
      if (
        document.querySelector('.allocation-editor') ||
        text().includes('SYNTHETIC CLASSIFICATION IMPORT')
      )
        throw Error('LOCK');
      checks.lock_removes_editor_tree = true;
      if (
        forbidden ||
        localStorage.length ||
        sessionStorage.length ||
        (await indexedDB.databases()).length
      )
        throw Error('PERSISTENCE');
      checks.no_storage_or_egress = true;
      await invoke('finish_allocations_smoke', {
        report: { passed: true, checks },
      });
    } catch (e) {
      const safe = [
        'TIMEOUT',
        'TOTAL',
        'INTENT',
        'IMPORT',
        'PARTNER',
        'PARCEL',
        'COLLAPSE',
        'NOOP',
        'HISTORY',
        'TAGS',
        'WORKSPACE',
        'LOCK',
        'PERSISTENCE',
      ];
      await invoke('finish_allocations_smoke', {
        report: {
          passed: false,
          checks,
          failure_stage: stage,
          failure_code: safe.includes(e?.message) ? e.message : 'UNEXPECTED',
        },
      });
    }
  });
})();
