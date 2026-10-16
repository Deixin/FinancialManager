import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createDemoAvailability } from './availability.mjs';

export async function serveExample(port = 0) {
  const availability = createDemoAvailability();
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
  const html = () =>
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Financial Manager · demonstração</title><link rel="stylesheet" href="/app.css"><style>body{margin:0}</style><script src="/app.js" defer></script></head><body><script id="runtime-configuration" type="application/json">' +
    JSON.stringify(availability.snapshot()).replaceAll('<', '\\u003c') +
    '</script><div id="root"></div></body></html>';
  const files = new Map([
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
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const json = (status, value) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify(value));
    };
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
      response.writeHead(403).end();
      return;
    }
    if (request.url === '/runtime-config.json' && request.method === 'GET') {
      json(200, availability.snapshot());
      return;
    }
    if (request.method === 'POST') {
      if (
        request.headers.origin !== origin ||
        request.headers['content-type'] !== 'application/json'
      ) {
        json(403, { code: 'DEMO_REQUEST_DENIED' });
        return;
      }
      try {
        if (request.url === '/demo-availability') {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 1024) throw new Error('DEMO_REQUEST_INVALID');
          }
          const value = JSON.parse(body);
          if (!value || Object.keys(value).join(',') !== 'profile')
            throw new Error('DEMO_REQUEST_INVALID');
          json(200, availability.select(value.profile));
          return;
        }
        if (request.url === '/demo-actions/import-preview') {
          json(200, await availability.importPreview());
          return;
        }
      } catch (error) {
        json(error?.message === 'FEATURE_UNAVAILABLE' ? 503 : 400, {
          code:
            error?.message === 'FEATURE_UNAVAILABLE'
              ? 'FEATURE_UNAVAILABLE'
              : 'DEMO_REQUEST_INVALID',
        });
        return;
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      json(403, { code: 'DEMO_REQUEST_DENIED' });
      return;
    }
    const file =
      request.url === '/'
        ? { content: html(), type: 'text/html; charset=utf-8' }
        : files.get(request.url);
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
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; font-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
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
