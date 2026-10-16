import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function serveExample(port = 0) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./example.tsx', import.meta.url))],
    bundle: true,
    write: false,
    outfile: 'app.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2023',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Financial Manager · demonstração</title><link rel="stylesheet" href="/app.css"><style>body{margin:0}</style><script src="/app.js" defer></script></head><body><div id="root"></div></body></html>';
  const files = new Map([
    ['/', { content: html, type: 'text/html; charset=utf-8' }],
    ...result.outputFiles.map((file) => [
      file.path.endsWith('.css') ? '/app.css' : '/app.js',
      {
        content: file.contents,
        type: file.path.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'text/javascript; charset=utf-8',
      },
    ]),
  ]);
  const server = createServer((request, response) => {
    if (
      request.headers.host !== `127.0.0.1:${server.address().port}` ||
      !['GET', 'HEAD'].includes(request.method)
    ) {
      response.writeHead(403).end();
      return;
    }
    const file = files.get(request.url);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': file.type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : file.content);
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
