import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockHashes } from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.platform, 'win32');
const directory = path.join(root, '.tools/us033-lock/hello-package');
for (const folder of [
  path.join(root, '.tools'),
  path.dirname(directory),
  directory,
]) {
  if (existsSync(folder))
    assert.equal(lstatSync(folder).isSymbolicLink(), false);
  else mkdirSync(folder);
}
const target = path.join(root, 'apps/desktop/spikes/us-001/target');
const env = { ...process.env, CARGO_TARGET_DIR: target };
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const build = spawnSync(
  'cargo',
  [
    'build',
    '--locked',
    '--features',
    'lock-smoke',
    '--bin',
    'hello-manual',
    '--bin',
    'lock-probe',
  ],
  {
    cwd: path.join(root, 'apps/desktop/src-tauri'),
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 900000,
  },
);
assert.equal(build.status, 0, 'HELLO_PACKAGE_BUILD_FAILED');
for (const name of ['hello-manual', 'lock-probe'])
  copyFileSync(
    path.join(target, 'debug', name + '.exe'),
    path.join(directory, name + '.exe'),
  );
copyFileSync(
  new URL('./hello-run.ps1', import.meta.url),
  path.join(directory, 'executar.ps1'),
);
writeFileSync(
  path.join(directory, 'LEIA-ME.txt'),
  `TESTE SINTÉTICO US-033 — Windows Hello
Execute: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\executar.ps1
1. Continuar sem conta; desbloqueie com o PIN SINTÉTICO do aplicativo: 721947350682.
2. Privacidade local > PIN atual para Windows Hello > Ativar Windows Hello.
3. Confirme sua identidade no diálogo do Windows. Nunca envie o PIN do Windows ao agente.
4. Na tela bloqueada, Desbloquear com Windows Hello e cancele no diálogo do Windows (Esc).
5. Confira que nomes/dados continuam ocultos. Repita e confirme no Windows para abrir a lista sintética.
6. Bloquear agora; use o PIN do aplicativo para conferir a alternativa. Feche a janela.
O executor remove apenas credenciais, cofres e perfil sintéticos criados nesta execução.
O resultado registra contagens de respostas nativas e preservação do cofre, sem PIN ou biometria.
Informe também o que observou no fluxo. Contagens nativas não comprovam sozinhas o fluxo visual.
Não altere suas opções de entrada do Windows para este teste. Windows Hello pode usar rosto, digital OU PIN do Windows.
Se encerrar o executor à força, limpe a execução com .\\executar.ps1 -CleanupOnly -RunDirectory <caminho absoluto run-... deste pacote>.
`,
);
const files = Object.fromEntries(
  ['hello-manual.exe', 'lock-probe.exe', 'executar.ps1', 'LEIA-ME.txt'].map(
    (name) => [
      name,
      createHash('sha256')
        .update(readFileSync(path.join(directory, name)))
        .digest('hex'),
    ],
  ),
);
writeFileSync(
  path.join(directory, 'manifest.json'),
  JSON.stringify(
    {
      format_version: 1,
      scope: 'us033-hello-human-package',
      synthetic_only: true,
      files,
      source_sha256: lockHashes(),
      prepared_at_utc: new Date().toISOString(),
      interactive_validation: 'PENDING',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Windows Hello: pacote sintético preparado; autenticação humana pendente.',
);
