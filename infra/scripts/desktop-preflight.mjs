import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const target = 'x86_64-pc-windows-msvc';
const commandOptions = {
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true,
};

// Read only the C++ component inventory and WebView2 Runtime registration.
const windowsInventory = String.raw`
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio/Installer/vswhere.exe'
$cppTools = $false
if (Test-Path -LiteralPath $vswhere) {
  $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $cppTools = ($LASTEXITCODE -eq 0) -and [bool]$installation
}
$versions = @()
$keys = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
foreach ($key in $keys) {
  $version = Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue
  if ($null -ne $version) { $versions += $version.pv }
}
@{ cppTools = $cppTools; webviewVersions = $versions } | ConvertTo-Json -Compress
`;

function succeeded(result) {
  return !result.error && result.status === 0;
}

export function findWebViewVersion(versions) {
  if (!Array.isArray(versions)) return undefined;
  return versions.find(
    (version) =>
      typeof version === 'string' &&
      /^\d+\.\d+\.\d+\.\d+$/.test(version) &&
      version.split('.').some((part) => /[1-9]/.test(part)),
  );
}

export function probeNativeLink(run = spawnSync) {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'financial-manager-desktop-preflight-'),
  );
  try {
    const source = path.join(directory, 'probe.rs');
    const executable = path.join(directory, 'probe.exe');
    writeFileSync(source, 'fn main() { std::process::exit(0); }\n');
    const compile = run(
      'rustc',
      [
        '--crate-name',
        'financial_manager_desktop_preflight',
        '--target',
        target,
        source,
        '-o',
        executable,
      ],
      commandOptions,
    );
    if (!succeeded(compile)) {
      return {
        ok: false,
        message:
          'Native compilation/link failed. Check MSVC, Windows SDK and rustup target; no toolchain was installed.',
      };
    }
    return succeeded(run(executable, [], commandOptions))
      ? { ok: true, message: 'Rust executable compiled, linked and ran.' }
      : { ok: false, message: 'The native probe compiled but failed to run.' };
  } finally {
    // Only remove the unique temporary directory created by this probe.
    rmSync(directory, { recursive: true, force: true });
  }
}

export function checkDesktopEnvironment({
  platform = process.platform,
  arch = process.arch,
  run = spawnSync,
} = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    return [
      {
        id: 'platform',
        ok: false,
        message:
          'This preflight covers the proposed Windows x64 target only. Other targets are not validated.',
      },
    ];
  }

  const rust = run('rustc', ['--version', '--verbose'], commandOptions);
  const rustReady =
    succeeded(rust) && /^host: x86_64-pc-windows-msvc\r?$/m.test(rust.stdout);
  const cargo = run('cargo', ['--version'], commandOptions);
  const inventory = run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', windowsInventory],
    commandOptions,
  );
  let native = {};
  if (succeeded(inventory)) {
    try {
      native = JSON.parse(inventory.stdout) ?? {};
    } catch {
      // An unreadable inventory must never report a prerequisite as present.
    }
  }
  const webview = findWebViewVersion(native.webviewVersions);
  const checks = [
    {
      id: 'rust',
      ok: rustReady,
      message: rustReady
        ? 'Rust host: ' + target
        : 'Rust MSVC x64 is unavailable. Check rustup show active-toolchain.',
    },
    {
      id: 'cargo',
      ok: succeeded(cargo),
      message: succeeded(cargo)
        ? 'Cargo available.'
        : 'Cargo unavailable; install/check the Rust toolchain.',
    },
    {
      id: 'cpp',
      ok: native.cppTools === true,
      message:
        native.cppTools === true
          ? 'Visual Studio C++ x64/x86 tools detected by vswhere.'
          : 'C++ tools were not detected. Check Desktop development with C++ and vswhere.',
    },
    {
      id: 'webview',
      ok: Boolean(webview),
      message: webview
        ? 'WebView2 Runtime registered: ' + webview
        : 'WebView2 Runtime was not detected in machine or user registration.',
    },
  ];
  if (rustReady) {
    checks.push({ id: 'native-smoke', ...probeNativeLink(run) });
  }
  return checks;
}
