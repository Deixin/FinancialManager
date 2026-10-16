$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskRoot = Join-Path $workspace '.tools/us002-android'
$taskSdk = Join-Path $taskRoot 'sdk'
$image = Join-Path $taskSdk 'system-images/android-36/default/x86_64'
$avdRoot = Join-Path $taskRoot 'avd'
$avd = Join-Path $avdRoot 'us002.avd'
$hostSdk = $env:ANDROID_HOME
if (-not $hostSdk) { $hostSdk = $env:ANDROID_SDK_ROOT }
if (-not $hostSdk) { throw 'ANDROID_HOME is required.' }
New-Item -ItemType Directory -Force -Path $taskSdk,$avdRoot | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $taskSdk 'platform-tools/adb.exe'))) {
  Copy-Item -LiteralPath (Join-Path $hostSdk 'platform-tools') -Destination $taskSdk -Recurse
}

if (-not (Test-Path -LiteralPath (Join-Path $image 'system.img'))) {
  # Reuse only licenses already accepted by the SDK owner. New terms remain interactive.
  if (Test-Path -LiteralPath (Join-Path $hostSdk 'licenses')) {
    Copy-Item -LiteralPath (Join-Path $hostSdk 'licenses') -Destination $taskSdk -Recurse -Force
  }
  & (Join-Path $hostSdk 'cmdline-tools/latest/bin/sdkmanager.bat') "--sdk_root=$taskSdk" --install 'system-images;android-36;default;x86_64' 'emulator'
  if ($LASTEXITCODE -ne 0) { throw 'Android image installation failed.' }
}

# Keep the host SDK untouched: use a private CMake copy with a long-path-capable Ninja.
$privateCmake = Join-Path $taskRoot 'cmake-3.22.1'
if (-not (Test-Path -LiteralPath (Join-Path $privateCmake 'bin/cmake.exe'))) {
  $sourceCmake = Join-Path $hostSdk 'cmake/3.22.1'
  if (-not (Test-Path -LiteralPath $sourceCmake)) {
    & (Join-Path $hostSdk 'cmdline-tools/latest/bin/sdkmanager.bat') "--sdk_root=$taskSdk" --install 'cmake;3.22.1'
    if ($LASTEXITCODE -ne 0) { throw 'CMake installation failed.' }
    $sourceCmake = Join-Path $taskSdk 'cmake/3.22.1'
  }
  Copy-Item -LiteralPath $sourceCmake -Destination $privateCmake -Recurse
}
$ninja = Join-Path $privateCmake 'bin/ninja.exe'
if ((& $ninja --version) -ne '1.13.2') {
  $ninjaZip = Join-Path $taskRoot 'ninja-1.13.2.zip'
  curl.exe --fail --silent --show-error --location --output $ninjaZip 'https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip'
  if ($LASTEXITCODE -ne 0) { throw 'Ninja download failed.' }
  $zipStream = [IO.File]::OpenRead($ninjaZip)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $zipHash = [BitConverter]::ToString($sha.ComputeHash($zipStream)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose(); $zipStream.Dispose() }
  if ($zipHash -ne '07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65') { throw 'Ninja checksum mismatch.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ninjaZip)
  try {
    $ninjaInput = $archive.GetEntry('ninja.exe').Open()
    $ninjaOutput = [IO.File]::Create($ninja)
    try { $ninjaInput.CopyTo($ninjaOutput) } finally { $ninjaInput.Dispose(); $ninjaOutput.Dispose() }
  } finally { $archive.Dispose() }
}

if (-not (Test-Path -LiteralPath $avd)) {
  New-Item -ItemType Directory -Path $avd | Out-Null
  @"
avd.ini.encoding=UTF-8
AvdId=us002
avd.ini.displayname=US-002 Synthetic Android 36
abi.type=x86_64
tag.id=default
tag.display=Default Android System Image
image.sysdir.1=$image
hw.cpu.arch=x86_64
hw.cpu.ncore=2
hw.ramSize=2048
hw.lcd.width=720
hw.lcd.height=1280
hw.lcd.density=320
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader
hw.keyboard=yes
hw.mainKeys=no
disk.dataPartition.size=4G
showDeviceFrame=no
fastboot.forceColdBoot=yes
"@ | Set-Content -LiteralPath (Join-Path $avd 'config.ini') -Encoding utf8
  @"
avd.ini.encoding=UTF-8
path=$avd
target=android-36
"@ | Set-Content -LiteralPath (Join-Path $avdRoot 'us002.ini') -Encoding utf8
}

$env:ANDROID_AVD_HOME = $avdRoot
$env:ANDROID_HOME = $taskSdk
$env:ANDROID_SDK_ROOT = $taskSdk
$emulator = Join-Path $taskSdk 'emulator/emulator.exe'
if (-not (Test-Path -LiteralPath $emulator)) { $emulator = Join-Path $hostSdk 'emulator/emulator.exe' }
$adb = Join-Path $hostSdk 'platform-tools/adb.exe'
$devices = & $adb devices
if ($devices -match '^emulator-5562\s') {
  $currentAvd = & $adb -s emulator-5562 emu avd name 2>$null
  if ($currentAvd -notcontains 'us002') { throw 'Port 5562 belongs to another emulator. It was left untouched.' }
  Write-Output 'US-002 dedicated emulator is already running.'
  exit 0
}
Start-Process -FilePath $emulator -ArgumentList @('-avd','us002','-port','5562','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-gpu','swiftshader','-memory','2048') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'emulator.stdout.log') -RedirectStandardError (Join-Path $taskRoot 'emulator.stderr.log') | Out-Null
Write-Output 'US-002 dedicated emulator starting at emulator-5562. Its disks remain under .tools/us002-android.'
