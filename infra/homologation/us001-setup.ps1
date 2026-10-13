$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$vmRoot = Join-Path $repoRoot '.tools/us001-docker-vm'
$env:US001_VM_ROOT = $vmRoot.Replace('\', '/')
foreach ($name in @('storage', 'oem', 'shared', 'private')) {
  New-Item -ItemType Directory -Path (Join-Path $vmRoot $name) -Force | Out-Null
}
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$privatePath = Join-Path $vmRoot 'private'
$privateAcl = Get-Acl -LiteralPath $privatePath
if (-not $privateAcl.AreAccessRulesProtected) {
  # icacls changes only this directory's DACL, without requesting audit privileges.
  $grantRule = '*' + $ownerSid.Value + ':(OI)(CI)F'
  icacls.exe $privatePath /inheritance:r /grant:r $grantRule | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PRIVATE_ENV_ACL_FAILED' }
}
$privateAcl = Get-Acl -LiteralPath $privatePath
if (-not $privateAcl.AreAccessRulesProtected) { throw 'PRIVATE_ENV_ACL_FAILED' }
foreach ($rule in $privateAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($rule.IdentityReference.Value -notin @($ownerSid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    throw 'PRIVATE_ENV_ACL_TOO_BROAD'
  }
}

# Load the existing Microsoft WSL kernel module; no WSL shutdown or global config edit.
wsl --distribution docker-desktop --exec sh -c 'modprobe kvm_intel && test -c /dev/kvm'
if ($LASTEXITCODE -ne 0) { throw 'KVM_UNAVAILABLE' }

$envFile = Join-Path $vmRoot 'private/guest.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  $passwordBytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($passwordBytes)
    $guestPassword = [Convert]::ToBase64String($passwordBytes)
    [IO.File]::WriteAllText($envFile, "PASSWORD=$guestPassword`n", [Text.UTF8Encoding]::new($false))
  } finally {
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    $guestPassword = $null
    $random.Dispose()
  }
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'us001-guest.ps1') -Destination (Join-Path $vmRoot 'oem/us001-guest.ps1')
$batch = @'
@echo off
if not exist C:\US001 mkdir C:\US001
copy /y C:\OEM\us001-guest.ps1 C:\US001\us001-guest.ps1 >nul
C:\OEM\vc_redist.x64.exe /install /quiet /norestart
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\US001\us001-guest.ps1
'@
[IO.File]::WriteAllText((Join-Path $vmRoot 'oem/install.bat'), $batch, [Text.ASCIIEncoding]::new())

$runtime = Join-Path $vmRoot 'oem/vc_redist.x64.exe'
if (-not (Test-Path -LiteralPath $runtime)) {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $runtime
}
$signature = Get-AuthenticodeSignature -LiteralPath $runtime
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
  throw 'RUNTIME_SIGNATURE_INVALID'
}

$compose = Join-Path $PSScriptRoot 'us001-compose.yaml'
docker compose --project-name fm-us001-vm --file $compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'COMPOSE_CONFIG_INVALID' }
docker compose --project-name fm-us001-vm --file $compose up -d
if ($LASTEXITCODE -ne 0) { throw 'VM_START_FAILED' }
Write-Output 'US001_VM_STARTED_LOCALHOST_18006'
