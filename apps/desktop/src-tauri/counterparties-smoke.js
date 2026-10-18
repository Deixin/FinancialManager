// SYNTHETIC_US047_COUNTERPARTIES_ONLY. Test-only driver; never a product asset.
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
          invoke('read_local_counterparties', {
            workspaceId: w,
            includeMovements: true,
          });
      const before = await read();
      await click('Configurações');
      await click('Gerenciar contrapartes');
      await wait(() => button('Nova contraparte'));
      await click('Nova contraparte');
      await fill('counterparty-name', 'SYNTHETIC COUNTERPARTY 900');
      await click('Salvar cadastro');
      await wait(() => text().includes('Cadastro salvo.'));
      let cat = await read();
      if (
        cat.items.filter((r) => r.display_name === 'SYNTHETIC COUNTERPARTY 900')
          .length !== 2
      )
        throw Error('CATALOG');
      await click('Editar SYNTHETIC COUNTERPARTY 900');
      await fill('counterparty-status', 'ARCHIVED');
      await click('Salvar cadastro');
      await wait(() => text().includes('Cadastro salvo.'));
      cat = await read();
      if (cat.items.find((r) => r.id === id(900)).status !== 'ARCHIVED')
        throw Error('CATALOG');
      await click('Editar SYNTHETIC COUNTERPARTY 900');
      await fill('counterparty-status', 'ACTIVE');
      await click('Salvar cadastro');
      await wait(() => text().includes('Cadastro salvo.'));
      cat = await read();
      if (cat.items.find((r) => r.id === id(900)).status !== 'ACTIVE')
        throw Error('CATALOG');
      checks.catalog_reuse_archive_homonyms = true;
      stage = 2;
      await click('Movimentações');
      await click('SYNTHETIC CLASSIFICATION IMPORT');
      await click('Editar contraparte');
      await fill('counterparty-selection', id(900));
      await click('Salvar contraparte');
      await wait(() => button('Repetir mesma tentativa'));
      if (
        !document
          .querySelector('[aria-label="Editar contraparte"] fieldset')
          .matches(':disabled')
      )
        throw Error('INTENT');
      await click('Repetir mesma tentativa');
      await wait(() => text().includes('Os dados mudaram'));
      await click('Consultar resultado e revisar');
      await wait(() => field('counterparty-selection'));
      let snap = await read(),
        changed = snap.movements.transactions.find((r) => r.id === id(810)),
        original = before.movements.transactions.find((r) => r.id === id(810));
      let expected = { ...original.content, counterparty_id: id(900) };
      if (
        changed.version !== '2' ||
        JSON.stringify(changed.content) !== JSON.stringify(expected)
      )
        throw Error('IMPORT');
      checks.import_association_lost_ack_frozen_base = true;
      stage = 3;
      await fill('counterparty-selection', 'KEEP');
      await click('Salvar contraparte');
      await wait(() => text().includes('sem nova revisão'));
      await fill('counterparty-selection', 'CLEAR');
      await click('Salvar contraparte');
      await wait(() => text().includes('Histórico atualizado'));
      snap = await read();
      if (
        snap.movements.transactions.find((r) => r.id === id(810)).content
          .counterparty_id !== null
      )
        throw Error('CLEAR');
      checks.clear_noop_and_history = true;
      stage = 4;
      for (const [name, n, partner] of [
        ['SYNTHETIC CLASSIFICATION TRANSFER', 821, 822],
        ['SYNTHETIC CLASSIFICATION CARD', 831, 832],
      ]) {
        await click('Voltar sem nova gravação');
        await click('Movimentações');
        const source = () =>
          [...document.querySelectorAll('.local-list button')].find(
            (b) =>
              b.textContent.includes(name) &&
              b.textContent.includes('SYNTHETIC CLASSIFICATION ACCOUNT 800'),
          );
        await wait(() => source() && !source().matches(':disabled'));
        source().click();
        await click('Editar contraparte');
        await fill('counterparty-selection', id(900));
        await click('Salvar contraparte');
        await wait(() => text().includes('Histórico atualizado'));
        snap = await read();
        if (
          snap.movements.transactions.find((r) => r.id === id(n)).content
            .counterparty_id !== id(900) ||
          snap.movements.transactions.find((r) => r.id === id(partner))
            .version !==
            before.movements.transactions.find((r) => r.id === id(partner))
              .version
        )
          throw Error('PARTNER');
      }
      checks.paired_transfer_and_card = true;
      stage = 5;
      const spaces = await invoke('list_local_workspaces');
      await choose(spaces.find((r) => r.id !== w).id);
      if (document.querySelector('[aria-label="Editar contraparte"]'))
        throw Error('WORKSPACE');
      checks.workspace_isolation = true;
      await choose(w);
      await click('Movimentações');
      await click('SYNTHETIC CLASSIFICATION IMPORT');
      await click('Editar contraparte');
      await wait(() => field('counterparty-selection'));
      await click('Bloquear agora');
      await wait(() => text().includes('Desbloquear'));
      if (
        document.querySelector('[aria-label="Editar contraparte"]') ||
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
      await invoke('finish_counterparties_smoke', {
        report: { passed: true, checks },
      });
    } catch (e) {
      await invoke('finish_counterparties_smoke', {
        report: {
          passed: false,
          checks,
          failure_stage: stage,
          failure_code: [
            'TIMEOUT',
            'CATALOG',
            'INTENT',
            'IMPORT',
            'CLEAR',
            'PARTNER',
            'WORKSPACE',
            'LOCK',
            'PERSISTENCE',
          ].includes(e?.message)
            ? e.message
            : 'UNEXPECTED',
        },
      });
    }
  });
})();
