import { AsyncLocalStorage } from 'node:async_hooks';
// Shared by read and revision units; opening a second unit from a live callback
// cannot replace explicit orchestration on the existing client.
export const activeDataUnit = new AsyncLocalStorage<true>();
