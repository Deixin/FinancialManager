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
      if (state.pin && state.locked) throw 'LOCAL_LOCKED';
      if (command === 'list_local_workspaces')
        return structuredClone(state.rows);
      if (command === 'open_local_workspace') {
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
