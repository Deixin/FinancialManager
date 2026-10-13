# Test harness only. All data and credentials belong to the isolated synthetic VM.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$localRoot = 'C:\US001'
$shared = '\\host.lan\Data'
$statePath = Join-Path $localRoot 'reboot-state.json'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\us001.cmd'
$encoding = [Text.UTF8Encoding]::new($false)
$password = $null
$rsa = $null

function Write-Json($name, $value) {
  $temporary = Join-Path $shared ($name + '.tmp')
  [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Depth 8), $encoding)
  Move-Item -LiteralPath $temporary -Destination (Join-Path $shared $name) -Force
}

function Invoke-Cli([string[]]$cliArgs, [string]$secret = '', [int]$expected = 0) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = Join-Path $localRoot 'vault-spike.exe'
  $quoted = foreach ($argument in $cliArgs) {
    if ($argument.Contains('"')) { throw 'INVALID_HARNESS_ARGUMENT' }
    '"' + $argument + '"'
  }
  $info.Arguments = $quoted -join ' '
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($info)
  try {
    if ($secret.Length -gt 0) { $process.StandardInput.Write($secret) }
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEndAsync()
    $errorOutput = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(90000)) {
      $process.Kill()
      throw 'CLI_TIMEOUT'
    }
    if ($process.ExitCode -ne $expected) { throw 'CLI_UNEXPECTED_EXIT' }
    if ($expected -eq 0) { return ($output.Result | ConvertFrom-Json) }
    return @{ error_code = $errorOutput.Result.Trim() }
  } finally { $process.Dispose() }
}

function Hash-File([string]$path) {
  (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Preserved($state) {
  $existingPath = Join-Path $state.target ('workspaces\' + $state.existing + '\vault.db')
  if ((Hash-File $existingPath) -ne $state.existing_hash) { throw 'EXISTING_VAULT_CHANGED' }
  if (-not (Invoke-Cli @('--root', $state.target, 'verify', $state.existing)).synthetic_fixture_verified) {
    throw 'EXISTING_FIXTURE_INVALID'
  }
}

try {
  New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
  $deadline = [DateTime]::UtcNow.AddMinutes(5)
  while (-not (Test-Path -LiteralPath $shared)) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'SHARED_FOLDER_UNAVAILABLE' }
    Start-Sleep -Seconds 2
  }

  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    Assert-Preserved $state
    if (-not (Invoke-Cli @('--root', $state.target, 'verify', $state.restored)).synthetic_fixture_verified) {
      throw 'RESTORED_KEY_DID_NOT_SURVIVE_REBOOT'
    }
    $smokePath = Join-Path $localRoot 'tauri-smoke.json'
    $smoke = Start-Process -FilePath (Join-Path $localRoot 'vault-spike-ui.exe') -ArgumentList @('--smoke-report', $smokePath) -PassThru -WindowStyle Hidden
    $null = $smoke.Handle
    if (-not $smoke.WaitForExit(120000)) { $smoke.Kill(); throw 'WEBVIEW_TIMEOUT' }
    if ($smoke.ExitCode -ne 0) { throw 'WEBVIEW_FAILED' }
    $webview = Get-Content -LiteralPath $smokePath -Raw | ConvertFrom-Json
    if (-not $webview.passed -or -not $webview.exact_synthetic_data) { throw 'WEBVIEW_REPORT_INVALID' }
    $state.report | Add-Member -NotePropertyName reboot_key_recovery -NotePropertyValue $true
    $state.report | Add-Member -NotePropertyName webview_ipc -NotePropertyValue $true
    $state.report | Add-Member -NotePropertyName cipher_version -NotePropertyValue $webview.cipher_version
    $state.report | Add-Member -NotePropertyName passed -NotePropertyValue $true
    Invoke-Cli @('--root', $state.target, 'remove-synthetic', $state.restored) | Out-Null
    Invoke-Cli @('--root', $state.target, 'remove-synthetic', $state.existing) | Out-Null
    if (@((Invoke-Cli @('--root', $state.target, 'list')).workspaces).Count -ne 0) { throw 'CLEANUP_FAILED' }
    Remove-Item -LiteralPath $startup -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $statePath
    Write-Json 'result.json' $state.report
    exit 0
  }

  foreach ($name in @('vault-spike.exe', 'vault-spike-ui.exe')) {
    Copy-Item -LiteralPath (Join-Path $shared $name) -Destination (Join-Path $localRoot $name)
  }
  $rsa = [Security.Cryptography.RSACng]::new(3072)
  $parameters = $rsa.ExportParameters($false)
  $ready = @{
    version = 1
    modulus = [Convert]::ToBase64String($parameters.Modulus)
    exponent = [Convert]::ToBase64String($parameters.Exponent)
    interactive_session = [Environment]::UserInteractive
  }
  if (-not $ready.interactive_session) { throw 'INTERACTIVE_LOGON_REQUIRED' }
  Write-Json 'ready.json' $ready
  $deadline = [DateTime]::UtcNow.AddMinutes(30)
  while (-not (Test-Path -LiteralPath (Join-Path $shared 'request.json'))) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'REQUEST_TIMEOUT' }
    Start-Sleep -Seconds 2
  }
  $request = Get-Content -LiteralPath (Join-Path $shared 'request.json') -Raw | ConvertFrom-Json
  if ($request.version -ne 1) { throw 'REQUEST_VERSION_INVALID' }
  foreach ($name in @('vault-spike.exe', 'vault-spike-ui.exe')) {
    if ((Hash-File (Join-Path $localRoot $name)) -ne $request.hashes.$name) { throw 'BINARY_HASH_MISMATCH' }
  }
  $secretBytes = $rsa.Decrypt([Convert]::FromBase64String($request.wrapped_password), [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
  try { $password = [Text.Encoding]::UTF8.GetString($secretBytes) }
  finally { [Array]::Clear($secretBytes, 0, $secretBytes.Length) }
  $rsa.Dispose()
  $rsa = $null
  Remove-Item -LiteralPath (Join-Path $shared 'request.json')
  $machine = (Get-CimInstance Win32_ComputerSystemProduct).UUID.Trim().ToUpperInvariant()
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $machineHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($machine)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $machine = $null }
  if ($machineHash -eq $request.host_machine_hash) { throw 'DISTINCT_MACHINE_REQUIRED' }
  $package = Join-Path $localRoot 'synthetic.fmbackup'
  Copy-Item -LiteralPath (Join-Path $shared 'synthetic.fmbackup') -Destination $package
  if ((Hash-File $package) -ne $request.package_hash) { throw 'PACKAGE_HASH_MISMATCH' }
  $target = Join-Path $localRoot 'installation-b'
  $existing = (Invoke-Cli @('--root', $target, 'create')).workspace_id
  $state = @{
    target = $target
    existing = $existing
    existing_hash = Hash-File (Join-Path $target ('workspaces\' + $existing + '\vault.db'))
  }
  $wrong = Invoke-Cli @('--root', $target, 'restore', $package, '--confirm') 'SYNTHETIC INCORRECT RECOVERY SECRET' 1
  if ($wrong.error_code -ne 'BACKUP_AUTHENTICATION_FAILED') { throw 'WRONG_PASSWORD_NOT_REJECTED' }
  $bytes = [IO.File]::ReadAllBytes($package)
  $tampered = Join-Path $localRoot 'tampered.fmbackup'
  $bytes[$bytes.Length - 1] = $bytes[$bytes.Length - 1] -bxor 1
  [IO.File]::WriteAllBytes($tampered, $bytes)
  $bad = Invoke-Cli @('--root', $target, 'restore', $tampered, '--confirm') $password 1
  if ($bad.error_code -ne 'BACKUP_AUTHENTICATION_FAILED') { throw 'TAMPER_NOT_REJECTED' }
  Remove-Item -LiteralPath $tampered
  Assert-Preserved $state
  foreach ($stop in @('staged', 'key-stored')) {
    Invoke-Cli @('--root', $target, 'restore-crash', $package, $stop) $password 86 | Out-Null
    if (@(Get-ChildItem -LiteralPath (Join-Path $target 'staging')).Count -ne 1) { throw 'FAULT_NOT_INJECTED' }
    Invoke-Cli @('--root', $target, 'list') | Out-Null
    if (@(Get-ChildItem -LiteralPath (Join-Path $target 'staging')).Count -ne 0) { throw 'STAGING_NOT_RECOVERED' }
    Assert-Preserved $state
  }
  $preview = Invoke-Cli @('--root', $target, 'preview', $package) $password
  if ($preview.accounts -ne 1 -or $preview.movements -ne 3 -or $preview.items -ne 2 -or $preview.rules -ne 1 -or $preview.history -ne 1) { throw 'PREVIEW_COUNTS_INVALID' }
  if (@((Invoke-Cli @('--root', $target, 'list')).workspaces).Count -ne 1) { throw 'PREVIEW_PUBLISHED_DATA' }
  $restored = (Invoke-Cli @('--root', $target, 'restore', $package, '--confirm') $password).workspace_id
  $password = $null
  if ($restored -eq $request.original_workspace -or $restored -eq $existing) { throw 'RESTORE_REUSED_WORKSPACE' }
  if (-not (Invoke-Cli @('--root', $target, 'verify', $restored)).synthetic_fixture_verified) { throw 'RESTORED_FIXTURE_INVALID' }
  Assert-Preserved $state
  $state.restored = $restored
  $state.report = @{
    different_windows_installation = $true
    interactive_session = $true
    original_key_removed_before_transfer = $request.original_key_removed
    binary_hashes_verified = $true
    backup_hash_verified = $true
    wrong_password_rejected = $true
    tampering_rejected = $true
    crash_recovery_both_checkpoints = $true
    preview_without_publication = $true
    new_workspace = $true
    exact_synthetic_data = $true
    existing_vault_preserved = $true
    windows_build = [Environment]::OSVersion.Version.ToString()
  }
  [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 8), $encoding)
  $startupCommand = '@echo off' + "`r`n" + 'start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\US001\us001-guest.ps1' + "`r`n"
  [IO.File]::WriteAllText($startup, $startupCommand, [Text.ASCIIEncoding]::new())
  Write-Json 'needs-reboot.json' @{ ready = $true }
} catch {
  $safeError = [string]$_.Exception.Message
  if ($safeError -notmatch '^[A-Z_]+$') { $safeError = 'GUEST_HARNESS_FAILED' }
  try { Write-Json 'result.json' @{ passed = $false; error_code = $safeError; failure_line = $_.InvocationInfo.ScriptLineNumber } } catch { }
  exit 1
} finally {
  $password = $null
  if ($null -ne $rsa) { $rsa.Dispose() }
}
