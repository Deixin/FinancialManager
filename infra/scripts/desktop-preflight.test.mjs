import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  checkDesktopEnvironment,
  findWebViewVersion,
  probeNativeLink,
} from './desktop-preflight.mjs';

const success = { status: 0, stdout: '', stderr: '' };

// Synthetic tool responses; these unit tests do not validate a real SDK/runtime.
function syntheticTools({ rustHost, inventory, compile, execute } = {}) {
  return (command, args) => {
    if (command === 'rustc' && args[0] === '--version') {
      return {
        ...success,
        stdout: 'host: ' + (rustHost ?? 'x86_64-pc-windows-msvc') + '\r\n',
      };
    }
    if (command === 'powershell.exe') {
      return (
        inventory ?? {
          ...success,
          stdout: JSON.stringify({
            cppTools: true,
            webviewVersions: ['154.0.4258.62'],
          }),
        }
      );
    }
    if (command === 'rustc') return compile ?? success;
    if (command.endsWith('probe.exe')) return execute ?? success;
    if (command === 'cargo') return success;
    assert.fail('Unexpected command: ' + command);
  };
}

test('accepts a WebView2 per-user install even when the machine value is empty', () => {
  assert.equal(
    findWebViewVersion([null, '', '0.0.0.0', '154.0.4258.62']),
    '154.0.4258.62',
  );
});

test('rejects absent, malformed and zero WebView2 versions', () => {
  for (const versions of [
    undefined,
    '154.0.4258.62',
    [],
    [null, '', '0.0.0.0', '000.0.0.0', '154', '154.0.0.beta'],
  ]) {
    assert.equal(findWebViewVersion(versions), undefined);
  }
});

test('reports every Windows prerequisite and smoke result', () => {
  const checks = checkDesktopEnvironment({
    platform: 'win32',
    arch: 'x64',
    run: syntheticTools(),
  });
  assert.deepEqual(
    checks.map(({ id, ok }) => ({ id, ok })),
    ['rust', 'cargo', 'cpp', 'webview', 'native-smoke'].map((id) => ({
      id,
      ok: true,
    })),
  );
});

test('rejects a GNU Rust host and does not attempt native compilation', () => {
  const checks = checkDesktopEnvironment({
    platform: 'win32',
    arch: 'x64',
    run: syntheticTools({ rustHost: 'x86_64-pc-windows-gnu' }),
  });
  assert.equal(checks.find(({ id }) => id === 'rust').ok, false);
  assert.equal(
    checks.some(({ id }) => id === 'native-smoke'),
    false,
  );
});

test('fails closed on unreadable Windows inventory', () => {
  for (const inventory of [
    { status: 1, stdout: '' },
    { ...success, stdout: 'not JSON' },
    { ...success, stdout: 'null' },
    { ...success, stdout: '{}' },
  ]) {
    const checks = checkDesktopEnvironment({
      platform: 'win32',
      arch: 'x64',
      run: syntheticTools({ inventory }),
    });
    assert.equal(checks.find(({ id }) => id === 'cpp').ok, false);
    assert.equal(checks.find(({ id }) => id === 'webview').ok, false);
  }
});

test('does not run Windows probes on an unsupported platform or architecture', () => {
  for (const [platform, arch] of [
    ['linux', 'x64'],
    ['win32', 'arm64'],
  ]) {
    const checks = checkDesktopEnvironment({
      platform,
      arch,
      run: () => assert.fail('Must not spawn a Windows command'),
    });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].ok, false);
  }
});

test('linker failure and timeout fail the smoke without running the executable', () => {
  for (const compile of [
    { status: 1 },
    { status: null, error: { code: 'ETIMEDOUT' } },
  ]) {
    let directory;
    const result = probeNativeLink((command, args) => {
      assert.equal(command, 'rustc');
      const source = args[args.indexOf('-o') - 1];
      directory = path.dirname(source);
      assert.ok(readFileSync(source, 'utf8').includes('fn main()'));
      return compile;
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(directory), false);
  }
});

test('a compiled executable that fails to start does not pass the smoke', () => {
  const result = probeNativeLink(
    syntheticTools({ execute: { status: null, error: { code: 'ENOENT' } } }),
  );
  assert.equal(result.ok, false);
});

test('removes its temporary source even if the command runner throws', () => {
  let directory;
  assert.throws(
    () =>
      probeNativeLink((command, args) => {
        directory = path.dirname(args[args.indexOf('-o') - 1]);
        throw new Error('Synthetic runner failure');
      }),
    /Synthetic runner failure/,
  );
  assert.equal(existsSync(directory), false);
});
