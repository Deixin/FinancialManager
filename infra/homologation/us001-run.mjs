import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  constants,
} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGuestEvidence } from './us001-evidence.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = path.join(repository, '.tools/us001-docker-vm');
const shared = path.join(base, 'shared');
const binaryRoot = path.join(
  repository,
  'apps/desktop/spikes/us-001/target/debug',
);
const cli = path.join(binaryRoot, 'vault-spike.exe');
const container = 'fm-us001-windows';
const started = Date.now();
let password;
let source;
let original;

function execute(command, args, input, timeout = 90_000) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = [];
    const errors = [];
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error('PROCESS_TIMEOUT'));
    }, timeout);
    process.stdout.on('data', (bytes) => output.push(bytes));
    process.stderr.on('data', (bytes) => errors.push(bytes));
    process.on('error', () => {
      clearTimeout(timer);
      reject(new Error('PROCESS_START_FAILED'));
    });
    process.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        output: Buffer.concat(output).toString('utf8'),
        errors: Buffer.concat(errors).toString('utf8'),
      });
    });
    process.stdin.on('error', () => {
      /* A rejected CLI may close stdin before consuming it. */
    });
    process.stdin.end(input);
  });
}

async function call(args, secret, expected = 0) {
  const result = await execute(cli, ['--root', source, ...args], secret);
  if (result.code !== expected) throw new Error('HOST_CLI_FAILED');
  return expected === 0 ? JSON.parse(result.output) : undefined;
}

function hash(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

function writeJson(name, value) {
  const temporary = path.join(shared, name + '.tmp');
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path.join(shared, name));
}

async function waitFor(names, timeout) {
  const deadline = Date.now() + timeout;
  let nextUpdate = 0;
  while (Date.now() < deadline) {
    for (const name of names) {
      if (existsSync(path.join(shared, name))) {
        return {
          name,
          value: JSON.parse(readFileSync(path.join(shared, name), 'utf8')),
        };
      }
    }
    if (Date.now() > nextUpdate) {
      console.log(
        'US001_VM_WAIT_' +
          Math.floor((Date.now() - started) / 1000) +
          '_SECONDS',
      );
      nextUpdate = Date.now() + 30_000;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('GUEST_TIMEOUT');
}

try {
  if (process.platform !== 'win32') throw new Error('WINDOWS_HOST_REQUIRED');
  mkdirSync(shared, { recursive: true });
  if (existsSync(path.join(shared, 'result.json')))
    throw new Error('VM_ALREADY_TESTED');
  const hashes = {};
  for (const name of ['vault-spike.exe', 'vault-spike-ui.exe']) {
    copyFileSync(path.join(binaryRoot, name), path.join(shared, name));
    hashes[name] = hash(path.join(shared, name));
  }
  const ready = await waitFor(['ready.json', 'result.json'], 5_400_000);
  if (
    ready.name !== 'ready.json' ||
    ready.value.version !== 1 ||
    ready.value.interactive_session !== true
  ) {
    throw new Error('GUEST_STARTUP_FAILED');
  }
  const machine = await execute('powershell.exe', [
    '-NoProfile',
    '-Command',
    "$sha=[Security.Cryptography.SHA256]::Create(); try { ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((Get-CimInstance Win32_ComputerSystemProduct).UUID.Trim().ToUpperInvariant())))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }",
  ]);
  const hostMachineHash = machine.output.trim();
  if (machine.code !== 0 || !/^[a-f0-9]{64}$/.test(hostMachineHash))
    throw new Error('HOST_IDENTITY_FAILED');
  source = mkdtempSync(path.join(base, 'host-source-'));
  password = Buffer.from(randomBytes(32).toString('base64url'), 'ascii');
  const originalWorkspace = (await call(['create'])).workspace_id;
  original = originalWorkspace;
  await call(['verify', original]);
  const packagePath = path.join(shared, 'synthetic.fmbackup');
  await call(['backup', original, packagePath], password);
  await call(['remove-synthetic', original]);
  original = undefined;
  if ((await call(['list'])).workspaces.length !== 0)
    throw new Error('HOST_SOURCE_NOT_REMOVED');
  const publicKey = createPublicKey({
    key: {
      kty: 'RSA',
      n: Buffer.from(ready.value.modulus, 'base64').toString('base64url'),
      e: Buffer.from(ready.value.exponent, 'base64').toString('base64url'),
    },
    format: 'jwk',
  });
  const wrapped = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    password,
  );
  // Only the guest holding the ephemeral private key can unwrap this test secret.
  writeJson('request.json', {
    version: 1,
    wrapped_password: wrapped.toString('base64'),
    original_workspace: originalWorkspace,
    original_key_removed: true,
    host_machine_hash: hostMachineHash,
    hashes,
    package_hash: hash(packagePath),
  });
  password.fill(0);
  password = undefined;
  console.log('HOST_ORIGINAL_VAULT_AND_KEY_REMOVED');
  const first = await waitFor(['needs-reboot.json', 'result.json'], 900_000);
  if (first.name === 'result.json') throw new Error('GUEST_TEST_FAILED');
  console.log('GUEST_RESTORE_PASSED_RESTARTING_WINDOWS');
  const restart = await execute(
    'docker',
    ['restart', '--timeout', '120', container],
    undefined,
    180_000,
  );
  if (restart.code !== 0) throw new Error('GUEST_RESTART_FAILED');
  const final = await waitFor(['result.json'], 900_000);
  if (final.value.passed !== true) throw new Error('GUEST_TEST_FAILED');
  const boot = await execute('docker', [
    'inspect',
    container,
    '--format',
    '{{.State.StartedAt}}',
  ]);
  if (boot.code !== 0) throw new Error('BOOT_EVIDENCE_FAILED');
  const resultWrittenAt = statSync(
    path.join(shared, 'result.json'),
  ).mtime.toISOString();
  validateGuestEvidence(final.value, boot.output.trim(), resultWrittenAt);
  const image = await execute('docker', [
    'inspect',
    container,
    '--format',
    '{{.Config.Image}}',
  ]);
  if (image.code !== 0) throw new Error('IMAGE_EVIDENCE_FAILED');
  const evidence = {
    ...final.value,
    format_version: 1,
    completed_at_utc: new Date().toISOString(),
    reboot_started_at_utc: boot.output.trim(),
    guest_result_written_at_utc: resultWrittenAt,
    docker_image: image.output.trim(),
    artifacts_sha256: hashes,
    host_source_removed: true,
    duration_seconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(
    path.join(base, 'homologation-result.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message)
    ? error.message
    : 'HOST_HARNESS_FAILED';
  console.error(code);
  process.exitCode = 1;
} finally {
  if (password) password.fill(0);
  if (source && original) {
    try {
      await call(['remove-synthetic', original]);
    } catch {
      console.error('HOST_FIXTURE_CLEANUP_REQUIRED');
    }
  }
  const stopped = await execute(
    'docker',
    ['stop', '--time', '120', container],
    undefined,
    180_000,
  );
  if (stopped.code !== 0) {
    console.error('VM_STOP_FAILED');
    process.exitCode = 1;
  }
}
