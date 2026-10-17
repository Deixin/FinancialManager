/* global structuredClone */
// Installed by Playwright only. Never bundled into the application.
export function installSyntheticWorkspaceBridge() {
  const state = {
    rows: [],
    calls: [],
    hold: false,
    release: null,
    loseAck: false,
    failNext: false,
  };
  globalThis.isTauri = true;
  globalThis.__syntheticWorkspace = state;
  globalThis.__TAURI_INTERNALS__ = {
    async invoke(command, args) {
      state.calls.push(command);
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
