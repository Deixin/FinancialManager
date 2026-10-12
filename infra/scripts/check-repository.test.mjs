import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  collectImports,
  localMarkdownLinks,
  validateImports,
  validateManifests,
} from './check-repository.mjs';

const scope = '@financial-manager/';
function workspace(name, dependencies = {}, kind = 'packages') {
  return {
    directory: path.resolve('fixture-repository', kind, name),
    kind,
    manifest: {
      name: scope + name,
      private: true,
      dependencies,
      devDependencies: { [scope + 'config']: 'workspace:*' },
    },
  };
}
const domain = workspace('domain');
const contracts = workspace('contracts', { [scope + 'domain']: 'workspace:*' });
const mobile = workspace('mobile', {}, 'apps');
const ui = workspace('ui-dom');
const config = workspace('config');
const workspaces = [domain, contracts, mobile, ui, config];
const matrix = {
  [scope + 'domain']: [],
  [scope + 'contracts']: [scope + 'domain'],
  [scope + 'mobile']: [scope + 'domain', scope + 'contracts'],
  [scope + 'ui-dom']: [],
  [scope + 'config']: [],
};

test('accepts declared permitted dependencies and development config', () => {
  assert.deepEqual(validateManifests(workspaces, matrix), []);
  const filename = path.join(contracts.directory, 'src/index.ts');
  assert.deepEqual(
    validateImports(
      contracts,
      filename,
      [scope + 'domain'],
      workspaces,
      matrix,
    ),
    [],
  );
});

test('rejects domain depending on an application', () => {
  const invalid = workspace('domain', { [scope + 'mobile']: 'workspace:*' });
  const errors = validateManifests([invalid, ...workspaces.slice(1)], matrix);
  assert.ok(
    errors.some((error) => error.includes('cannot depend on application')),
  );
  assert.ok(errors.some((error) => error.includes('Forbidden dependency')));
});

test('rejects DOM UI in Mobile even when declared', () => {
  const invalid = workspace(
    'mobile',
    { [scope + 'ui-dom']: 'workspace:*' },
    'apps',
  );
  const errors = validateImports(
    invalid,
    path.join(invalid.directory, 'src/index.ts'),
    [scope + 'ui-dom'],
    workspaces,
    matrix,
  );
  assert.ok(errors.some((error) => error.includes('Forbidden import')));
});

test('rejects an undeclared internal import', () => {
  const errors = validateImports(
    mobile,
    path.join(mobile.directory, 'src/index.ts'),
    [scope + 'contracts'],
    workspaces,
    matrix,
  );
  assert.ok(errors.some((error) => error.includes('undeclared import')));
});

test('rejects relative paths crossing workspaces and native Node in pure packages', () => {
  const errors = validateImports(
    domain,
    path.join(domain.directory, 'src/index.ts'),
    ['../../contracts/src/index.js', 'node:fs', './money.js'],
    workspaces,
    matrix,
  );
  assert.equal(errors.length, 2);
  assert.ok(errors.some((error) => error.includes('leaves workspace')));
  assert.ok(errors.some((error) => error.includes('native Node')));
});

test('rejects unknown workspaces and non-workspace version references', () => {
  const invalid = workspace('contracts', {
    [scope + 'domain']: '^1.0.0',
    [scope + 'unknown']: 'workspace:*',
  });
  const errors = validateManifests(
    [domain, invalid, mobile, ui, config],
    matrix,
  );
  assert.ok(errors.some((error) => error.includes('use workspace:*')));
  assert.ok(errors.some((error) => error.includes('Unknown dependency')));
});

test('collects static, re-exported and literal dynamic imports, excluding comments', () => {
  const source = [
    '// import "fake";',
    'import type { Money } from "@financial-manager/domain";',
    'export { x } from "./x.js";',
    'const module = import("@financial-manager/contracts");',
    'const legacy = require("node:fs");',
  ].join('\n');
  assert.deepEqual(collectImports(source), [
    scope + 'domain',
    './x.js',
    scope + 'contracts',
    'node:fs',
  ]);
});

test('checks image and file links while skipping web links and fenced examples', () => {
  const source = [
    '[doc](../product/01-prd.md#scope)',
    '![diagram](assets/diagram.png)',
    '[site](https://example.com) [section](#scope)',
    '~~~md',
    '[example](not-a-real-file.md)',
    '~~~',
  ].join('\n');
  assert.deepEqual(localMarkdownLinks(source), [
    '../product/01-prd.md',
    'assets/diagram.png',
  ]);
});
