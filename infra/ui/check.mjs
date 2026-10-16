import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serveExample } from './host.mjs';
import { contentStates } from '../../packages/design-tokens/dist/index.js';
import { pending, sourceHashes, validateUiEvidence } from './evidence.mjs';

const directory = new URL('../../.tools/us016-ui/', import.meta.url);
const report = {
  format_version: 1,
  scope: 'us016-dom-synthetic-example',
  synthetic_only: true,
  started_at_utc: new Date().toISOString(),
  checks: {},
  pending: [...pending],
};
let stage = 'startup',
  server,
  browser,
  axeVersion;
const check = (name) => {
  report.checks[name] = true;
  console.log('US-016 check: ' + name);
};
try {
  mkdirSync(directory, { recursive: true });
  server = await serveExample();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const externalRequests = [],
    errors = [];
  context.on('request', (request) => {
    if (!request.url().startsWith(server.origin + '/'))
      externalRequests.push(request.url());
  });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push(true));
  await page.goto(server.origin);
  const state = page.getByLabel('Estado do exemplo');
  const main = page.getByRole('main');
  const navigation = page.getByRole('navigation', {
    name: 'Navegação principal',
  });
  await page.getByRole('heading', { level: 1, name: 'Visão geral' }).waitFor();
  stage = 'semantics';
  assert.equal(await main.count(), 1);
  assert.equal(
    await page.getByText('Somente neste dispositivo', { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole('button', { name: /entrar|login/i }).count(),
    0,
  );
  check('local_without_login_and_semantic_landmarks');
  stage = 'keyboard';
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByRole('link', { name: 'Ir para o conteúdo' })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('Enter');
  assert.equal(
    await main.evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(
    await main.evaluate((element) => getComputedStyle(element).outlineStyle),
    'solid',
  );
  check('keyboard_skip_link_and_visible_focus');
  await navigation
    .getByRole('button', { name: 'Movimentações', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', {
    level: 1,
    name: 'Movimentações',
  });
  await heading.waitFor();
  assert.equal(
    await heading.evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(
    await navigation
      .getByRole('button', { name: 'Movimentações', exact: true })
      .getAttribute('aria-current'),
    'page',
  );
  check('keyboard_navigation_and_heading_focus');
  stage = 'states';
  for (const [id, notice] of Object.entries(contentStates)) {
    await state.selectOption(id);
    if (id !== 'ready')
      await page
        .getByRole('heading', { name: notice.title, exact: true })
        .waitFor();
    assert.equal(
      await main.getAttribute('aria-busy'),
      id === 'loading' ? 'true' : 'false',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Ver movimentações', exact: true })
        .count(),
      ['ready', 'partial'].includes(id) ? 1 : 0,
    );
    if (id !== 'ready')
      assert.match(
        await page.getByRole('status').textContent(),
        new RegExp(notice.title),
      );
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    axeVersion = results.testEngine.version;
    assert.deepEqual(
      results.violations.map((violation) => violation.id),
      [],
      `AXE_${id}`,
    );
  }
  check('distinct_states_hide_stale_content_and_announce_status');
  check('axe_wcag_22_aa_all_six_states');
  await state.selectOption('error');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  assert.equal(await state.inputValue(), 'ready');
  assert.equal(
    await heading.evaluate((element) => element === document.activeElement),
    true,
  );
  check('retry_returns_to_ready');
  stage = 'context';
  await page.getByRole('button', { name: 'Buscar no espaço' }).click();
  const query = page.getByLabel('Buscar seções neste espaço');
  await query.waitFor();
  assert.equal(
    await query.evaluate((element) => element === document.activeElement),
    true,
  );
  await query.fill('Contas');
  await page.getByLabel('Espaço ativo').selectOption('synthetic-cloud');
  await page.getByRole('heading', { level: 1, name: 'Visão geral' }).waitFor();
  assert.equal(await query.count(), 0);
  await page.getByRole('button', { name: 'Buscar no espaço' }).click();
  assert.equal(await query.inputValue(), '');
  check('workspace_change_resets_route_and_search');
  await page.getByRole('button', { name: 'Fechar busca' }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Buscar no espaço' })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.getByLabel('Plataforma do exemplo').selectOption('web');
  assert.equal(
    await page.getByLabel('Espaço ativo').locator('option').count(),
    2,
  );
  assert.equal(
    await page.getByText('Espaço em nuvem', { exact: true }).count(),
    1,
  );
  check('web_offers_cloud_workspaces_only');
  stage = 'reflow';
  await page.getByLabel('Espaço ativo').selectOption('synthetic-long');
  await page.screenshot({
    path: fileURLToPath(new URL('desktop.png', directory)),
    fullPage: true,
  });
  for (const size of [320, 375, 768]) {
    await page.setViewportSize({ width: size, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `REFLOW_${size}`,
    );
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    assert.deepEqual(
      results.violations.map((violation) => violation.id),
      [],
      `AXE_REFLOW_${size}`,
    );
  }
  check('reflow_320_375_768_and_long_workspace_name');
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  check('text_at_200_percent_without_horizontal_overflow');
  await page.screenshot({
    path: fileURLToPath(new URL('compact.png', directory)),
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: 'active' });
  stage = 'forced_colors';
  await navigation
    .getByRole('button', { name: 'Configurações', exact: true })
    .focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await navigation
      .getByRole('button', { name: 'Relatórios', exact: true })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
    'solid',
  );
  check('forced_colors_preserves_focus');
  assert.deepEqual(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  check('no_browser_storage_external_requests_or_runtime_errors');
  report.versions = {
    node: process.versions.node,
    chromium: browser.version(),
    axe: axeVersion,
  };
  report.passed = true;
} catch {
  report.passed = false;
  report.failure_stage = stage;
  console.error('UI_CHECK_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  report.completed_at_utc = new Date().toISOString();
  report.resources_closed = true;
  report.source_sha256 = sourceHashes();
  if (report.passed) validateUiEvidence(report);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    new URL('latest.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  );
}
/* global document, getComputedStyle, innerWidth, localStorage, sessionStorage */
