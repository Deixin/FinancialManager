import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const prefix = '@financial-manager/';
const developmentOnly = new Set([prefix + 'config', prefix + 'test-fixtures']);
const purePackages = new Set([
  prefix + 'domain',
  prefix + 'contracts',
  prefix + 'design-tokens',
  prefix + 'runtime-config',
  prefix + 'storage-schema',
]);
const nativeModules = new Set(
  builtinModules.map((name) => name.replace(/^node:/, '')),
);
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  '.tools',
  '.pnpm-store',
  '.pnpm-cache',
  '.turbo',
  '.next',
  '.expo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'private',
  'local-data',
]);

function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'));
}

function walk(directory, excludedDirectories = new Set()) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ||
        excludedDirectories.has(filename)
        ? []
        : walk(filename, excludedDirectories);
    }
    return entry.isFile() ? [filename] : [];
  });
}

export function dependencyAllowed(source, target, section, matrix) {
  if (section === 'devDependencies' && developmentOnly.has(target)) {
    return true;
  }
  return (matrix[source] ?? []).includes(target);
}

export function validateManifests(workspaces, matrix) {
  const errors = [];
  const names = new Set(workspaces.map((workspace) => workspace.manifest.name));
  if (names.size !== workspaces.length)
    errors.push('Duplicate workspace names.');
  for (const name of Object.keys(matrix)) {
    if (!names.has(name)) errors.push('Boundary without workspace: ' + name);
    for (const target of matrix[name]) {
      if (!names.has(target)) errors.push('Unknown boundary target: ' + target);
    }
  }
  for (const { manifest, kind } of workspaces) {
    if (!manifest.name?.startsWith(prefix)) {
      errors.push('Invalid workspace name: ' + manifest.name);
    }
    if (manifest.private !== true)
      errors.push(manifest.name + ' must be private.');
    if (!Object.hasOwn(matrix, manifest.name)) {
      errors.push('Workspace without boundary: ' + manifest.name);
    }
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      for (const [target, version] of Object.entries(manifest[section] ?? {})) {
        if (!target.startsWith(prefix)) continue;
        const targetWorkspace = workspaces.find(
          (workspace) => workspace.manifest.name === target,
        );
        if (!targetWorkspace) errors.push('Unknown dependency: ' + target);
        if (targetWorkspace?.kind === 'apps') {
          errors.push(
            manifest.name + ' cannot depend on application ' + target,
          );
        }
        if (version !== 'workspace:*') {
          errors.push(manifest.name + ': use workspace:* for ' + target);
        }
        if (!dependencyAllowed(manifest.name, target, section, matrix)) {
          errors.push(
            'Forbidden dependency: ' + manifest.name + ' -> ' + target,
          );
        }
      }
    }
    if (kind !== 'apps' && kind !== 'packages') {
      errors.push('Invalid workspace kind: ' + kind);
    }
  }
  return errors;
}

export function collectImports(source, filename = 'source.ts') {
  const specifiers = [];
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return specifiers;
}

export function validateImports(
  workspace,
  filename,
  specifiers,
  workspaces,
  matrix,
) {
  const errors = [];
  const { manifest, directory } = workspace;
  for (const specifier of specifiers) {
    if (specifier.startsWith('.')) {
      const relative = path.relative(
        directory,
        path.resolve(path.dirname(filename), specifier),
      );
      if (
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      ) {
        errors.push(
          manifest.name + ': relative import leaves workspace: ' + specifier,
        );
      }
    }
    if (
      purePackages.has(manifest.name) &&
      (specifier.startsWith('node:') ||
        nativeModules.has(specifier.replace(/^node:/, '')))
    ) {
      errors.push(
        manifest.name + ': native Node import is forbidden: ' + specifier,
      );
    }
    if (!specifier.startsWith(prefix)) continue;
    const target = specifier.split('/').slice(0, 2).join('/');
    if (target === manifest.name) continue;
    const targetWorkspace = workspaces.find(
      (candidate) => candidate.manifest.name === target,
    );
    if (!targetWorkspace) {
      errors.push(manifest.name + ': unknown import: ' + target);
      continue;
    }
    const sections = [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ].filter((section) => Object.hasOwn(manifest[section] ?? {}, target));
    if (sections.length === 0) {
      errors.push(manifest.name + ': undeclared import: ' + target);
    } else if (
      !sections.some((section) =>
        dependencyAllowed(manifest.name, target, section, matrix),
      ) ||
      targetWorkspace.kind === 'apps'
    ) {
      errors.push('Forbidden import: ' + manifest.name + ' -> ' + target);
    }
  }
  return errors;
}

export function localMarkdownLinks(source) {
  const lines = source.split(/\r?\n/);
  let fence = null;
  const prose = lines
    .filter((line) => {
      const marker = line.match(/^\s{0,3}(~{3,}|[\x60]{3,})/);
      if (marker) {
        if (fence === null) fence = marker[1][0];
        else if (marker[1][0] === fence) fence = null;
        return false;
      }
      return fence === null;
    })
    .join('\n')
    .replace(/[\x60][^\x60]*[\x60]/g, '');
  return [...prose.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) =>
      match[1]
        .trim()
        .replace(/\s+["'].*$/, '')
        .replace(/^<|>$/g, ''),
    )
    .filter((link) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link))
    .map((link) => decodeURIComponent(link.split(/[?#]/)[0]))
    .filter(Boolean);
}

export function checkRepository(root) {
  // Expo CNG output is regenerated from the reviewed app config and config plugins.
  const generatedNativeDirectories = new Set([
    path.join(root, 'apps/mobile/android'),
    path.join(root, 'apps/mobile/ios'),
  ]);
  const matrix = readJson(
    path.join(root, 'packages/config/workspace-boundaries.json'),
  );
  const workspaces = ['apps', 'packages'].flatMap((kind) =>
    readdirSync(path.join(root, kind), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(root, kind, entry.name);
        return {
          kind,
          directory,
          manifest: readJson(path.join(directory, 'package.json')),
        };
      }),
  );
  const errors = validateManifests(workspaces, matrix);
  if (readJson(path.join(root, 'package.json')).private !== true) {
    errors.push('Root package must be private.');
  }
  for (const workspace of workspaces) {
    for (const filename of walk(
      workspace.directory,
      generatedNativeDirectories,
    )) {
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(filename)) continue;
      const specifiers = collectImports(
        readFileSync(filename, 'utf8'),
        filename,
      );
      errors.push(
        ...validateImports(workspace, filename, specifiers, workspaces, matrix),
      );
    }
  }
  const markdownFiles = walk(root, generatedNativeDirectories).filter(
    (filename) => filename.endsWith('.md'),
  );
  for (const filename of markdownFiles) {
    for (const link of localMarkdownLinks(readFileSync(filename, 'utf8'))) {
      if (!existsSync(path.resolve(path.dirname(filename), link))) {
        errors.push(path.relative(root, filename) + ': missing link ' + link);
      }
    }
  }
  return {
    errors,
    workspaceCount: workspaces.length,
    markdownCount: markdownFiles.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = checkRepository(root);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(
      'Repository OK: ' +
        result.workspaceCount +
        ' workspaces, ' +
        result.markdownCount +
        ' Markdown files.',
    );
  }
}
