import { createServer } from 'node:http';
import { SyncError } from '../../apps/api/spikes/us-005/protocol.mjs';

// Loopback-only synthetic transport. No production authentication or cookies.
export async function startTransport(
  service,
  sessions,
  { dropReply = () => false } = {},
) {
  const server = createServer(async (request, response) => {
    try {
      const context = sessions.get(request.headers.authorization);
      if (!context) throw new SyncError('REJECTED_PERMISSION');
      if (
        request.method !== 'POST' ||
        !['/push', '/pull', '/snapshot'].includes(request.url)
      )
        throw new SyncError('INVALID_OPERATION');
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 65536) throw new SyncError('INVALID_OPERATION');
      }
      const input = JSON.parse(body);
      const result = await service[request.url.slice(1)](context, input);
      if (request.url === '/push' && dropReply(input)) {
        response.destroy();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(result));
    } catch (error) {
      // Never serialize raw DB/network errors or proposals.
      const status = error instanceof SyncError ? error.code : 'REQUEST_FAILED';
      response.writeHead(status === 'REJECTED_PERMISSION' ? 403 : 400, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({ status }));
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
