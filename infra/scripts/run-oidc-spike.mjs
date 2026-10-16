/* global fetch, setTimeout, clearTimeout, AbortSignal */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realmFixture, issuer } from '../oidc/fixture.mjs';
import { homologate } from '../oidc/homologate.mjs';
import { localClient } from '../../apps/web/spikes/us-003/oidc.mjs';
import { createBff } from '../../apps/web/spikes/us-003/bff.mjs';
import { validateOidcEvidence } from './oidc-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, '.tools/us003-oidc');
const composeFile = path.join(root, 'infra/oidc/compose.yaml');
const credentialsFile = path.join(artifacts, 'credentials.json');
const env = {
  ...process.env,
  US003_ARTIFACTS: artifacts.replaceAll('\\', '/'),
  PLAYWRIGHT_BROWSERS_PATH: path.join(artifacts, 'browsers'),
};
const mode = process.argv[2];
let stage = 'configuration';

async function run(command, args, timeout = 180_000, capture = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Tools can include server URLs in errors. Do not relay raw output to operational logs.
    let output = '';
    if (capture)
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
    else child.stdout.resume();
    child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('TOOL_TIMEOUT'));
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('TOOL_UNAVAILABLE'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error('TOOL_FAILED'));
    });
  });
}
const compose = (...args) =>
  run('docker', ['compose', '-f', composeFile, ...args]);

function removeSecrets() {
  for (const name of [
    'credentials.json',
    'realm.json',
    'localhost.key',
    'localhost.pem',
  ])
    rmSync(path.join(artifacts, name), { force: true });
}

async function assertDockerIsolation() {
  const ids = (
    await run(
      'docker',
      ['compose', '-f', composeFile, 'ps', '-q'],
      30_000,
      true,
    )
  )
    .trim()
    .split(/\s+/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(
    await run('docker', ['inspect', ...ids], 30_000, true),
  );
  for (const container of containers) {
    const role = container.Config.Labels['com.docker.compose.service'];
    assert.ok(['keycloak', 'mailpit', 'loopback'].includes(role));
    assert.equal(container.State.Running, true);
    const networks = Object.keys(container.NetworkSettings.Networks);
    assert.ok(networks.includes('financial-manager-us003_isolated'));
    if (role !== 'loopback') {
      assert.equal(networks.length, 1);
      assert.equal(
        Object.keys(container.HostConfig.PortBindings ?? {}).length,
        0,
      );
    } else {
      assert.equal(networks.length, 2);
      const ports = Object.values(container.HostConfig.PortBindings).flat();
      assert.deepEqual(ports.map((port) => port.HostPort).sort(), [
        '43180',
        '43185',
      ]);
      assert.ok(ports.every((port) => port.HostIp === '127.0.0.1'));
    }
  }
  const network = JSON.parse(
    await run(
      'docker',
      ['network', 'inspect', 'financial-manager-us003_isolated'],
      30_000,
      true,
    ),
  );
  assert.equal(network[0].Internal, true);
}

async function teardown() {
  try {
    await compose('down', '--volumes');
  } finally {
    removeSecrets();
  }
  const remaining = await run(
    'docker',
    ['compose', '-f', composeFile, 'ps', '-a', '-q'],
    30_000,
    true,
  );
  assert.equal(remaining.trim(), '');
  for (const name of [
    'credentials.json',
    'realm.json',
    'localhost.key',
    'localhost.pem',
  ])
    assert.equal(existsSync(path.join(artifacts, name)), false);
}

async function prepare() {
  mkdirSync(artifacts, { recursive: true });
  const credentials = {
    password: randomBytes(32).toString('base64url'),
    clientSecret: randomBytes(32).toString('base64url'),
  };
  writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
  writeFileSync(
    path.join(artifacts, 'realm.json'),
    JSON.stringify(realmFixture(credentials)),
    { mode: 0o600 },
  );
  const openssl = process.env.US003_OPENSSL ?? 'openssl';
  await run(openssl, [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=US003 Synthetic Loopback',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
    '-keyout',
    path.join(artifacts, 'localhost.key'),
    '-out',
    path.join(artifacts, 'localhost.pem'),
  ]);
  await compose('up', '-d', '--force-recreate');
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      const response = await fetch(
        issuer + '/.well-known/openid-configuration',
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok) return credentials;
    } catch {
      /* The dedicated development provider is still booting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('LOCAL_PROVIDER_NOT_READY');
}

try {
  if (mode === 'down') {
    await teardown();
    console.log('US-003: containers and synthetic secrets removed.');
  } else if (mode === 'setup') {
    await compose('down', '--volumes');
    stage = 'prepare_provider';
    await prepare();
    console.log(
      'US-003: synthetic provider ready. Start the BFF with pnpm spike:oidc:serve.',
    );
  } else if (mode === 'serve') {
    if (!existsSync(credentialsFile)) throw new Error('SETUP_REQUIRED');
    const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
    const config = await localClient({
      issuer,
      clientId: 'us003-web',
      clientSecret: credentials.clientSecret,
    });
    const server = createBff({
      config,
      key: readFileSync(path.join(artifacts, 'localhost.key')),
      cert: readFileSync(path.join(artifacts, 'localhost.pem')),
    });
    server.listen(43181, '127.0.0.1', () =>
      console.log(
        'US-003 BFF: https://127.0.0.1:43181 (local test certificate).',
      ),
    );
    process.once('SIGINT', () => server.close());
    process.once('SIGTERM', () => server.close());
  } else if (mode === 'test') {
    rmSync(path.join(artifacts, 'report.json'), { force: true });
    let report = {
      format_version: 1,
      synthetic_only: true,
      scope: 'local-oidc-protocol',
      passed: false,
      checks: {},
    };
    try {
      stage = 'reset_synthetic_stack';
      await compose('down', '--volumes');
      stage = 'prepare_provider';
      const credentials = await prepare();
      stage = 'docker_isolation';
      await assertDockerIsolation();
      stage = 'prepare_browser';
      await run(
        process.execPath,
        [
          path.join(root, 'node_modules/playwright/cli.js'),
          'install',
          'chromium',
        ],
        600_000,
      );
      process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH;
      const { chromium } = await import('playwright');
      report = await homologate({
        artifacts,
        credentials,
        chromium,
        progress: (name) => {
          stage = name;
          console.log('US-003 check: ' + name);
        },
      });
      report.checks.docker_isolation = true;
    } finally {
      await teardown();
      if (report) {
        if (!report.passed) report.failed_step ??= stage;
        report.completed_at_utc = new Date().toISOString();
        report.containers_and_synthetic_secrets_removed = true;
        report.versions = {
          ...report.versions,
          keycloak: '26.8.0',
          mailpit: '1.27.4',
          openid_client: '6.8.8',
          playwright: '1.64.1',
          caddy: '2.10.2',
          node: process.versions.node,
        };
        if (report.passed) validateOidcEvidence(report);
        writeFileSync(
          path.join(artifacts, 'report.json'),
          JSON.stringify(report, null, 2) + '\n',
        );
      }
    }
    if (!report?.passed) throw new Error('OIDC_EVIDENCE_FAILED');
    validateOidcEvidence(report);
    console.log(
      'US-003: local OIDC protocol passed; sanitized evidence saved in .tools/us003-oidc/report.json.',
    );
  } else throw new Error('EXPECTED_SETUP_SERVE_TEST_OR_DOWN');
} catch {
  console.error(
    'US-003 failed at: ' +
      stage +
      '. No raw provider/browser errors are logged.',
  );
  process.exitCode = 1;
}
