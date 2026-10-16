/* global setTimeout,clearTimeout */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndroidLibraries } from '../scripts/mobile-evidence.mjs';
import { format, resolveConfig } from 'prettier';
import { sourceHashes, validateNativeEvidence } from './dual-evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  mobile = path.join(root, 'apps/mobile'),
  artifacts = path.join(root, '.tools/us021-native');
mkdirSync(artifacts, { recursive: true });
const environment = {
  ...process.env,
  EXPO_NO_TELEMETRY: '1',
  CI: '1',
  NODE_ENV: 'production',
  GRADLE_USER_HOME: path.join(root, '.tools/us002-android/gradle'),
};
const sdk = environment.ANDROID_HOME ?? environment.ANDROID_SDK_ROOT;
const adbPath = sdk
  ? path.join(
      sdk,
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    )
  : 'adb';
const serial = 'emulator-5562',
  appId = 'com.miudos.financialmanager.us021';
async function run(
  command,
  args,
  { cwd = root, timeout = 180000, inherit = false } = {},
) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      windowsHide: true,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (data) => {
      output += data.toString();
      if (output.length > 4000000) child.kill();
    });
    child.stderr?.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('NATIVE_COMMAND_TIMEOUT'));
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('NATIVE_COMMAND_UNAVAILABLE'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error('NATIVE_COMMAND_FAILED'));
    });
  });
}
const adb = (...args) => run(adbPath, ['-s', serial, ...args]);
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));
async function waitBoot() {
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      if ((await adb('shell', 'getprop', 'sys.boot_completed')) === '1') return;
    } catch {
      /* booting */
    }
    await pause();
  }
  throw new Error('BOOT_TIMEOUT');
}
async function offline() {
  const values = [];
  for (const key of ['airplane_mode_on', 'wifi_on', 'mobile_data'])
    values.push(await adb('shell', 'settings', 'get', 'global', key));
  if (values.join('|') !== '1|0|0') throw new Error('OFFLINE_REQUIRED');
}
async function launch(phase) {
  await adb('shell', 'am', 'force-stop', appId);
  const component = (
    await adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', appId)
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .at(-1);
  if (!component?.startsWith(appId + '/'))
    throw new Error('PROBE_ACTIVITY_REQUIRED');
  await adb('shell', 'am', 'start', '-n', component);
  for (let attempt = 0; attempt < 80; attempt++) {
    const pid = await adb('shell', 'pidof', appId).catch(() => '');
    if (pid) {
      const logs = await adb(
        'logcat',
        '-d',
        '--pid=' + pid,
        '-t',
        '200',
        '-s',
        'ReactNativeJS:I',
      );
      for (const line of logs.split('\n')) {
        const marker = line.indexOf('US021_REPORT ');
        if (marker < 0) continue;
        const report = JSON.parse(line.slice(marker + 13));
        if (report.passed !== true)
          throw new Error(
            'ANDROID_PROBE_FAILED_' +
              String(report.failure_stage).replace(/[^a-z_]/g, ''),
          );
        if (report.phase === phase) return report;
      }
    }
    await pause();
  }
  throw new Error('PROBE_REPORT_TIMEOUT');
}
let stage = 'configuration';
try {
  const mode = process.argv[2];
  if (mode === 'desktop') {
    environment.US021_DESKTOP_REPORT = path.join(artifacts, 'desktop.json');
    const perl = path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin');
    if (existsSync(path.join(perl, 'perl.exe'))) {
      const key =
        Object.keys(environment).find(
          (name) => name.toLowerCase() === 'path',
        ) ?? 'PATH';
      environment[key] = perl + path.delimiter + (environment[key] ?? '');
    }
    await run(
      'cargo',
      [
        'test',
        '--manifest-path',
        'apps/desktop/spikes/us-001/Cargo.toml',
        '--locked',
        '--test',
        'us021_schema',
      ],
      { timeout: 1200000, inherit: true },
    );
  } else if (mode === 'android-build') {
    stage = 'prebuild';
    await run(
      process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
      process.platform === 'win32'
        ? ['/d', '/c', 'pnpm', 'spike:mobile:prebuild']
        : ['spike:mobile:prebuild'],
      { timeout: 600000, inherit: true },
    );
    if (process.platform === 'win32') {
      if (!sdk) throw new Error('ANDROID_SDK_REQUIRED');
      writeFileSync(
        path.join(mobile, 'android/local.properties'),
        'sdk.dir=' +
          sdk.replaceAll('\\', '/') +
          '\ncmake.dir=' +
          path
            .join(root, '.tools/us002-android/cmake-3.22.1')
            .replaceAll('\\', '/') +
          '\n',
      );
    }
    stage = 'gradle';
    const args = [
      ':app:assembleRelease',
      '-PfmSchemaProbe=us021',
      '-PreactNativeArchitectures=x86_64',
      '--no-daemon',
      '--max-workers=2',
      '--console=plain',
    ];
    await run(
      process.platform === 'win32' ? 'cmd.exe' : './gradlew',
      process.platform === 'win32'
        ? ['/d', '/c', 'gradlew.bat', ...args]
        : args,
      { cwd: path.join(mobile, 'android'), timeout: 1800000, inherit: true },
    );
    copyFileSync(
      path.join(
        mobile,
        'android/app/build/outputs/apk/release/app-release.apk',
      ),
      path.join(artifacts, 'android.apk'),
    );
  } else if (mode === 'android-test') {
    stage = 'isolated_emulator';
    await waitBoot();
    if (
      (await adb('shell', 'getprop', 'ro.kernel.qemu')) !== '1' ||
      !(await adb('emu', 'avd', 'name'))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .includes('us002')
    )
      throw new Error('DEDICATED_AVD_REQUIRED');
    const apk = path.join(artifacts, 'android.apk');
    const jar = environment.JAVA_HOME
      ? path.join(
          environment.JAVA_HOME,
          'bin',
          process.platform === 'win32' ? 'jar.exe' : 'jar',
        )
      : 'jar';
    validateAndroidLibraries((await run(jar, ['tf', apk])).split(/\r?\n/));
    // Only this separate, explicitly synthetic package can be replaced/removed.
    await adb('uninstall', appId).catch(() => {});
    await adb('install', apk);
    await adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
    await adb('shell', 'svc', 'wifi', 'disable');
    await adb('shell', 'svc', 'data', 'disable');
    await offline();
    const before = Number(
      await adb('shell', 'settings', 'get', 'global', 'boot_count'),
    );
    stage = 'prepared';
    const prepared = await launch('prepared');
    stage = 'full_reboot';
    await adb('reboot');
    await pause();
    await waitBoot();
    await offline();
    const after = Number(
      await adb('shell', 'settings', 'get', 'global', 'boot_count'),
    );
    if (!Number.isInteger(before) || after <= before)
      throw new Error('FULL_REBOOT_REQUIRED');
    stage = 'reopened_and_cleaned';
    const report = await launch('cleaned');
    if (
      JSON.stringify(prepared.cases) !== JSON.stringify(report.cases) ||
      !report.checks.synthetic_artifacts_removed
    )
      throw new Error('INCOMPLETE_NATIVE_REPORT');
    await adb('shell', 'am', 'force-stop', appId);
    report.android_api = Number(
      await adb('shell', 'getprop', 'ro.build.version.sdk'),
    );
    report.abi = await adb('shell', 'getprop', 'ro.product.cpu.abi');
    report.boot_count_before = before;
    report.boot_count_after = after;
    report.full_reboot_verified = true;
    report.offline_confirmed = true;
    report.runtime_libraries_packaged = true;
    report.apk_sha256 = createHash('sha256')
      .update(readFileSync(apk))
      .digest('hex');
    writeFileSync(
      path.join(artifacts, 'android.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  } else throw new Error('NATIVE_MODE_INVALID');
  if (mode === 'desktop' || mode === 'android-test') {
    const file = path.join(
      artifacts,
      mode === 'desktop' ? 'desktop.json' : 'android.json',
    );
    const report = JSON.parse(readFileSync(file, 'utf8'));
    report.scope = 'us021-sqlcipher-schema';
    report.source_sha256 = sourceHashes(
      mode === 'desktop' ? 'desktop' : 'android',
    );
    report.completed_at_utc = new Date().toISOString();
    report.pending = [
      'ios-native-runtime',
      'product-vault-policy-and-migrations',
    ];
    validateNativeEvidence(report);
    writeFileSync(
      file,
      await format(JSON.stringify(report), {
        ...(await resolveConfig(path.join(root, 'package.json'))),
        parser: 'json',
      }),
    );
  }
  console.log('US-021 native mode passed: ' + mode);
} catch (error) {
  console.error(
    'US021_NATIVE_FAILED_' +
      stage.toUpperCase() +
      '_' +
      (String(error.message).match(/^[A-Za-z_]{3,100}$/)?.[0] ?? 'COMMAND'),
  );
  process.exitCode = 1;
}
