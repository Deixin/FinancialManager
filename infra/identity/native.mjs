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
import { format, resolveConfig } from 'prettier';
import { validateAndroidLibraries } from '../scripts/mobile-evidence.mjs';
import { sourceHashes, validateIdentityEvidence } from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  mobile = path.join(root, 'apps/mobile'),
  directory = path.join(root, '.tools/us023-identity');
mkdirSync(directory, { recursive: true });
const env = {
  ...process.env,
  EXPO_NO_TELEMETRY: '1',
  CI: '1',
  NODE_ENV: 'production',
  GRADLE_USER_HOME: path.join(root, '.tools/us002-android/gradle'),
};
const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT,
  serial = 'emulator-5562',
  appId = 'com.miudos.financialmanager.us023';
const adbPath = sdk
  ? path.join(
      sdk,
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    )
  : 'adb';
const run = (
  command,
  args,
  { cwd = root, timeout = 180000, inherit = false } = {},
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (data) => {
      output += data;
      if (output.length > 4000000) child.kill();
    });
    child.stderr?.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('IDENTITY_NATIVE_TIMEOUT'));
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('IDENTITY_NATIVE_COMMAND_FAILED'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error('IDENTITY_NATIVE_COMMAND_FAILED'));
    });
  });
const adb = (...args) => run(adbPath, ['-s', serial, ...args]);
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));
async function launch(phase) {
  await adb('shell', 'am', 'force-stop', appId);
  const component = (
    await adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', appId)
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .at(-1);
  if (!component?.startsWith(appId + '/'))
    throw new Error('IDENTITY_ACTIVITY_REQUIRED');
  await adb('shell', 'am', 'start', '-n', component);
  for (let attempt = 0; attempt < 100; attempt++) {
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
        const marker = line.indexOf('US023_REPORT ');
        if (marker < 0) continue;
        const report = JSON.parse(line.slice(marker + 13));
        if (report.passed !== true)
          throw new Error(
            'IDENTITY_ANDROID_' +
              String(report.failure_stage)
                .replace(/[^a-z_]/g, '')
                .toUpperCase() +
              '_' +
              String(report.failure_code ?? 'FAILED').replace(/[^A-Z_]/g, ''),
          );
        if (report.phase === phase) return report;
      }
    }
    await pause();
  }
  throw new Error('IDENTITY_REPORT_TIMEOUT');
}
let stage = 'configuration';
try {
  const mode = process.argv[2];
  if (mode === 'windows') {
    env.US023_DESKTOP_REPORT = path.join(directory, 'windows.json');
    const perl = path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin');
    if (existsSync(path.join(perl, 'perl.exe'))) {
      const key =
        Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
      env[key] = perl + path.delimiter + (env[key] ?? '');
    }
    stage = 'rust';
    await run(
      'cargo',
      [
        'test',
        '--manifest-path',
        'apps/desktop/spikes/us-001/Cargo.toml',
        '--locked',
        '--test',
        'us023_identity',
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
      '-PfmIdentityProbe=us023',
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
      path.join(directory, 'android.apk'),
    );
  } else if (mode === 'android-test') {
    stage = 'isolated_emulator';
    if (
      (await adb('shell', 'getprop', 'ro.kernel.qemu')) !== '1' ||
      !(await adb('emu', 'avd', 'name'))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .includes('us002')
    )
      throw new Error('DEDICATED_AVD_REQUIRED');
    const apk = path.join(directory, 'android.apk'),
      jar = env.JAVA_HOME
        ? path.join(
            env.JAVA_HOME,
            'bin',
            process.platform === 'win32' ? 'jar.exe' : 'jar',
          )
        : 'jar';
    validateAndroidLibraries((await run(jar, ['tf', apk])).split(/\r?\n/));
    await adb('uninstall', appId).catch(() => {});
    await adb('install', apk);
    await adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
    await adb('shell', 'svc', 'wifi', 'disable');
    await adb('shell', 'svc', 'data', 'disable');
    const offline = [];
    for (const key of ['airplane_mode_on', 'wifi_on', 'mobile_data'])
      offline.push(await adb('shell', 'settings', 'get', 'global', key));
    if (offline.join('|') !== '1|0|0') throw new Error('OFFLINE_REQUIRED');
    stage = 'prepare';
    await launch('prepared');
    const beforePid = await adb('shell', 'pidof', appId);
    stage = 'reopen';
    const report = await launch('cleaned');
    const afterPid = await adb('shell', 'pidof', appId);
    if (!beforePid || !afterPid || beforePid === afterPid)
      throw new Error('IDENTITY_PROCESS_RESTART_REQUIRED');
    report.android_api = Number(
      await adb('shell', 'getprop', 'ro.build.version.sdk'),
    );
    report.abi = await adb('shell', 'getprop', 'ro.product.cpu.abi');
    report.process_restart_verified = true;
    report.offline_confirmed = true;
    report.runtime_libraries_packaged = true;
    report.apk_sha256 = createHash('sha256')
      .update(readFileSync(apk))
      .digest('hex');
    writeFileSync(path.join(directory, 'android.json'), JSON.stringify(report));
    await adb('shell', 'am', 'force-stop', appId);
    await adb('uninstall', appId);
  } else throw new Error('IDENTITY_NATIVE_MODE_INVALID');
  if (mode !== 'android-build') {
    const file = path.join(
        directory,
        mode === 'windows' ? 'windows.json' : 'android.json',
      ),
      report = JSON.parse(readFileSync(file, 'utf8'));
    report.scope = 'us023-native-identity-time';
    report.source_sha256 = sourceHashes(
      mode === 'windows' ? 'windows' : 'android',
    );
    report.completed_at_utc = new Date().toISOString();
    report.pending = [
      'ios-runtime',
      'product-command-and-repository-integration',
    ];
    validateIdentityEvidence(
      report,
      mode === 'windows' ? 'windows' : 'android',
    );
    writeFileSync(
      file,
      await format(JSON.stringify(report), {
        ...(await resolveConfig(path.join(root, 'package.json'))),
        parser: 'json',
      }),
    );
    console.log('US-023 native identity/time verified: ' + mode);
  }
} catch (error) {
  console.error(
    'US023_NATIVE_FAILED_' +
      stage.toUpperCase() +
      '_' +
      (/^IDENTITY_[A-Z0-9_]+$/.test(error?.message ?? '')
        ? error.message
        : 'COMMAND_FAILED'),
  );
  process.exitCode = 1;
}
