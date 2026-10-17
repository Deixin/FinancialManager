import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us027-invariants');
const environment = {
  ...process.env,
  US027_ARTIFACTS: directory.replaceAll('\\', '/'),
};
for (const key of Object.keys(environment))
  if (/^(DOCKER_|COMPOSE_)/.test(key)) delete environment[key];
const run = (args) => {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: environment,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0) throw new Error('DUAL_CLEANUP_FAILED');
  return result.stdout.trim();
};
try {
  for (const folder of [path.join(root, '.tools'), directory]) {
    if (existsSync(folder)) {
      if (lstatSync(folder).isSymbolicLink())
        throw new Error('MANAGED_PATH_REQUIRED');
    } else mkdirSync(folder);
  }
  if (existsSync(path.join(directory, '.lock')))
    throw new Error('ACTIVE_RUN_LEFT_UNTOUCHED');
  writeFileSync(path.join(directory, 'empty.env'), '');
  const context = JSON.parse(run(['context', 'inspect']));
  if (
    context.length !== 1 ||
    !/^(npipe:|unix:)/.test(context[0].Endpoints.docker.Host)
  )
    throw new Error('LOCAL_DOCKER_REQUIRED');
  const args = [
    'compose',
    '-p',
    'financial-manager-us027',
    '-f',
    path.join(root, 'infra/invariants/compose.yaml'),
    '--env-file',
    path.join(directory, 'empty.env'),
  ];
  const ids = run([...args, 'ps', '-a', '-q'])
    .split(/\s+/)
    .filter(Boolean);
  for (const container of ids) {
    const [item] = JSON.parse(run(['inspect', container]));
    if (
      item.Config.Labels['io.financial-manager.us027-synthetic'] !== 'true' ||
      item.Config.Labels['com.docker.compose.project'] !==
        'financial-manager-us027' ||
      item.Config.Image !==
        'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'
    )
      throw new Error('OWNER_MISMATCH');
  }
  run([...args, 'down', '--volumes']);
  rmSync(path.join(directory, 'bootstrap-password'), { force: true });
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    rmSync(path.join(directory, 'synthetic.sqlite' + suffix), { force: true });
  console.log('US-027 owned revision resources removed.');
} catch {
  console.error('US027_REVISIONS_CLEANUP_REJECTED');
  process.exitCode = 1;
}
