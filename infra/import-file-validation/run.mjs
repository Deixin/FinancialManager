import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import {
  checks,
  pending,
  scope,
  sourceHashes,
  validateFileEvidence,
} from './evidence.mjs';
import { verifyOracles } from './oracle.mjs';
import { verifyOfxOracle } from '../ofx-parser/oracle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const child = spawnSync(
  process.execPath,
  [
    '--max-old-space-size=128',
    fileURLToPath(new URL('./probe.mjs', import.meta.url)),
  ],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 35000,
    maxBuffer: 1024 * 1024,
  },
);
assert.equal(child.error, undefined);
assert.equal(child.status, 0);
assert.equal(child.stderr, '');
const node = JSON.parse(child.stdout);
assert.ok(
  node.duration_ms < 30000 &&
    node.peak_rss_bytes > 0 &&
    node.peak_rss_bytes <= 256 * 1024 * 1024,
);
assert.equal(verifyOracles(), true);
assert.equal(await verifyOfxOracle(), true);
const bundle = await build({
  stdin: {
    contents:
      "import * as api from './packages/importers/src/index.ts'; import {corpus,executeCorpus} from './infra/import-file-validation/corpus.mjs'; import {executeOfxCorpus} from './infra/ofx-parser/corpus.mjs'; export async function run(){return {files:executeCorpus(api,corpus()),ofx:await executeOfxCorpus(api)};}",
    resolveDir: root,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'SyntheticFileValidation',
  write: false,
});
const browser = await chromium.launch({ headless: true });
let browserResults, heap, version;
try {
  version = browser.version();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  let egress = 0;
  await context.route('**/*', (route) => {
    if (route.request().url() === 'https://us051.synthetic.invalid/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>FIN-002 synthetic</title>',
      });
    egress++;
    return route.abort();
  });
  const cdp = await context.newCDPSession(page);
  await page.goto('https://us051.synthetic.invalid/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  browserResults = await page.evaluate(async () => {
    const results = await globalThis.SyntheticFileValidation.run();
    if (
      globalThis.executed !== undefined ||
      globalThis.document.cookie ||
      globalThis.sessionStorage.length ||
      globalThis.localStorage.length
    )
      throw Error('UNEXPECTED_SIDE_EFFECT');
    return results;
  });
  heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  // SharedArrayBuffer is available in Node and only in isolated browser contexts.
  assert.deepEqual(
    browserResults.files,
    node.results.filter((item) => item.name !== 'shared-memory-rejected'),
  );
  assert.deepEqual(browserResults.ofx, node.ofx_results);
  assert.equal(egress, 0);
  assert.deepEqual(await context.cookies(), []);
  assert.equal(bundle.outputFiles[0].text.includes('node:fs'), false);
  await context.close();
} finally {
  await browser.close();
}
const report = {
  format_version: 2,
  scope,
  synthetic_only: true,
  passed: true,
  checks: Object.fromEntries(checks.map((key) => [key, true])),
  pending,
  resources_closed: true,
  source_sha256: sourceHashes(),
  completed_at_utc: new Date().toISOString(),
  versions: { node: process.versions.node, chromium: version },
  cases: node.results.length,
  ofx_cases: node.ofx_results.length,
  metrics: {
    node_duration_ms: node.duration_ms,
    ofx_duration_ms: node.ofx_duration_ms,
    peak_rss_bytes: node.peak_rss_bytes,
    browser_heap_bytes: heap,
  },
};
validateFileEvidence(report);
mkdirSync(new URL('../../.tools/us051-defensive-files/', import.meta.url), {
  recursive: true,
});
writeFileSync(
  new URL('../../.tools/us051-defensive-files/latest.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    scope,
    passed: true,
    cases: report.cases,
    ofx_cases: report.ofx_cases,
    metrics: report.metrics,
  }),
);
