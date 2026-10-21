import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
  existsSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { root, catalogPath, readCatalog, readRecord } from './evidence.mjs';
import {
  planValidation,
  loadProtocol,
  assertCatalogCurrent,
} from './planner.mjs';
import {
  changedInputs,
  digest,
  objectDigest,
  protocolSources,
  relativeInput,
  safetyInputsFor,
} from './policy.mjs';

export function verifyCompletedRun({
  entry,
  report,
  before,
  after,
  startedAt,
  previousTimestamp,
  outputModifiedAt,
  finishedAt,
}) {
  const timestamp = report.completed_at_utc;
  if (
    report.scope !== entry.scope ||
    report.passed !== true ||
    !Number.isFinite(outputModifiedAt) ||
    !Number.isFinite(finishedAt) ||
    outputModifiedAt < startedAt ||
    outputModifiedAt > finishedAt ||
    (timestamp !== undefined &&
      (!Number.isFinite(Date.parse(timestamp)) ||
        Date.parse(timestamp) < startedAt ||
        Date.parse(timestamp) > finishedAt ||
        timestamp === previousTimestamp)) ||
    changedInputs(before, after).length
  )
    throw Error('PROTOCOL_RUN_NOT_FRESH_OR_INPUTS_CHANGED');
}

export function archiveReport(
  catalog,
  entry,
  bytes,
  criticalInputs,
  directory = root,
  execution = {},
) {
  const report = JSON.parse(bytes);
  const hash = digest(bytes);
  const destination = 'docs/quality/evidence/runs/' + hash + '.json';
  mkdirSync(path.join(directory, 'docs/quality/evidence/runs'), {
    recursive: true,
  });
  const fullPath = path.join(directory, destination);
  if (existsSync(fullPath)) {
    if (digest(readFileSync(fullPath)) !== hash)
      throw Error('IMMUTABLE_EVIDENCE_CHANGED');
  } else writeFileSync(fullPath, bytes, { flag: 'wx' });
  const guardedInputs = safetyInputsFor(entry, criticalInputs);
  const safety = digest(JSON.stringify(Object.entries(guardedInputs).sort()));
  catalog.safetyBaselines[safety] = guardedInputs;
  Object.assign(entry, {
    report: destination,
    sha256: hash,
    content_sha256: objectDigest(report),
    safety_digest: safety,
    origin: {
      kind: 'executed',
      ...execution,
      completed_at_utc: report.completed_at_utc ?? execution.completed_at_utc,
    },
  });
  return destination;
}

function pnpmCommand() {
  if (process.platform !== 'win32') return ['pnpm'];
  const paths = execFileSync('where.exe', ['pnpm'], {
    encoding: 'utf8',
    windowsHide: true,
  })
    .trim()
    .split(/\r?\n/);
  const shim = paths.find((file) => file.endsWith('.cmd'));
  const entry =
    shim &&
    readFileSync(shim, 'utf8').match(
      /%dp0%\\([^"\r\n]+pnpm\.(?:cjs|mjs))/i,
    )?.[1];
  if (!entry) throw Error('PNPM_ENTRY_UNAVAILABLE');
  return [process.execPath, path.resolve(path.dirname(shim), entry)];
}

function runLogged(command, args, filename) {
  return new Promise((resolve, reject) => {
    const fd = openSync(filename, 'wx');
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        TURBO_TELEMETRY_DISABLED: '1',
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH
          ? {}
          : existsSync(path.join(root, '.tools/us003-oidc/browsers'))
            ? {
                PLAYWRIGHT_BROWSERS_PATH: path.join(
                  root,
                  '.tools/us003-oidc/browsers',
                ),
              }
            : {}),
      },
    });
    closeSync(fd);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(Error('VALIDATION_STEP_FAILED: ' + path.basename(filename)));
    });
  });
}

export async function runValidation({ full = false, forceScopes = [] } = {}) {
  const directory = path.join(root, '.tools/validation');
  mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, 'run.lock');
  const token = JSON.stringify({ pid: process.pid, id: randomUUID() });
  writeFileSync(lock, token, { flag: 'wx' });
  const runId = randomUUID();
  const timings = {
    format_version: 1,
    run_id: runId,
    passed: false,
    steps: [],
  };
  const measure = async (name, command) => {
    const start = Date.now();
    console.log('START ' + name);
    try {
      await runLogged(
        command[0],
        command.slice(1),
        path.join(directory, runId + '-' + name + '.log'),
      );
      timings.steps.push({
        name,
        duration_ms: Date.now() - start,
        passed: true,
      });
      console.log('PASS ' + name + ' ' + (Date.now() - start) + 'ms');
    } catch (error) {
      timings.steps.push({
        name,
        duration_ms: Date.now() - start,
        passed: false,
      });
      throw error;
    }
  };
  try {
    const catalog = JSON.parse(JSON.stringify(readCatalog()));
    const initialCatalogHash = digest(readFileSync(catalogPath));
    let expectedCatalogHash = initialCatalogHash;
    const plan = await planValidation({ full });
    if (plan.unclassified.length)
      throw Error(
        'REGISTER_INPUT_COVERAGE_FIRST: ' + plan.unclassified.join(', '),
      );
    if (
      forceScopes.some(
        (scope) => !catalog.entries.some((entry) => entry.scope === scope),
      )
    )
      throw Error('VALIDATION_SCOPE_UNKNOWN');
    const selected = plan.suites.filter(
      (suite) => suite.selected || forceScopes.includes(suite.scope),
    );
    if (
      process.platform !== 'win32' &&
      selected.some(
        (suite) =>
          catalog.entries.find((entry) => entry.scope === suite.scope).kind ===
          'native',
      )
    )
      throw Error('WINDOWS_PROTOCOL_REQUIRED');
    timings.reused = plan.suites.length - selected.length;
    const pnpm = pnpmCommand();
    if (selected.length) {
      for (const name of ['format:check', 'lint', 'typecheck', 'build'])
        await measure(name.replace(':', '-'), [...pnpm, name]);
    }
    // A single queue keeps Cargo targets, WebView and shared protocol resources
    // isolated. Each successful artifact is committed to the catalog atomically;
    // an interrupted queue can reuse it only while its inputs remain identical.
    for (const suite of selected) {
      const entry = catalog.entries.find((item) => item.scope === suite.scope);
      const protocol = await loadProtocol(entry);
      const before = protocolSources(
        { source_sha256: protocol.hashes() },
        entry.sourceBase,
      );
      const old = readRecord(entry);
      const startedAt = Date.now();
      await measure(entry.scope, [process.execPath, ...entry.command]);
      const outputPath = path.join(root, relativeInput(entry.output));
      const bytes = readFileSync(outputPath);
      const finishedAt = Date.now();
      const report = JSON.parse(bytes);
      protocol.validate(report); // All original gates and strict source matching.
      const after = protocolSources(
        { source_sha256: protocol.hashes() },
        entry.sourceBase,
      );
      verifyCompletedRun({
        entry,
        report,
        before,
        after,
        startedAt,
        previousTimestamp: old.completed_at_utc,
        outputModifiedAt: statSync(outputPath).mtimeMs,
        finishedAt,
      });
      const now = await planValidation();
      if (
        now.unclassified.length ||
        changedInputs(plan.criticalInputs, now.criticalInputs).length
      )
        throw Error('VALIDATION_INPUTS_CHANGED_DURING_QUEUE');
      if (digest(readFileSync(catalogPath)) !== expectedCatalogHash)
        throw Error('VALIDATION_CATALOG_CONCURRENT_CHANGE');
      archiveReport(catalog, entry, bytes, plan.criticalInputs, root, {
        started_at_utc: new Date(startedAt).toISOString(),
        completed_at_utc: new Date(finishedAt).toISOString(),
      });
      const temporary = catalogPath + '.' + runId + '.tmp';
      const formattedCatalog = await format(JSON.stringify(catalog), {
        ...(await resolveConfig(catalogPath)),
        filepath: catalogPath,
      });
      writeFileSync(temporary, formattedCatalog, {
        flag: 'wx',
      });
      renameSync(temporary, catalogPath);
      expectedCatalogHash = digest(readFileSync(catalogPath));
    }
    await assertCatalogCurrent();
    // Never replace the repository's final gate with a cache hit.
    await measure('pnpm-check', [...pnpm, 'check']);
    await assertCatalogCurrent();
    timings.passed = true;
    return timings;
  } finally {
    writeFileSync(
      path.join(directory, runId + '-timings.json'),
      JSON.stringify(timings, null, 2) + '\n',
      { flag: 'wx' },
    );
    if (readFileSync(lock, 'utf8') === token) unlinkSync(lock);
  }
}
