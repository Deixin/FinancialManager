/* global fetch, AbortSignal */
import { Replica } from './replica.mjs';

// One invocation = an independent OS process. Secrets and fixture payloads use
// stdin/stdout pipes owned by the harness, never command-line arguments/logs.
let replica;
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk.toString();
  const command = JSON.parse(input);
  replica = new Replica(command.file, command.workspace, command.generation);
  const request = async (route, body) => {
    try {
      const response = await fetch(command.url + '/' + route, {
        method: 'POST',
        headers: {
          Authorization: command.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      return await response.json();
    } catch {
      return { status: 'UNAVAILABLE' };
    }
  };
  let results = [];
  if (command.action === 'enqueue') {
    replica.enqueue(command.operation, () => {
      if (command.crash === 'before_commit') process.exit(86);
    });
    if (command.crash === 'after_commit') process.exit(86);
  } else if (command.action === 'push') {
    for (const op of replica.pending()) {
      const result = await request('push', op);
      results.push(result);
      replica.acknowledge(op.operation_id, result);
      if (['UNAVAILABLE', 'REQUEST_FAILED'].includes(result.status)) break;
    }
  } else if (command.action === 'pull' || command.action === 'snapshot') {
    const meta = replica.meta();
    const result = await request(command.action, {
      workspace_id: meta.workspace,
      generation: meta.generation,
      cursor: meta.cursor,
      limit: command.limit ?? 2,
    });
    results = [result];
    if (result.status === 'OK')
      replica.apply(result, {
        snapshot: command.action === 'snapshot',
        beforeCommit: () => {
          if (command.crash === 'before_commit') process.exit(86);
        },
      });
  } else if (command.action !== 'inspect') throw new Error('UNKNOWN_COMMAND');
  const state = replica.state();
  replica.close();
  replica = undefined;
  process.stdout.write(JSON.stringify({ results, ...state }));
} catch {
  replica?.close();
  process.stdout.write(JSON.stringify({ status: 'CLIENT_FAILED' }));
  process.exitCode = 1;
}
