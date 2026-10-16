/* global Buffer, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateAndroidReboot,
  validateAndroidLibraries,
  validateMobileReport,
} from './mobile-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mobile = path.join(root, 'apps/mobile');
const artifacts = path.join(root, '.tools/us002-android');
const env = {
  ...process.env,
  EXPO_NO_TELEMETRY: '1',
  CI: '1',
  NODE_ENV: 'production',
  GRADLE_USER_HOME: path.join(artifacts, 'gradle'),
};
const mode = process.argv[2];
const appId = 'com.miudos.financialmanager.us002';
const serial = process.env.US002_ANDROID_SERIAL ?? 'emulator-5562';
if (!/^emulator-[0-9]+$/.test(serial))
  throw new Error('DEDICATED_EMULATOR_REQUIRED');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adbPath = sdk
  ? path.join(
      sdk,
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    )
  : 'adb';

async function run(
  command,
  args,
  { cwd = mobile, capture = false, timeout = 1_800_000, binary = false } = {},
) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: [
        'ignore',
        capture ? 'pipe' : 'inherit',
        capture ? 'pipe' : 'inherit',
      ],
    });
    const output = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MOBILE_COMMAND_TIMEOUT'));
    }, timeout);
    child.stdout?.on('data', (data) => output.push(data));
    // Captured Android output is never copied to errors: native errors can contain data.
    child.stderr?.on('data', () => {});
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('MOBILE_COMMAND_FAILED_' + code));
      else
        resolve(
          binary
            ? Buffer.concat(output)
            : Buffer.concat(output).toString('utf8').trim(),
        );
    });
  });
}

async function adb(...args) {
  try {
    return await run(adbPath, ['-s', serial, ...args], {
      capture: true,
      timeout: args[0] === 'install' ? 180_000 : 30_000,
    });
  } catch {
    const command = (args[0] === 'shell' ? 'SHELL_' + args[1] : args[0])
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
    throw new Error('ADB_' + command + '_FAILED');
  }
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 1500));
async function assertOffline() {
  const states = await Promise.all(
    ['airplane_mode_on', 'wifi_on', 'mobile_data'].map((name) =>
      adb('shell', 'settings', 'get', 'global', name),
    ),
  );
  if (states.join('|') !== '1|0|0')
    throw new Error('ANDROID_OFFLINE_NOT_CONFIRMED');
}
async function booted() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      if ((await adb('shell', 'getprop', 'sys.boot_completed')) === '1') return;
    } catch {
      /* guest is restarting */
    }
    await pause();
  }
  throw new Error('ANDROID_BOOT_TIMEOUT');
}

async function launch(phase) {
  await adb('shell', 'am', 'force-stop', appId);
  const started = Date.now();
  await adb('shell', 'am', 'start', '-n', appId + '/.MainActivity');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const pid = await adb('shell', 'pidof', appId).catch(() => '');
    if (pid) {
      const logs = await adb(
        'logcat',
        '-d',
        '--pid=' + pid,
        '-t',
        '1000',
        '-s',
        'ReactNativeJS:I',
      );
      for (const line of logs.split('\n')) {
        const marker = line.indexOf('US002_REPORT ');
        if (marker < 0) continue;
        const result = JSON.parse(line.slice(marker + 'US002_REPORT '.length));
        if (Date.parse(result.completed_at_utc) < started - 2000) continue;
        if (
          result.passed === false &&
          /^[A-Z][A-Z0-9_]{2,80}$/.test(result.error_code)
        ) {
          throw new Error('MOBILE_NATIVE_FAILED_' + result.error_code);
        }
        validateMobileReport(result, phase);
        console.log('US-002 native phase passed: ' + phase);
        return result;
      }
    }
    await pause();
  }
  throw new Error('NATIVE_REPORT_TIMEOUT');
}

if (mode === 'prebuild') {
  await run(process.execPath, [
    path.join(mobile, 'node_modules/expo/bin/cli'),
    'prebuild',
    '--platform',
    process.platform === 'darwin' ? 'all' : 'android',
    '--no-install',
  ]);
} else if (mode === 'build-android') {
  if (process.platform === 'win32') {
    const cmake = path.join(artifacts, 'cmake-3.22.1');
    if (!sdk || !existsSync(path.join(cmake, 'bin/ninja.exe'))) {
      throw new Error(
        'Run spike:mobile:setup:android before building on Windows',
      );
    }
    writeFileSync(
      path.join(mobile, 'android/local.properties'),
      'sdk.dir=' +
        sdk.replaceAll('\\', '/') +
        '\ncmake.dir=' +
        cmake.replaceAll('\\', '/') +
        '\n',
    );
  }
  const args = [
    ':app:assembleRelease',
    '-PreactNativeArchitectures=x86_64',
    '--no-daemon',
    '--max-workers=2',
    '--console=plain',
  ];
  await run(
    process.platform === 'win32' ? 'cmd.exe' : './gradlew',
    process.platform === 'win32' ? ['/d', '/c', 'gradlew.bat', ...args] : args,
    { cwd: path.join(mobile, 'android') },
  );
} else if (mode === 'test-android') {
  mkdirSync(artifacts, { recursive: true });
  await booted();
  if ((await adb('shell', 'getprop', 'ro.kernel.qemu')) !== '1')
    throw new Error('EMULATOR_REQUIRED');
  // The harness only installs its own synthetic package on an explicitly isolated emulator.
  const apk = path.join(
    mobile,
    'android/app/build/outputs/apk/release/app-release.apk',
  );
  const jar = process.env.JAVA_HOME
    ? path.join(
        process.env.JAVA_HOME,
        'bin',
        process.platform === 'win32' ? 'jar.exe' : 'jar',
      )
    : 'jar';
  const entries = await run(jar, ['tf', apk], { capture: true });
  validateAndroidLibraries(entries.split(/\r?\n/));
  await adb('install', '-r', apk);
  await adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
  await adb('shell', 'svc', 'wifi', 'disable');
  await adb('shell', 'svc', 'data', 'disable');
  await assertOffline();
  const before = Number(
    await adb('shell', 'settings', 'get', 'global', 'boot_count'),
  );
  const prepared = await launch('prepared');
  writeFileSync(
    path.join(artifacts, 'prepared.json'),
    JSON.stringify({ before, prepared }, null, 2) + '\n',
  );
  // A reboot can close ADB before its acknowledgement. The boot counter below,
  // rather than this transport result, determines whether the restart happened.
  await adb('reboot').catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await booted();
  await adb('shell', 'input', 'keyevent', '82');
  const after = Number(
    await adb('shell', 'settings', 'get', 'global', 'boot_count'),
  );
  validateAndroidReboot(before, after);
  await assertOffline();
  const reopened = await launch('reopened');
  await pause();
  const screenshot = await run(
    adbPath,
    ['-s', serial, 'exec-out', 'screencap', '-p'],
    { capture: true, binary: true },
  );
  writeFileSync(path.join(artifacts, 'native-screen.png'), screenshot);
  const cleaned = await launch('cleaned');
  const report = {
    format_version: 1,
    synthetic_only: true,
    platform: 'android',
    android_release: await adb('shell', 'getprop', 'ro.build.version.release'),
    android_api: Number(await adb('shell', 'getprop', 'ro.build.version.sdk')),
    abi: await adb('shell', 'getprop', 'ro.product.cpu.abi'),
    completed_at_utc: new Date().toISOString(),
    offline_confirmed: true,
    full_reboot_verified: true,
    runtime_libraries_packaged: true,
    boot_count_before: before,
    boot_count_after: after,
    apk_sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
    prepared,
    reopened,
    cleaned,
  };
  writeFileSync(
    path.join(artifacts, 'evidence.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await adb('shell', 'am', 'force-stop', appId);
  console.log(
    'US-002 Android native verification passed. Sanitized evidence: .tools/us002-android/evidence.json',
  );
} else {
  throw new Error('Use prebuild, build-android or test-android');
}
