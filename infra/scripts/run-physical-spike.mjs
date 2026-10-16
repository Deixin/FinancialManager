import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runProbe } from '../physical/probe.mjs';
import { validatePhysicalEvidence } from './physical-evidence.mjs';

const directory = fileURLToPath(
  new URL('../../.tools/us007-physical', import.meta.url),
);
const database = path.join(directory, 'synthetic.sqlite');
const cleanup = () => {
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    rmSync(database + suffix, { force: true });
};
let report;
try {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  rmSync(path.join(directory, 'report.json'), { force: true });
  cleanup();
  try {
    report = runProbe(database);
  } finally {
    cleanup();
  }
  report.completed_at_utc = new Date().toISOString();
  report.node_version = process.versions.node;
  report.database_removed = ['', '-journal', '-wal', '-shm'].every(
    (suffix) => !existsSync(database + suffix),
  );
  validatePhysicalEvidence(report);
  writeFileSync(
    path.join(directory, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'US-007: SQLite representation checks passed; sanitized report saved in .tools/us007-physical/report.json.',
  );
} catch {
  console.error(
    'US-007 physical probe failed. Raw rows, values and database errors are never logged.',
  );
  process.exitCode = 1;
}
