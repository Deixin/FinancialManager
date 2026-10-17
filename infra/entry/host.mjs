import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
const dist = new URL('../../apps/desktop/frontend-dist/', import.meta.url);
// Only serve the built application and its fixed asset list, never arbitrary paths.
export async function serveDesktopEntry(port = 0) {
  const files = new Map(
    [
      '/index.html',
      ...readdirSync(new URL('assets/', dist)).map((name) => '/assets/' + name),
    ].map((name) => [name, readFileSync(new URL(name.slice(1), dist))]),
  );
  const server = createServer((request, response) => {
    const name = request.url === '/' ? '/index.html' : request.url;
    if (
      request.headers.host !== `127.0.0.1:${server.address().port}` ||
      request.method !== 'GET' ||
      !files.has(name)
    ) {
      response.writeHead(404).end();
      return;
    }
    const type = name.endsWith('.html')
      ? 'text/html'
      : name.endsWith('.css')
        ? 'text/css'
        : 'text/javascript';
    response.writeHead(200, {
      'Content-Type': type + '; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(files.get(name));
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
