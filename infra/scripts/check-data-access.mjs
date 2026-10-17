import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const dataAccessPolicy = JSON.parse(
  readFileSync(
    path.join(root, 'packages/config/data-access-boundaries.json'),
    'utf8',
  ),
);
const ownTables = new Map(
  Object.entries(dataAccessPolicy.modules).flatMap(([owner, tables]) =>
    tables.map((table) => [table, owner]),
  ),
);
const tableCalls = new Set([
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
]);
const forbiddenMethods = new Set([
  'insertInto',
  'updateTable',
  'deleteFrom',
  'withSchema',
  'withTables',
  'transaction',
  'connection',
  'destroy',
  'executeQuery',
  'stream',
  'with',
  'withRecursive',
  'raw',
]);
function tableName(value) {
  const match = value.match(/^(?:fm\.)?([a-z_]+)(?: as [a-z_]+)?$/);
  return match?.[1];
}
function literalTables(node) {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (
    ts.isArrayLiteralExpression(node) &&
    node.elements.every(ts.isStringLiteralLike)
  )
    return node.elements.map((value) => value.text);
  return null;
}
function onlyTypes(node) {
  return (
    node.importClause?.isTypeOnly === true ||
    (node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.every(
        (element) => element.isTypeOnly,
      ))
  );
}
function chainIncludes(node, table) {
  let current = node;
  while (
    current.parent &&
    (ts.isPropertyAccessExpression(current.parent) ||
      ts.isCallExpression(current.parent))
  )
    current = current.parent;
  let found = false;
  function walk(item) {
    if (
      ts.isCallExpression(item) &&
      ts.isPropertyAccessExpression(item.expression) &&
      item.expression.name.text === 'innerJoin'
    ) {
      const arg = item.arguments[0];
      if (arg && ts.isStringLiteralLike(arg) && tableName(arg.text) === table)
        found = true;
    }
    ts.forEachChild(item, walk);
  }
  walk(current);
  return found;
}
export function validateDataAccessSource(filename, source) {
  const relative = (
    path.isAbsolute(filename) ? path.relative(root, filename) : filename
  ).replaceAll('\\', '/');
  const adapter = dataAccessPolicy.adapters?.[relative];
  const module =
    adapter?.owner ??
    relative.match(
      /^packages\/persistence-postgres\/src\/modules\/([a-z-]+)\.ts$/,
    )?.[1];
  const app = /^apps\/(api|worker)\/src\/.+\.ts$/.test(relative),
    pure = relative.startsWith('packages/finance-ports/src/');
  if (
    !module &&
    (relative.startsWith('packages/storage-schema/src/revision-adapters/') ||
      relative.startsWith('packages/persistence-postgres/src/modules/'))
  )
    return [relative + ': unregistered data adapter'];
  if (!module && !app && !pure) return [];
  const errors = [];
  const report = (reason) => errors.push(relative + ': ' + reason);
  if (module && !dataAccessPolicy.modules[module])
    report('unknown data module');
  const ast = ts.createSourceFile(
    relative,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (module) {
        if (specifier === 'kysely') {
          if (!onlyTypes(node))
            report(
              'runtime query-builder import belongs to the composition root',
            );
        } else if (
          ![
            '@financial-manager/domain',
            '@financial-manager/domain/revisions',
            '@financial-manager/contracts',
            '@financial-manager/finance-ports',
            '@financial-manager/finance-ports/revisions',
          ].includes(specifier) &&
          ![
            '../internal/database.js',
            '../internal/scope.js',
            '../internal/projection.js',
            ...(adapter?.syntax === 'sqlite' && onlyTypes(node)
              ? ['../index.js']
              : []),
          ].includes(specifier)
        )
          report(
            'module imports a driver, another adapter or an unapproved helper',
          );
      }
      if (
        app &&
        (['pg', 'kysely', 'node:sqlite', 'better-sqlite3'].includes(
          specifier,
        ) ||
          specifier.includes('/persistence/postgres/'))
      )
        report(
          'application module must use ports instead of a SQL driver/tool',
        );
      if (
        (app || pure) &&
        specifier.startsWith('@financial-manager/persistence-postgres') &&
        !(app && dataAccessPolicy.composition_imports?.[relative] === specifier)
      )
        report(
          'PostgreSQL adapter can be installed only at the composition root',
        );
    }
    if (module) {
      if (ts.isTaggedTemplateExpression(node))
        report('raw SQL tags are forbidden in read modules');
      if (
        ts.isAsExpression(node) &&
        node.type.getText(ast) !== 'const' &&
        adapter?.syntax !== 'sqlite'
      )
        report('module cannot widen its table/type capability');
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        report('any defeats the table capability');
      if (
        ts.isPropertyAccessExpression(node) &&
        forbiddenMethods.has(node.name.text) &&
        !(
          adapter?.write === true &&
          ['insertInto', 'updateTable', 'deleteFrom'].includes(node.name.text)
        )
      )
        report('unapproved read-module operation: ' + node.name.text);
    }
    if (ts.isCallExpression(node)) {
      if (
        module &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            ['require', 'eval', 'Function'].includes(node.expression.text)))
      )
        report('dynamic execution/import is forbidden in read modules');
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (
          adapter?.syntax === 'sqlite' &&
          ['rows', 'run', 'exec', 'query'].includes(method)
        ) {
          const argument = node.arguments[0];
          if (!argument || !ts.isStringLiteralLike(argument))
            report('SQLite statements must be static SQL with bound values');
          else {
            const sql = argument.text;
            if (sql.replace(/;\s*$/, '').includes(';'))
              report('SQLite data modules accept one statement per call');
            if (!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql))
              report('unapproved SQLite statement');
            if (!adapter.write && !/^\s*SELECT\b/i.test(sql))
              report('write in a read-only SQLite module');
            for (const match of sql.matchAll(
              /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi,
            )) {
              const table = match[1].toLowerCase();
              if (table === 'json_each') continue;
              if (ownTables.get(table) !== module)
                report('SQLite table belongs to another module: ' + table);
              if (
                /^\s*SELECT\b/i.test(sql) &&
                dataAccessPolicy.parent_scoped_tables.includes(table) &&
                !/INNER\s+JOIN\s+financial_transaction\b/i.test(sql)
              )
                report(
                  'child read requires its parent in the same SQL statement',
                );
            }
          }
        }
        if (tableCalls.has(method)) {
          if (!module) {
            report('SQL query builder outside a data module');
          } else {
            const values = node.arguments[0]
              ? literalTables(node.arguments[0])
              : null;
            if (!values) report('table names must be static literals');
            else
              for (const value of values) {
                const table = tableName(value);
                if (!table || ownTables.get(table) !== module)
                  report(
                    'table belongs to another module: ' +
                      (table ?? 'invalid-table-expression'),
                  );
                if (
                  method === 'selectFrom' &&
                  dataAccessPolicy.parent_scoped_tables.includes(table) &&
                  !chainIncludes(node, 'financial_transaction')
                )
                  report(
                    'child read requires its parent in the same SQL statement',
                  );
              }
          }
        }
        if ((app || pure) && ['executeQuery', 'raw'].includes(method))
          report('raw SQL execution outside an adapter');
        if (
          (app || pure) &&
          ['query', 'rows', 'run', 'exec'].includes(method) &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          /^\s*(select|insert|update|delete|with|begin|commit|rollback|pragma|create|alter|drop)\b/i.test(
            node.arguments[0].text,
          )
        )
          report('SQL statement outside an adapter');
        if (module && method === 'fn') {
          const name = node.arguments[0];
          if (
            !name ||
            !ts.isStringLiteralLike(name) ||
            !['to_char', 'timezone'].includes(name.text)
          )
            report('unapproved dynamic SQL function');
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return errors;
}
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? walk(path.join(directory, item.name))
      : item.name.endsWith('.ts')
        ? [path.join(directory, item.name)]
        : [],
  );
}
export function checkDataAccess() {
  const tables = Object.values(dataAccessPolicy.modules).flat();
  if (new Set(tables).size !== tables.length)
    throw new Error('DUPLICATE_TABLE_OWNER');
  const files = [
    'packages/persistence-postgres/src/modules',
    'packages/storage-schema/src/revision-adapters',
    'packages/finance-ports/src',
    'apps/api/src',
    'apps/worker/src',
  ].flatMap((name) => walk(path.join(root, name)));
  return files.flatMap((filename) =>
    validateDataAccessSource(filename, readFileSync(filename, 'utf8')),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = checkDataAccess();
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      'US-024 data boundaries OK: table owners, ports and composition roots.',
    );
}
