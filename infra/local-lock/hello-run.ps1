param([switch]$CleanupOnly, [string]$RunDirectory)
$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ($CleanupOnly) {
    $runRoot = [IO.Path]::GetFullPath($RunDirectory)
} else {
    $runRoot = Join-Path $packageRoot ('run-' + [guid]::NewGuid().ToString('N'))
}
if ([IO.Path]::GetDirectoryName($runRoot) -ne $packageRoot -or [IO.Path]::GetFileName($runRoot) -notmatch '^run-[a-f0-9]{32}$') { throw 'Diretorio de teste invalido.' }
if ((Test-Path -LiteralPath $runRoot) -and ((Get-Item -LiteralPath $runRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Diretorio de teste invalido.' }
$storeRoot = Join-Path $runRoot 'store'
$probeExe = Join-Path $packageRoot 'lock-probe.exe'
function Invoke-Probe([string]$Mode) {
    & $probeExe $Mode $storeRoot (Join-Path $runRoot 'probe.json')
    if ($LASTEXITCODE -ne 0) { throw ('Falha no protocolo: ' + $Mode) }
}
try {
    if (-not $CleanupOnly) {
        New-Item -ItemType Directory -Path $runRoot | Out-Null
        [IO.File]::WriteAllText((Join-Path $runRoot '.hello-run'), "SYNTHETIC_HELLO_RUN`n")
        Invoke-Probe 'prepare'
        Invoke-Probe 'enable'
        Write-Host 'Siga LEIA-ME.txt. PIN sintetico do aplicativo: 721947350682.'
        Write-Host 'A confirmacao do Windows e feita por voce no dialogo do sistema.'
        & (Join-Path $packageRoot 'hello-manual.exe') $storeRoot (Join-Path $runRoot 'webview-profile')
        if ($LASTEXITCODE -ne 0) { throw 'Falha no teste interativo.' }
        Copy-Item -LiteralPath (Join-Path $storeRoot 'hello-result.json') -Destination (Join-Path $packageRoot ('resultado-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json'))
    }
} finally {
    if (Test-Path -LiteralPath $runRoot) {
        if ([IO.File]::ReadAllText((Join-Path $runRoot '.hello-run')) -cne "SYNTHETIC_HELLO_RUN`n") { throw 'Execucao sintetica nao reconhecida.' }
    }
    if (Test-Path -LiteralPath $storeRoot) {
        if ((Get-Item -LiteralPath $storeRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Diretorio de teste invalido.' }
        if ([IO.File]::ReadAllText((Join-Path $storeRoot '.us033-fixture')) -cne "SYNTHETIC_US033_ONLY`n") { throw 'Fixture sintetica nao reconhecida.' }
        Invoke-Probe 'cleanup'
    }
    # Both absolute targets were checked against this package, including its owned marker.
    for ($helloCleanupAttempt = 0; (Test-Path -LiteralPath $runRoot) -and $helloCleanupAttempt -lt 20; $helloCleanupAttempt++) {
        try { Remove-Item -LiteralPath $runRoot -Recurse -Force }
        catch {
            if ($helloCleanupAttempt -eq 19) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
    Write-Host 'Credenciais e arquivos sinteticos removidos.'
}
