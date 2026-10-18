// SYNTHETIC_US045_FILTERS_ONLY. Excluded from product assets.
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
  const wait = (condition) =>
      new Promise((resolve, reject) => {
        const start = Date.now(),
          timer = setInterval(() => {
            if (condition()) {
              clearInterval(timer);
              resolve();
            } else if (Date.now() - start > 60000) {
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
    fill = async (id, value) => {
      await wait(() => document.getElementById(id));
      const e = document.getElementById(id),
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
    count = () =>
      document.querySelectorAll('.classification-results > li').length,
    open = async () => {
      await click('Movimentações');
      await click('Filtrar por classificação');
      await wait(() => document.querySelector('.classification-results'));
    },
    choose = async (w) => {
      await wait(() => document.querySelector('.fm-workspace select'));
      const e = document.querySelector('.fm-workspace select');
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(e, w);
      e.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() =>
        document.body.textContent.includes('Seu espaço local está pronto'),
      );
    };
  window.addEventListener('DOMContentLoaded', async () => {
    const checks = {},
      invoke = window.__TAURI_INTERNALS__.invoke;
    let stage = 1;
    try {
      await click('Continuar sem conta');
      await fill('unlock-pin', '721947350682');
      await click('Desbloquear');
      const rows = await invoke('list_local_workspaces'),
        w = '0199d025-0000-7000-8000-000000000001',
        row = rows.find((r) => r.id === w);
      await click(row.display_name);
      await open();
      const raw = await invoke('read_local_movements', {
          workspaceId: w,
          includeClassification: true,
        }),
        live = raw.transactions.filter((r) => !r.content.deleted);
      if (!live.length || count() !== live.length || !raw.classification)
        throw Error('COVERAGE');
      checks.complete_filter_read = true;
      stage = 2;
      const used = live.find(
        (r) =>
          r.content.allocations.some((a) => a.subcategory_id) &&
          r.content.tag_ids.length,
      );
      if (!used) throw Error('FIXTURE');
      const a = used.content.allocations.find((a) => a.subcategory_id),
        tag = raw.classification.items.find(
          (r) => r.kind === 'TAG' && r.id === used.content.tag_ids[0],
        );
      await fill('classification-category', a.category_id);
      await fill('classification-subcategory', a.subcategory_id);
      const input = [...document.querySelectorAll('label.backup-ack')]
        .find((e) => e.textContent.includes(tag.name))
        .querySelector('input');
      input.click();
      const expected = live.filter(
        (r) =>
          r.content.allocations.some(
            (x) =>
              x.category_id === a.category_id &&
              x.subcategory_id === a.subcategory_id,
          ) && r.content.tag_ids.includes(tag.id),
      ).length;
      await wait(() => count() === expected);
      if (expected === 0) throw Error('NO_MATCH');
      checks.category_subcategory_and_tags = true;
      stage = 3;
      const other = rows.find((r) => r.id !== w).id;
      await choose(other);
      await open();
      if (count() !== 0) throw Error('WORKSPACE_LEAK');
      await choose(w);
      await open();
      await wait(() => count() === live.length);
      checks.workspace_isolation = true;
      stage = 4;
      await click('Bloquear agora');
      await wait(() => document.getElementById('unlock-pin'));
      if (
        document.querySelector('.classification-filters-flow') ||
        document.body.textContent.includes(used.content.display_name)
      )
        throw Error('LOCK_LEAK');
      checks.lock_removes_tree = true;
      if (
        forbidden ||
        localStorage.length ||
        sessionStorage.length ||
        (await indexedDB.databases()).length
      )
        throw Error('PERSISTENCE');
      checks.no_storage_or_egress = true;
      await invoke('finish_classification_filters_smoke', {
        report: { passed: true, checks },
      });
    } catch {
      await invoke('finish_classification_filters_smoke', {
        report: { passed: false, checks, failure_stage: stage },
      });
    }
  });
})();
