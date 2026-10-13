# US-001 — Homologação em outro perfil ou máquina

Este roteiro usa somente a fixture sintética do spike. Os executáveis são instrumentos locais de teste, em build debug, sem assinatura, instalador ou updater. Não usar dados pessoais. O pacote não contém banco, backup, senha ou chave. SQLCipher/OpenSSL e o frontend são incorporados; o destino precisa de Windows 11 x64, runtime Microsoft Visual C++ e WebView2. Não exige Node, Rust, login cloud ou acesso à rede durante o experimento.

Na máquina de desenvolvimento, gere o kit com `pnpm spike:desktop:package`. Ele fica em uma pasta nova `.tools/us-001-handoff-*`, ignorada pelo Git. Copie essa pasta para o ambiente de teste. Confira os executáveis com `Get-FileHash -Algorithm SHA256` e compare com SHA256SUMS.txt antes da transferência. Os hashes detectam alteração na cópia; não substituem assinatura de distribuição.

Alternativa automatizada autorizada: uma instalação Windows 11 completa hospedada por QEMU/KVM no Docker, conforme [ADR-0018](../../architecture/adr/0018-homologacao-desktop-vm-docker.md) e [comandos de homologação](../../../infra/homologation/README.md). Um contêiner convencional não substitui a VM nem a sessão interativa. O relatório host → guest é independente do smoke interno do Tauri.

## Origem: criar e exportar

Abra PowerShell na pasta do kit. Escolha uma pasta nova e exclusiva para o experimento:

```powershell
$cli = Join-Path (Get-Location) 'vault-spike.exe'
$source = Join-Path $env:LOCALAPPDATA ('FinancialManager-US001-source-' + [guid]::NewGuid())
$package = Join-Path (Get-Location) 'synthetic.fmbackup'
$created = & $cli --root $source create | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'CREATE_FAILED' }
$original = $created.workspace_id
& $cli --root $source verify $original
& $cli --root $source backup $original $package
if ($LASTEXITCODE -ne 0) { throw 'BACKUP_FAILED' }
& $cli --root $source remove-synthetic $original
if ($LASTEXITCODE -ne 0) { throw 'CLEANUP_FAILED' }
& $cli --root $source list
```

O CLI pede a senha sem eco (12–1024 bytes UTF-8). Guarde-a para informar no destino; não a coloque em argumento, variável de ambiente, histórico ou relatório. O comando remove-synthetic valida a fixture antes de remover seu cofre e a entrada correspondente do Credential Manager. O último list deve retornar workspaces vazio. Feche o PowerShell da origem.

Transfira somente o kit e synthetic.fmbackup para **outro perfil Windows ou outra máquina**, sem copiar a pasta source, .installation-id ou credenciais do Windows. Leve a senha separadamente. Registre o UUID original apenas para comparar o novo ID; não é uma chave.

## Destino: prévia, falha e restauração

Abra uma sessão no outro perfil/máquina e PowerShell na pasta copiada:

```powershell
$cli = Join-Path (Get-Location) 'vault-spike.exe'
$target = Join-Path $env:LOCALAPPDATA ('FinancialManager-US001-target-' + [guid]::NewGuid())
$package = Join-Path (Get-Location) 'synthetic.fmbackup'
$existing = (& $cli --root $target create | ConvertFrom-Json).workspace_id
if ($LASTEXITCODE -ne 0) { throw 'CREATE_FAILED' }
$existingPath = Join-Path $target ('workspaces/' + $existing + '/vault.db')
$before = (Get-FileHash -LiteralPath $existingPath -Algorithm SHA256).Hash
& $cli --root $target preview $package
```

Primeiro informe uma senha incorreta: espere BACKUP_AUTHENTICATION_FAILED e código 1. Repita preview com a senha correta: espere 1 conta, 3 movimentos, 2 itens, 1 regra e 1 evento de histórico. A prévia não deve criar workspace. Depois:

```powershell
& $cli --root $target list
$restored = (& $cli --root $target restore $package --confirm | ConvertFrom-Json).workspace_id
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_FAILED' }
& $cli --root $target verify $restored
& $cli --root $target verify $existing
if ((Get-FileHash -LiteralPath $existingPath -Algorithm SHA256).Hash -ne $before) {
  throw 'EXISTING_VAULT_CHANGED'
}
& $cli --root $target list
```

Espere synthetic_fixture_verified true para ambos. O ID restaurado deve diferir do original e do existente. list deve conter exatamente os dois IDs. Feche o processo e execute verify novamente em um PowerShell novo, usando o mesmo target e restored: isso recupera a nova chave do Credential Manager do destino. O campo another_windows_profile_verified do smoke automático continua false; a evidência externa deve ser registrada separadamente.

Para exercitar a WebView do destino, execute vault-spike-ui.exe e clique em Executar demonstração. Isso roda um novo experimento temporário dentro desse perfil, sem usar a senha digitada no CLI.

## Evidência e limpeza

Registre data, Windows/build, versões dos executáveis, SHA256 do kit, se o destino foi outro perfil ou outra máquina, resultados da senha incorreta/prévia/restore/reabertura, IDs diferentes e preservação do cofre existente. Não registre nome de usuário, SID, senha, chave, valores ou descrições. A CI e dois diretórios no mesmo perfil não substituem essa homologação.

Após registrar o resultado, remova somente as fixtures criadas neste roteiro:

```powershell
& $cli --root $target remove-synthetic $restored
& $cli --root $target remove-synthetic $existing
& $cli --root $target list
```

Verifique o list vazio antes de descartar as pastas exclusivas do experimento e o backup sintético. Os comandos não removem credenciais de outros workspaces.
