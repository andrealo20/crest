# Builds the Microsoft Store package: crest.exe and crest-notify.exe from the `store` Cargo feature (no self-update, never
# portable, Start with Windows through the package's startup task), the logos and packaging/store/AppxManifest.xml, packed
# unsigned into dist-store/Crest-<version>-x64.msix (outside dist/, which every frontend build empties) for Partner Center, which signs it.
#   powershell -File scripts/store-package.ps1
#   powershell -File scripts/store-package.ps1 -TestSign   # also a self-signed copy to install on this PC
# Run it from PowerShell: in Git Bash /usr/bin/link shadows the MSVC linker.
param([switch]$TestSign)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$publisher = 'CN=6324E174-874E-4AF4-BEFF-97AD455C0AFD'

# Package versions have four parts and the Store wants the last one 0: 0.2.0 becomes 0.2.0.0.
function Get-StoreVersion([string]$Version) {
    if ($Version -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}$') { throw "Version '$Version' is not major.minor.patch" }
    "$Version.0"
}
if ((Get-StoreVersion '0.2.0') -ne '0.2.0.0') { throw 'Get-StoreVersion self-check failed' }

# Build tools report progress on stderr, which Windows PowerShell would take as a stopping error: only the exit code counts.
function Invoke-Tool([string]$File) {
    $ErrorActionPreference = 'Continue'
    & $File @args
    if ($LASTEXITCODE) { throw "$(Split-Path -Leaf $File) failed ($LASTEXITCODE)" }
}

$version = (Get-Content -Raw (Join-Path $root 'src-tauri\tauri.conf.json') | ConvertFrom-Json).version
$storeVersion = Get-StoreVersion $version

# The newest Windows SDK that has the packaging tools.
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
    Where-Object { $_.Name -match '^10\.[\d.]+$' -and (Test-Path (Join-Path $_.FullName 'x64\makeappx.exe')) } |
    Sort-Object { [version]$_.Name } | Select-Object -Last 1
if (-not $sdk) { throw 'makeappx.exe not found: install a Windows 10 or 11 SDK' }
$tools = Join-Path $sdk.FullName 'x64'

# Its own target folder, so the Store build never mixes with the GitHub build's files.
$target = Join-Path $root 'src-tauri\target-store'
$previousTarget = $env:CARGO_TARGET_DIR
$env:CARGO_TARGET_DIR = $target
Push-Location $root
try {
    # npx.cmd: the npx.ps1 shim rereads the caller's command line and loses splatted arguments.
    Invoke-Tool npx.cmd tauri build --no-bundle --features store
}
finally {
    Pop-Location
    $env:CARGO_TARGET_DIR = $previousTarget
}

$stage = Join-Path $target 'store-staging'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($exe in 'crest.exe', 'crest-notify.exe') { Copy-Item -LiteralPath (Join-Path $target "release\$exe") -Destination $stage }
foreach ($logo in 'Square44x44Logo', 'Square71x71Logo', 'Square150x150Logo', 'StoreLogo') {
    Copy-Item -LiteralPath (Join-Path $root "src-tauri\icons\$logo.png") -Destination $stage
}
$manifest = (Get-Content -Raw (Join-Path $root 'packaging\store\AppxManifest.xml')).Replace('{version}', $storeVersion)
[IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))

$out = Join-Path $root 'dist-store'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$msix = Join-Path $out "Crest-$version-x64.msix"
Invoke-Tool (Join-Path $tools 'makeappx.exe') pack /d $stage /p $msix /o
Get-Item -LiteralPath $msix

if ($TestSign) {
    # A self-signed code-signing certificate in the user's store, its subject equal to the package's Publisher. No admin needed.
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object { $_.Subject -eq $publisher -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature -FriendlyName 'Crest Store test signing' `
            -CertStoreLocation Cert:\CurrentUser\My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    }
    $cer = Join-Path $env:TEMP 'crest-store-test.cer'
    Export-Certificate -Cert $cert -FilePath $cer | Out-Null
    $signed = Join-Path $out "Crest-$version-x64-test.msix"
    Copy-Item -LiteralPath $msix -Destination $signed -Force
    Invoke-Tool (Join-Path $tools 'signtool.exe') sign /fd SHA256 /sha1 $cert.Thumbprint $signed
    Write-Host ''
    Write-Host 'Test copy signed. Trust its certificate once, from an elevated PowerShell:'
    Write-Host "  Import-Certificate -FilePath '$cer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
    Write-Host 'Then install it (no admin needed):'
    Write-Host "  Add-AppxPackage -Path '$signed'"
}
