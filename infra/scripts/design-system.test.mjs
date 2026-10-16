import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  tokens,
  tokenVersion,
  cssVariables,
  createShellModel,
  contentStates,
  syncStates,
} from '../../packages/design-tokens/dist/index.js';
import { AppShell } from '../../packages/ui-dom/dist/index.js';
import { WebShell } from '../../apps/web/dist/index.js';
import { DesktopShell } from '../../apps/desktop/dist/index.js';

const workspace = Object.freeze({
  id: 'synthetic-local',
  name: 'Espaço sintético',
  mode: 'local',
});
const input = (overrides = {}) => ({
  surface: 'desktop',
  workspace,
  route: 'overview',
  state: 'ready',
  ...overrides,
});
const props = (model) => ({
  model,
  workspaces: [model.workspace],
  onWorkspaceChange() {},
  onNavigate() {},
  children: 'SYNTHETIC_CONTENT_CANARY',
});
function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('design tokens have a matching package version and are immutable at every level', () => {
  assert.equal(
    tokenVersion,
    JSON.parse(
      readFileSync(
        new URL('../../packages/design-tokens/package.json', import.meta.url),
        'utf8',
      ),
    ).version,
  );
  const visit = (value) => {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value))
      if (child && typeof child === 'object') visit(child);
  };
  visit(tokens);
  assert.throws(() => {
    tokens.space.lg = 99;
  }, TypeError);
});
test('text and status colors meet the 4.5:1 small-text contrast target', () => {
  const pairs = [
    [tokens.color.text, tokens.color.surface],
    [tokens.color.muted, tokens.color.surface],
    [tokens.color.text, tokens.color.canvas],
    [tokens.color.muted, tokens.color.canvas],
    [tokens.color.onBrand, tokens.color.brand],
    [tokens.color.brand, tokens.color.brandSubtle],
    [tokens.color.onSidebar, tokens.color.sidebar],
    [tokens.color.sidebarMuted, tokens.color.sidebar],
    [tokens.color.disabled, tokens.color.disabledSurface],
    ...Object.values(tokens.state).map((state) => [
      state.foreground,
      state.background,
    ]),
  ];
  for (const [foreground, background] of pairs)
    assert.ok(
      contrast(foreground, background) >= 4.5,
      `CONTRAST_${foreground}_${background}`,
    );
});
test('control borders and focus colors meet a 3:1 contrast target on their surfaces', () => {
  for (const surface of [tokens.color.canvas, tokens.color.surface]) {
    assert.ok(contrast(tokens.color.focus, surface) >= 3);
    assert.ok(contrast(tokens.color.border, surface) >= 3);
  }
  assert.ok(contrast(tokens.color.onSidebar, tokens.color.sidebar) >= 3);
});
test('typography, target sizes and generated rem values support scaling without fixed text heights', () => {
  assert.ok(tokens.control.minTarget >= 44);
  assert.ok(tokens.control.nativeMinTarget >= 48);
  assert.equal(tokens.motion.durationMs, 0);
  for (const value of Object.values(tokens.typography))
    if (typeof value === 'object')
      assert.ok(value.lineHeight / value.size >= 1.2);
  assert.equal(cssVariables['--fm-type-body-size'], '1rem');
  assert.equal(cssVariables['--fm-type-body-line'], '1.5rem');
});
test('shell navigation covers the seven P0 sections with one selected location', () => {
  const model = createShellModel(input({ route: 'imports' }));
  assert.deepEqual(
    model.navigation.map((item) => item.label),
    [
      'Visão geral',
      'Movimentações',
      'Contas e cartões',
      'Importações',
      'Documentos e itens',
      'Relatórios',
      'Configurações',
    ],
  );
  assert.deepEqual(
    model.navigation.filter((item) => item.selected).map((item) => item.id),
    ['imports'],
  );
});
test('Desktop local needs no identity or network and never claims cloud synchronization', () => {
  const model = createShellModel(input());
  assert.equal(model.locationLabel, 'Local');
  assert.equal(model.locationDescription, 'Somente neste dispositivo');
  assert.equal(Object.hasOwn(model, 'user'), false);
});
test('Web and Mobile reject local authority while Local rejects cloud sync state', () => {
  for (const surface of ['web', 'mobile'])
    assert.throws(() => createShellModel(input({ surface })), {
      message: 'UI_SHELL_INVALID',
    });
  assert.throws(() => createShellModel(input({ sync: 'current' })), {
    message: 'UI_SHELL_INVALID',
  });
  for (const overrides of [
    { route: 'constructor' },
    { state: 'unknown' },
    { partial: 'yes' },
    { surface: 'unknown' },
    { workspace: { ...workspace, name: '' } },
    { sync: 'unknown' },
  ])
    assert.throws(() => createShellModel(input(overrides)), {
      message: 'UI_SHELL_INVALID',
    });
});
test('cloud presentation preserves distinct pending, offline and conflict states', () => {
  const descriptions = new Set();
  for (const sync of Object.keys(syncStates)) {
    const model = createShellModel(
      input({
        surface: 'mobile',
        workspace: { ...workspace, mode: 'cloud' },
        sync,
      }),
    );
    assert.equal(model.locationLabel, 'Nuvem');
    descriptions.add(model.locationDescription);
  }
  assert.equal(descriptions.size, 4);
});
test('presentation models snapshot only the declared workspace fields and freeze navigation', () => {
  const mutable = { ...workspace, secret: 'SYNTHETIC_PRIVATE_CANARY' };
  const model = createShellModel(input({ workspace: mutable }));
  mutable.name = 'Changed';
  assert.equal(model.workspace.name, workspace.name);
  assert.equal(Object.hasOwn(model.workspace, 'secret'), false);
  assert.ok(Object.isFrozen(model.workspace));
  assert.ok(Object.isFrozen(model.navigation));
  assert.ok(model.navigation.every(Object.isFrozen));
});
test('DOM state gating never renders stale content for loading, empty, error or forbidden states', () => {
  for (const state of Object.keys(contentStates)) {
    const html = renderToStaticMarkup(
      createElement(AppShell, props(createShellModel(input({ state })))),
    );
    assert.equal(
      html.includes('SYNTHETIC_CONTENT_CANARY'),
      ['ready', 'partial'].includes(state),
    );
    if (state !== 'ready') assert.ok(html.includes(contentStates[state].title));
  }
});
test('DOM renders untrusted workspace names as text with labels and a current-page marker', () => {
  const name = '<img src=x onerror="alert(1)">';
  const html = renderToStaticMarkup(
    createElement(
      DesktopShell,
      props(createShellModel(input({ workspace: { ...workspace, name } }))),
    ),
  );
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('Espaço ativo'));
  const model = createShellModel(input());
  assert.throws(
    () => renderToStaticMarkup(createElement(WebShell, props(model))),
    { message: 'UI_SHELL_SURFACE_INVALID' },
  );
});
test('the stylesheet uses only defined token variables, including state and focus styles', () => {
  const css = readFileSync(
    new URL('../../packages/ui-dom/styles.css', import.meta.url),
    'utf8',
  );
  for (const [, name] of css.matchAll(/var\((--fm-[a-zA-Z-]+)\)/g))
    assert.equal(typeof cssVariables[name], 'string', name);
});
