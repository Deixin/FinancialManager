import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';
import {
  homologate,
  artifactNames,
  cleanup,
} from '../importers/homologate.mjs';
import { validateImporterEvidence } from './importer-evidence.mjs';
import { sourceHash } from '../importers/sources.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, '.tools/us006-importers');
try {
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const mode = process.argv[2];
  if (mode === 'clean') cleanup(artifacts);
  else if (mode === 'test') {
    rmSync(path.join(artifacts, 'report.json'), { force: true });
    const report = await homologate(artifacts, (name) =>
      console.log('US-006 check: ' + name),
    );
    report.completed_at_utc = new Date().toISOString();
    report.artifacts_removed = artifactNames.every(
      (name) => !existsSync(path.join(artifacts, name)),
    );
    report.source_sha256 = sourceHash();
    report.versions = {
      node: process.versions.node,
      sqlite: process.versions.sqlite,
      csv_parse: JSON.parse(
        readFileSync(
          path.join(
            root,
            'packages/importers/node_modules/csv-parse/package.json',
          ),
          'utf8',
        ),
      ).version,
      sax: JSON.parse(
        readFileSync(
          path.join(root, 'packages/importers/node_modules/sax/package.json'),
          'utf8',
        ),
      ).version,
    };
    report.reference_machine = {
      platform: process.platform,
      arch: process.arch,
      cpu_model: cpus()[0].model,
      logical_cpus: cpus().length,
      memory_gib: Math.floor(totalmem() / 1024 ** 3),
    };
    if (report.passed) validateImporterEvidence(report);
    writeFileSync(
      path.join(artifacts, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    if (!report.passed) throw new Error('EVIDENCE_FAILED');
    console.log(
      'US-006 passed: 10k OFX/CSV previews and hostile corpus. Sanitized report: .tools/us006-importers/report.json.',
    );
  } else throw new Error('EXPECTED_TEST_OR_CLEAN');
} catch {
  console.error(
    'US-006 failed. See the sanitized report; source data and parser errors are never logged.',
  );
  process.exitCode = 1;
}
