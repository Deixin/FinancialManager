/* global setTimeout, clearTimeout */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { limits } from '../../packages/importers/spikes/us-006/contract.mjs';

// Private IPC carries preview metadata. stdout/stderr are never forwarded.
export async function runParser({
  input,
  staging,
  request,
  cancelAt,
  killAt,
  timeoutMs = limits.timeoutMs,
  onProgress = () => {},
}) {
  return new Promise((resolve) => {
    const child = fork(
      fileURLToPath(new URL('./worker.mjs', import.meta.url)),
      [],
      {
        windowsHide: true,
        execArgv: ['--max-old-space-size=128'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    let stdout = '',
      stderr = '',
      result;
    let cancellationSent = false;
    let forced = false;
    const stop = (code) => {
      if (forced) return;
      forced = true;
      result = { type: 'failure', code };
      child.kill();
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const progress = [];
    const timer = setTimeout(() => {
      stop('TIME_LIMIT');
    }, timeoutMs);
    child.on('message', (message) => {
      if (forced) return;
      if (message.type === 'progress') {
        progress.push({ phase: message.phase, rows: message.rows });
        onProgress(message);
        if (killAt !== undefined && message.rows >= killAt) {
          stop('INTERRUPTED');
        } else if (
          !cancellationSent &&
          cancelAt !== undefined &&
          message.rows >= cancelAt
        ) {
          cancellationSent = true;
          child.send({ type: 'cancel' });
        }
      } else result = message;
    });
    child.on('error', () => {
      if (!forced) result = { type: 'failure', code: 'PROCESS_FAILED' };
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && result?.type === 'done')
        result = { type: 'failure', code: 'PROCESS_FAILED' };
      resolve({
        ...result,
        code:
          result?.code ?? (result?.type === 'done' ? 'OK' : 'PROCESS_FAILED'),
        progress,
        stdout,
        stderr,
      });
    });
    child.send({ type: 'start', input, staging, request });
  });
}
