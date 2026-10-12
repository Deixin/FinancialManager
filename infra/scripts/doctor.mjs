import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
const expectedPnpm = manifest.packageManager.split('@')[1];
const [major, minor] = process.versions.node.split('.').map(Number);
let failed = false;

if (major !== 24 || minor < 19) {
  console.error('Required: Node >=24.19.0 <25; found ' + process.versions.node);
  failed = true;
} else {
  console.log('Node OK: ' + process.versions.node);
}

const actualPnpm =
  process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/)?.[1];
if (actualPnpm !== expectedPnpm) {
  console.error('Run with pnpm ' + expectedPnpm + ': pnpm env:check');
  failed = true;
} else {
  console.log('pnpm OK: ' + actualPnpm);
}

if (process.argv.includes('--full')) {
  for (const command of ['git', 'rustc', 'cargo', 'docker']) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      console.log(
        command +
          ': unavailable; required only for its corresponding workflow.',
      );
    } else {
      console.log(result.stdout.trim().split(/\r?\n/)[0]);
    }
  }
  console.log(
    'Native SDKs, signing, databases and framework integrations are not validated here.',
  );
}

if (failed) process.exitCode = 1;
