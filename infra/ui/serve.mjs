import { serveExample } from './host.mjs';
try {
  const server = await serveExample(44360);
  console.log('US-016 synthetic UI: ' + server.origin);
  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  console.error('UI_PREVIEW_FAILED');
  process.exitCode = 1;
}
