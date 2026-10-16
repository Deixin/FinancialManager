/* global localStorage, sessionStorage */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveExample } from './host.mjs';
import { pending, sourceHashes, validateFlagEvidence } from './evidence.mjs';

const directory = new URL('../../.tools/us017-flags/', import.meta.url);
const report = {
  format_version: 1,
  scope: 'us017-runtime-flags-synthetic-example',
  synthetic_only: true,
  started_at_utc: new Date().toISOString(),
  checks: {},
  pending: [...pending],
};
let server,
  browser,
  stage = 'startup';
const check = (name) => {
  report.checks[name] = true;
  console.log('US-017 check: ' + name);
};
try {
  server = await serveExample();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const external = [],
    errors = [];
  context.on('request', (request) => {
    if (!request.url().startsWith(server.origin + '/')) external.push(true);
  });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push(true));
  const post = (path, data = {}, origin = server.origin) =>
    context.request.post(server.origin + path, {
      data,
      headers: { Origin: origin, 'Content-Type': 'application/json' },
    });
  const config = async () =>
    (await context.request.get(server.origin + '/runtime-config.json')).json();
  const bundleHash = async () =>
    createHash('sha256')
      .update(
        await (await context.request.get(server.origin + '/app.js')).body(),
      )
      .digest('hex');
  const originalBundle = await bundleHash();
  await page.goto(server.origin);
  const navigation = page.getByRole('navigation', {
    name: 'Navegação principal',
  });
  const availability = page.getByLabel('Disponibilidade do exemplo');
  const imports = navigation.getByRole('button', {
    name: 'Importações',
    exact: true,
  });
  stage = 'enabled';
  await imports.waitFor();
  assert.equal((await post('/demo-actions/import-preview')).status(), 200);
  check('enabled_section_and_server_operation');
  await imports.click();
  await page.getByRole('heading', { level: 1, name: 'Importações' }).waitFor();
  await page.getByRole('button', { name: 'Buscar no espaço' }).click();
  await page.getByLabel('Buscar seções neste espaço').fill('Importações');
  stage = 'disable';
  await availability.selectOption('limited');
  await page
    .getByText('Disponibilidade atualizada.', { exact: true })
    .waitFor();
  await page.getByRole('heading', { level: 1, name: 'Visão geral' }).waitFor();
  assert.equal(await page.getByLabel('Buscar seções neste espaço').count(), 0);
  for (const name of ['Importações', 'Documentos', 'Relatórios'])
    assert.equal(
      await page.getByRole('button', { name, exact: true }).count(),
      0,
    );
  await page.getByRole('button', { name: 'Buscar no espaço' }).click();
  assert.equal(
    await page.getByLabel('Buscar seções neste espaço').inputValue(),
    '',
  );
  await page.getByLabel('Buscar seções neste espaço').fill('Importações');
  assert.equal(
    await page
      .getByRole('button', { name: 'Importações', exact: true })
      .count(),
    0,
  );
  await page.getByRole('button', { name: 'Fechar busca' }).click();
  check('disable_resets_route_search_navigation_and_cards');
  const denied = await post('/demo-actions/import-preview', {
    features: { importReview: true },
  });
  assert.equal(denied.status(), 503);
  assert.deepEqual(await denied.json(), { code: 'FEATURE_UNAVAILABLE' });
  check('server_rejects_disabled_operation_and_client_override');
  stage = 'configuration';
  const response = await context.request.get(
    server.origin + '/runtime-config.json',
  );
  assert.equal(response.headers()['cache-control'], 'no-store');
  const limited = await response.json();
  assert.deepEqual(Object.keys(limited).sort(), [
    'environment',
    'features',
    'format_version',
    'revision',
  ]);
  assert.deepEqual(Object.keys(limited.features).sort(), [
    'cloudSync',
    'documentReview',
    'importReview',
    'reports',
    'workspaceMigration',
  ]);
  assert.equal(await bundleHash(), originalBundle);
  check('public_configuration_no_store_and_same_bundle');
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'Visão geral' }).waitFor();
  assert.equal(await imports.count(), 0);
  assert.equal(await availability.inputValue(), 'limited');
  await availability.selectOption('full');
  await imports.waitFor();
  assert.equal((await post('/demo-actions/import-preview')).status(), 200);
  assert.ok((await config()).revision > limited.revision);
  assert.equal(await bundleHash(), originalBundle);
  check('reload_and_higher_revision_restore');
  const before = await config();
  assert.equal(
    (
      await post(
        '/demo-availability',
        { profile: 'limited' },
        'https://synthetic.invalid',
      )
    ).status(),
    403,
  );
  assert.deepEqual(await config(), before);
  check('cross_origin_change_rejected');
  stage = 'failure';
  await page.route('**/demo-availability', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'SYNTHETIC_PRIVATE_CANARY',
    }),
  );
  await availability.selectOption('limited');
  await page
    .getByText(
      'Não foi possível atualizar. Os recursos opcionais foram desativados.',
      { exact: true },
    )
    .waitFor();
  assert.equal(await imports.count(), 0);
  assert.equal(await page.getByText('SYNTHETIC_PRIVATE_CANARY').count(), 0);
  assert.equal(await navigation.getByRole('button').count(), 4);
  check('configuration_failure_closes_optional_sections');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  assert.deepEqual(
    axe.violations.map((item) => item.id),
    [],
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  check('limited_accessibility_and_no_storage_external_requests_or_errors');
  report.versions = {
    node: process.versions.node,
    chromium: browser.version(),
    axe: axe.testEngine.version,
  };
  report.passed = true;
} catch {
  report.passed = false;
  report.failure_stage = stage;
  console.error('FLAGS_CHECK_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  report.completed_at_utc = new Date().toISOString();
  report.resources_closed = true;
  report.source_sha256 = sourceHashes();
  if (report.passed) validateFlagEvidence(report);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    new URL('latest.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
