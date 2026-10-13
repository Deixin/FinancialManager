import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const spike = path.join(root, 'apps/desktop/spikes/us-001');
const environment = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const portablePerl = path.join(
  root,
  '.tools/strawberry-perl-5.42.3.1/perl/bin',
);
if (existsSync(path.join(portablePerl, 'perl.exe'))) {
  const pathKey =
    Object.keys(environment).find((key) => key.toLowerCase() === 'path') ??
    'PATH';
  environment[pathKey] = portablePerl + path.delimiter + environment[pathKey];
}

function run(command, args, timeout = 1_200_000) {
  const result = spawnSync(command, args, {
    cwd: spike,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
    timeout,
  });
  if (result.error || result.status !== 0) {
    console.error(
      'Desktop spike command failed: ' +
        command +
        ' (' +
        (result.error?.code ?? result.status) +
        ')',
    );
    process.exit(result.status || 1);
  }
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('US-001 currently validates Windows x64 only.');
  process.exit(1);
}
const perl = spawnSync('perl', ['-MIPC::Cmd', '-e', 'print $^O'], {
  cwd: spike,
  env: environment,
  encoding: 'utf8',
  timeout: 10_000,
  windowsHide: true,
});
if (perl.error || perl.status !== 0 || perl.stdout !== 'MSWin32') {
  console.error(
    'A native Windows Perl with IPC::Cmd is required to build bundled OpenSSL. See the US-001 protocol.',
  );
  process.exit(1);
}

const mode = process.argv[2];
if (mode === 'test') {
  run('cargo', ['test', '--locked']);
} else if (mode === 'check') {
  run('cargo', ['fmt', '--all', '--', '--check']);
  run('cargo', [
    'clippy',
    '--locked',
    '--all-targets',
    '--features',
    'desktop-ui',
    '--',
    '-D',
    'warnings',
  ]);
  run('cargo', ['test', '--locked']);
  run('cargo', [
    'build',
    '--locked',
    '--features',
    'desktop-ui',
    '--bin',
    'vault-spike-ui',
  ]);
  const evidence = path.join(root, '.tools/us-001-evidence');
  mkdirSync(evidence, { recursive: true });
  const report = path.join(evidence, 'tauri-smoke.json');
  run(
    path.join(spike, 'target/debug/vault-spike-ui.exe'),
    ['--smoke-report', report],
    120_000,
  );
  const result = JSON.parse(readFileSync(report, 'utf8'));
  if (result.passed !== true || result.exact_synthetic_data !== true) {
    console.error('Tauri WebView smoke did not verify the synthetic data.');
    process.exit(1);
  }
  console.log(
    'Tauri WebView IPC + SQLCipher + Windows credentials + independent restore: OK.',
  );
} else if (mode === 'ui') {
  run('cargo', [
    'run',
    '--locked',
    '--features',
    'desktop-ui',
    '--bin',
    'vault-spike-ui',
  ]);
} else if (mode === 'package') {
  run('cargo', ['build', '--locked', '--bin', 'vault-spike']);
  run('cargo', [
    'build',
    '--locked',
    '--features',
    'desktop-ui',
    '--bin',
    'vault-spike-ui',
  ]);
  const toolsDirectory = path.join(root, '.tools');
  mkdirSync(toolsDirectory, { recursive: true });
  const destination = mkdtempSync(path.join(toolsDirectory, 'us-001-handoff-'));
  const files = [
    ['target/debug/vault-spike.exe', 'vault-spike.exe'],
    ['target/debug/vault-spike-ui.exe', 'vault-spike-ui.exe'],
    [
      '../../../../docs/development/spikes/us-001-homologation.md',
      'LEIA-ME.md',
    ],
  ];
  const hashes = files.map(([source, name]) => {
    copyFileSync(path.resolve(spike, source), path.join(destination, name));
    return (
      createHash('sha256')
        .update(readFileSync(path.join(destination, name)))
        .digest('hex') +
      '  ' +
      name
    );
  });
  writeFileSync(
    path.join(destination, 'SHA256SUMS.txt'),
    hashes.join('\n') + '\n',
  );
  console.log('Synthetic homologation kit: ' + destination);
} else if (mode === 'cli') {
  run('cargo', [
    'run',
    '--locked',
    '--bin',
    'vault-spike',
    '--',
    ...process.argv.slice(3),
  ]);
} else {
  console.error('Expected: test, check, ui, package or cli.');
  process.exit(1);
}
