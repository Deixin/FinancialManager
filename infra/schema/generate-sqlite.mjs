import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sqliteSql } from './sqlite-model.mjs';
import { format, resolveConfig } from 'prettier';
import { corpus } from './us021-corpus.mjs';
import { fileURLToPath } from 'node:url';
const directory = new URL('../../packages/storage-schema/', import.meta.url);
const sql = sqliteSql();
const hash = createHash('sha256').update(sql).digest('hex');
const outputs = [
  ['sqlite/migrations/0001-financial-core.sql', sql],
  [
    'src/generated.ts',
    `// Generated; do not edit. No financial data.\nexport const sqliteMigration = ${JSON.stringify(sql)};\nexport const sqliteMigrationSha256 = '${hash}';\n`,
  ],
];
outputs.push(
  [
    'fixtures/us021.json',
    JSON.stringify({ ...corpus, migration_sha256: hash }, null, 2) + '\n',
  ],
  [
    'src/generated-probe.ts',
    `// Generated synthetic-only corpus. Never a product seed.\nexport const syntheticCorpus = ${JSON.stringify(corpus)} as const;\n`,
  ],
);
for (const [name, input] of outputs) {
  const file = new URL(name, directory);
  const content = /\.(ts|json)$/.test(name)
    ? await format(input, {
        ...(await resolveConfig(fileURLToPath(file))),
        parser: name.endsWith('.ts') ? 'typescript' : 'json',
      })
    : input;
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== content)
      throw new Error('SQLITE_GENERATION_DRIFT');
  } else {
    mkdirSync(new URL('./', file), { recursive: true });
    writeFileSync(file, content);
  }
}
console.log('US-021 SQLite generation OK.');
