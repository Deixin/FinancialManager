// SYNTHETIC_US040_ACCOUNTS_ONLY. Optional WebView2 instrumentation, excluded from default assets.
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
    button = (name) =>
      [...document.querySelectorAll('button')].find((b) =>
        b.textContent.trim().startsWith(name),
      ),
    selector = () => document.querySelector('.fm-workspace select');
  const wait = (condition) =>
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
    const el = document.getElementById(id),
      prototype =
        el.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  };
  const tick = async (label) => {
    await wait(() =>
      [...document.querySelectorAll('label')].some(
        (l) => l.textContent.trim() === label,
      ),
    );
    [...document.querySelectorAll('label')]
      .find((l) => l.textContent.trim() === label)
      .querySelector('input[type=checkbox]')
      .click();
  };
  window.addEventListener(
    'DOMContentLoaded',
    async () => {
      const checks = {};
      let stage = 0;
      try {
        const original = window.__TAURI_INTERNALS__.invoke;
        stage = 1;
        await click('Continuar sem conta');
        stage = 2;
        await fill('unlock-pin', '721947350682');
        await click('Desbloquear');
        stage = 3;
        await wait(() =>
          [...document.querySelectorAll('.local-list button')].some((b) =>
            b.textContent.includes('SYNTHETIC US040 EMPTY'),
          ),
        );
        [...document.querySelectorAll('.local-list button')]
          .find((b) => b.textContent.includes('SYNTHETIC US040 EMPTY'))
          .click();
        await wait(() => selector());
        const workspace = selector().value,
          other = [...selector().options].find(
            (o) => o.value !== workspace,
          ).value;
        stage = 4;
        await click('Contas e cartões');
        await wait(() => text().includes('Suas contas'));
        await fill('accounts-as-of', '2026-10-17');
        stage = 5;
        await click('Nova conta');
        await fill('account-name', 'SYNTHETIC DESKTOP ACCOUNT');
        await fill('account-kind', 'CASH');
        await tick('Informar saldo de referência');
        await fill('account-amount', '90071992547409,93');
        await fill('account-date', '2026-10-17');
        await fill('account-position', 'START_OF_DAY');
        stage = 6;
        await click('Criar conta');
        await wait(
          () =>
            document.querySelector('[role=alert]') &&
            document.getElementById('account-name'),
        );
        if (!document.getElementById('account-name').disabled)
          throw Error('INTENT_MUTABLE');
        await click('Repetir a mesma alteração');
        await wait(() => text().includes('Detalhe da conta'));
        // The optional Rust transport instrument also verifies byte-identical
        // replay and a no-op result after its deliberate post-commit failure.
        checks.lost_ack_reuses_same_intent = true;
        if (!text().includes('R$ 90.071.992.547.409,93'))
          throw Error('MONEY_PRECISION_LOST');
        stage = 7;
        await click('Editar conta');
        await fill('account-name', 'SYNTHETIC DESKTOP EDIT');
        await fill('account-institution', 'SYNTHETIC BANK');
        await click('Salvar conta');
        await wait(() => text().includes('Detalhe da conta'));
        stage = 8;
        await click('Arquivar conta');
        await wait(() => button('Reativar conta'));
        if (!button('Adicionar ou corrigir referência').disabled)
          throw Error('ARCHIVED_REFERENCE_ENABLED');
        await click('Reativar conta');
        await wait(() => button('Arquivar conta'));
        const before = await original('read_local_accounts', {
          workspaceId: workspace,
        });
        if (
          before.accounts.length !== 1 ||
          before.accounts[0].references.length !== 1
        )
          throw Error('ARCHIVE_CHANGED_HISTORY');
        checks.crud_and_canonical_money =
          before.accounts[0].account.name === 'SYNTHETIC DESKTOP EDIT' &&
          before.accounts[0].account.institution_name === 'SYNTHETIC BANK' &&
          before.accounts[0].references[0].amount_minor === '9007199254740993';
        stage = 9;
        await click('Adicionar ou corrigir referência');
        await fill('account-replaces', before.accounts[0].references[0].id);
        await fill('account-amount', '90071992547409,94');
        await fill('account-date', '2026-10-17');
        await fill('account-position', 'END_OF_DAY');
        if (!button('Salvar referência').disabled) throw Error('ACK_MISSING');
        await tick(
          'Reconheço a alteração da referência e a preservação do histórico.',
        );
        await click('Salvar referência');
        await wait(() => text().includes('Detalhe da conta'));
        stage = 10;
        await fill('account-observed', '90071992547409,94');
        await click('Conferir saldo');
        await wait(() => text().includes('Os saldos conferem.'));
        const after = await original('read_local_accounts', {
          workspaceId: workspace,
        });
        checks.reference_history_and_comparison =
          after.accounts[0].references.length === 2 &&
          after.accounts[0].references.some(
            (r) =>
              r.status === 'SUPERSEDED' &&
              r.amount_minor === '9007199254740993',
          ) &&
          after.accounts[0].references.some(
            (r) =>
              r.status === 'ACTIVE' && r.amount_minor === '9007199254740994',
          ) &&
          after.movements.length === 0;
        stage = 11;
        selector().value = other;
        selector().dispatchEvent(new Event('change', { bubbles: true }));
        await wait(() => text().includes('Seu espaço local está pronto'));
        await click('Contas e cartões');
        await wait(() => text().includes('Suas contas'));
        checks.workspace_switch_isolation =
          !text().includes('SYNTHETIC DESKTOP EDIT') &&
          document.querySelectorAll('.account-flow .local-list li').length > 0;
        stage = 12;
        await click('Bloquear agora');
        await wait(() => text().includes('Aplicativo bloqueado'));
        let denied = false;
        try {
          await original('read_local_accounts', { workspaceId: workspace });
        } catch (e) {
          denied = e === 'LOCAL_LOCKED';
        }
        checks.lock_removes_financial_data =
          denied &&
          !text().includes('SYNTHETIC') &&
          !document.querySelector('.account-flow') &&
          !document.querySelector('.fm-workspace');
        checks.no_storage_or_egress =
          forbidden === 0 &&
          localStorage.length === 0 &&
          sessionStorage.length === 0;
        await original('finish_accounts_smoke', {
          report: { passed: Object.values(checks).every(Boolean), checks },
        });
      } catch {
        await window.__TAURI_INTERNALS__.invoke('finish_accounts_smoke', {
          report: { passed: false, checks, failure_stage: stage },
        });
      }
    },
    { once: true },
  );
})();
