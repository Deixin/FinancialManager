/* global structuredClone */
// Installed by Playwright only. Never bundled into the application.
export function installSyntheticWorkspaceBridge(options = {}) {
  const state = {
    rows: structuredClone(options.rows ?? []),
    calls: [],
    hold: false,
    release: null,
    loseAck: false,
    failNext: false,
    pin: options.pin ?? null,
    locked: Boolean(options.pin),
    failures: 0,
    retry: 0,
    holdUnlock: false,
    releaseUnlock: null,
    failLockNext: false,
    helloAvailable: options.helloAvailable ?? 'UNAVAILABLE',
    helloEnabled: false,
    helloOutcome: 'VERIFIED',
    holdHello: false,
    releaseHello: null,
    generation: 0,
    backupOutcome: 'CREATED',
    backupError: null,
    holdBackup: false,
    releaseBackup: null,
    savedBackups: 0,
    holdOpen: false,
    releaseOpen: null,
    failOpenNext: false,
    lockOpenNext: false,
    failListNext: false,
    restoreSelected: false,
    restorePrepared: false,
    restoreCancelPicker: false,
    restoreError: null,
    holdRestore: false,
    releaseRestore: null,
    loseRestoreAck: false,
  };
  globalThis.isTauri = true;
  globalThis.__syntheticWorkspace = state;
  globalThis.__TAURI_INTERNALS__ = {
    async invoke(command, args) {
      state.calls.push(command);
      const status = () => ({
        enabled: Boolean(state.pin),
        locked: Boolean(state.pin) && state.locked,
        retry_after_seconds: state.retry,
        hello_availability: state.helloAvailable,
        hello_enabled: state.helloEnabled,
      });
      const authenticate = (pin) => {
        if (state.retry) throw 'RETRY_LATER';
        if (pin !== state.pin) {
          state.locked = true;
          state.failures++;
          if (state.failures >= 5) state.retry = 30;
          throw 'AUTHENTICATION_FAILED';
        }
        state.failures = 0;
      };
      if (command === 'local_lock_status') return status();
      if (command === 'lock_local_session') {
        state.generation++;
        state.restorePrepared = false;
        if (state.failLockNext) {
          state.failLockNext = false;
          throw 'SYNTHETIC_LOST_LOCK_REQUEST';
        }
        state.locked = Boolean(state.pin);
        return status();
      }
      if (command === 'configure_local_pin') {
        state.generation++;
        const input = args.input;
        if (
          !/^[0-9]{6,12}$/.test(input.new_pin) ||
          input.new_pin !== input.confirm_pin
        )
          throw 'INVALID_PIN';
        if (state.pin) authenticate(input.current_pin);
        state.pin = input.new_pin;
        state.helloEnabled = false;
        state.locked = false;
        return status();
      }
      if (command === 'unlock_local_session') {
        state.generation++;
        state.restorePrepared = false;
        if (state.holdUnlock)
          await new Promise((resolve) => {
            state.releaseUnlock = resolve;
          });
        authenticate(args.input.pin);
        state.locked = false;
        return status();
      }
      if (command === 'disable_local_pin') {
        state.generation++;
        authenticate(args.input.pin);
        state.pin = null;
        state.helloEnabled = false;
        state.locked = false;
        return status();
      }
      if (['configure_local_hello', 'unlock_local_hello'].includes(command)) {
        state.locked = true;
        const generation = ++state.generation;
        if (command === 'configure_local_hello') {
          authenticate(args.input.pin);
          if (!args.enabled) {
            state.helloEnabled = false;
            return status();
          }
        } else if (!state.helloEnabled) throw 'HELLO_UNAVAILABLE';
        if (state.helloAvailable !== 'AVAILABLE') throw 'HELLO_UNAVAILABLE';
        if (state.holdHello)
          await new Promise((resolve) => {
            state.releaseHello = resolve;
          });
        if (state.generation !== generation) throw 'LOCAL_LOCKED';
        if (state.helloOutcome !== 'VERIFIED') throw state.helloOutcome;
        if (command === 'configure_local_hello') state.helloEnabled = true;
        else state.locked = false;
        return status();
      }
      if (command === 'cancel_local_restore') {
        state.generation++;
        state.restoreSelected = false;
        state.restorePrepared = false;
        return null;
      }
      if (state.pin && state.locked) throw 'LOCAL_LOCKED';
      if (command === 'select_local_backup') {
        state.generation++;
        state.restorePrepared = false;
        state.restoreSelected = !state.restoreCancelPicker;
        state.locked = Boolean(state.pin);
        return {
          selection_id: state.restoreSelected
            ? '0199d035-0000-7000-8000-000000000001'
            : null,
        };
      }
      if (command === 'preview_local_restore') {
        if (
          !state.restoreSelected ||
          args.input.selection_id !== '0199d035-0000-7000-8000-000000000001'
        )
          throw 'RESTORE_UNAVAILABLE';
        const generation = ++state.generation;
        if (state.holdRestore)
          await new Promise((resolve) => {
            state.releaseRestore = resolve;
          });
        if (generation !== state.generation) throw 'LOCAL_LOCKED';
        if (state.restoreError) throw state.restoreError;
        if (args.input.password !== 'SYNTHETIC restore password US035')
          throw 'BACKUP_AUTHENTICATION_FAILED';
        state.restoreSelected = false;
        state.restorePrepared = true;
        return {
          restore_id: '0199d035-0000-7000-8000-000000000002',
          source_name: 'SYNTHETIC backup source',
          display_name: 'SYNTHETIC backup source (restaurado)',
          purpose: 'PERSONAL',
          backup_created_at: '2026-10-17T12:00:00.000Z',
          record_counts: {
            workspace: '1',
            financial_account: '3',
            balance_reference: '3',
            category: '2',
            subcategory: '1',
            tag: '1',
            counterparty: '1',
            transaction_group: '2',
            financial_transaction: '7',
            transaction_allocation: '3',
            transaction_tag: '1',
            transaction_revision: '1',
          },
        };
      }
      if (command === 'confirm_local_restore') {
        const id = '0199d035-0000-7000-8000-000000000002';
        if (args.restoreId !== id) throw 'RESTORE_UNAVAILABLE';
        const previous = state.rows.find((r) => r.id === id);
        if (previous) return structuredClone(previous);
        if (!state.restorePrepared) throw 'RESTORE_UNAVAILABLE';
        const row = {
          id,
          display_name: 'SYNTHETIC backup source (restaurado)',
          purpose: 'PERSONAL',
          storage_mode: 'LOCAL',
          default_currency: 'BRL',
          created_at: '2026-10-17T12:00:00.000Z',
        };
        state.rows.push(row);
        state.restorePrepared = false;
        if (state.loseRestoreAck) {
          state.loseRestoreAck = false;
          throw 'SYNTHETIC_LOST_RESTORE_ACK';
        }
        return structuredClone(row);
      }
      if (command === 'create_local_backup') {
        if (!state.rows.some((row) => row.id === args.input.workspace_id))
          throw 'NOT_FOUND';
        const generation = ++state.generation;
        state.locked = Boolean(state.pin);
        if (state.holdBackup)
          await new Promise((resolve) => {
            state.releaseBackup = resolve;
          });
        if (generation !== state.generation) throw 'LOCAL_LOCKED';
        if (state.backupError) throw state.backupError;
        if (state.backupOutcome === 'CREATED') state.savedBackups++;
        return {
          outcome: state.backupOutcome,
          created_at:
            state.backupOutcome === 'CREATED'
              ? '2026-10-17T12:34:56.000Z'
              : null,
        };
      }
      if (command === 'list_local_workspaces') {
        if (state.failListNext) {
          state.failListNext = false;
          throw 'SYNTHETIC_CATALOG_UNAVAILABLE';
        }
        return structuredClone(state.rows);
      }
      if (command === 'open_local_workspace') {
        if (state.holdOpen)
          await new Promise((resolve) => {
            state.releaseOpen = resolve;
          });
        if (state.lockOpenNext) {
          state.lockOpenNext = false;
          state.locked = Boolean(state.pin);
          throw 'LOCAL_LOCKED';
        }
        if (state.failOpenNext) {
          state.failOpenNext = false;
          throw 'SYNTHETIC_PRIVATE_OPEN_FAILURE';
        }
        const row = state.rows.find((row) => row.id === args.workspaceId);
        if (!row) throw 'NOT_FOUND';
        return structuredClone(row);
      }
      if (command !== 'create_local_workspace')
        throw Error('SYNTHETIC_UNEXPECTED_COMMAND');
      if (state.hold)
        await new Promise((resolve) => {
          state.release = resolve;
        });
      if (state.failNext) {
        state.failNext = false;
        throw 'SYNTHETIC_PRIVATE_SQL_OR_KEY_CANARY';
      }
      const input = args.input,
        previous = state.rows.find((row) => row.id === input.workspace_id);
      if (previous) {
        if (
          previous.display_name !== input.display_name ||
          previous.purpose !== input.purpose
        )
          throw 'REQUEST_CONFLICT';
        return structuredClone(previous);
      }
      const row = {
        id: input.workspace_id,
        display_name: input.display_name,
        purpose: input.purpose,
        storage_mode: 'LOCAL',
        default_currency: 'BRL',
        created_at: '2026-10-16T00:00:00.000Z',
      };
      state.rows.push(row);
      if (state.loseAck) {
        state.loseAck = false;
        throw 'SYNTHETIC_ACK_LOST';
      }
      return structuredClone(row);
    },
  };
}
