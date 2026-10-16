import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
const root = new URL('../../', import.meta.url);
const fixture = JSON.parse(
  readFileSync(new URL('packages/contracts/fixtures/us023.json', root), 'utf8'),
);
if (fixture.synthetic_only !== true)
  throw new Error('SYNTHETIC_IDENTITY_FIXTURE_REQUIRED');
const target = new URL(
  'packages/contracts/src/generated/identity-vectors.ts',
  root,
);
const source = await format(
  '// Generated synthetic-only US-023 vectors. RFC 9562 A.6.\nexport const identityVectors=' +
    JSON.stringify(fixture) +
    ' as const;\n',
  { ...(await resolveConfig(fileURLToPath(target))), parser: 'typescript' },
);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== source)
    throw new Error('IDENTITY_GENERATION_DRIFT');
} else writeFileSync(target, source);
console.log('US-023 identity vectors OK.');
