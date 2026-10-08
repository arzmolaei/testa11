# Windows 10/11, PowerShell 5.1+, x64/ARM64. No administrator access needed.
[CmdletBinding()]
param(
    [ValidatePattern('^(main|[0-9a-f]{40})$')]
    [string]$SourceRef = 'main',
    [switch]$DryRun,
    [switch]$VerifyOnly,
    [switch]$FromLocalSource
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$installMutex = $null
$mutexTaken = $false

function Get-VerifiedDownload {
    param([string]$Url, [string]$Destination)
    $part = $Destination + '.part'
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $part -TimeoutSec 120
            Move-Item -LiteralPath $part -Destination $Destination -Force
            return
        } catch {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            if ($attempt -eq 3) { throw }
            Write-Host 'Download interrupted. Retrying...' -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    }
}

function Expand-SafeArchive {
    param([string]$Archive, [string]$Destination)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $entryName = $entry.FullName.Replace('\', '/')
            if ([IO.Path]::IsPathRooted($entryName) -or $entryName -match '(^|/)\.\.(/|$)' -or $entryName.Contains(':')) {
                throw 'The downloaded ZIP contains an unsafe path. Extraction stopped.'
            }
        }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination
}

function Get-NodeExecutable {
    param([string]$InstallRoot)
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'This installer requires 64-bit Windows 10 or 11.'
    }
    $existing = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($existing) {
        $version = & $existing.Source -p 'process.versions.node' 2>$null
        $architecture = & $existing.Source -p 'process.arch' 2>$null
        if ($LASTEXITCODE -eq 0 -and "$version" -match '^\d+\.\d+\.\d+$' -and [Version]$version -ge [Version]'22.13.0' -and $architecture -in @('x64', 'arm64')) {
            return $existing.Source
        }
    }
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
    Write-Host 'Installing a private copy of Node.js 22 LTS (no administrator access)...' -ForegroundColor Cyan
    $indexFile = Join-Path $InstallRoot 'node-index.json'
    Get-VerifiedDownload 'https://nodejs.org/dist/index.json' $indexFile
    $index = Get-Content -LiteralPath $indexFile -Raw | ConvertFrom-Json
    $release = $index | Where-Object { $_.version -match '^v22\.\d+\.\d+$' -and $_.lts -and $_.files -contains "win-$architecture-zip" } | Select-Object -First 1
    if (-not $release) { throw 'The official Node.js index has no compatible Node.js 22 release.' }
    $versionTag = [string]$release.version
    $archiveName = "node-$versionTag-win-$architecture.zip"
    $runtimeDir = Join-Path $InstallRoot "node-$versionTag-win-$architecture"
    $runtimeExe = Join-Path $runtimeDir 'node.exe'
    if (Test-Path -LiteralPath $runtimeExe) {
        & $runtimeExe -e 'if(parseInt(process.versions.node)<22)process.exit(1)'
        if ($LASTEXITCODE -eq 0) { return $runtimeExe }
        throw 'The existing private Node.js runtime is damaged. Remove its folder and retry.'
    }
    $checksums = Join-Path $InstallRoot 'SHASUMS256.txt'
    $archive = Join-Path $InstallRoot $archiveName
    Get-VerifiedDownload "https://nodejs.org/dist/$versionTag/SHASUMS256.txt" $checksums
    $expected = $null
    foreach ($line in Get-Content -LiteralPath $checksums) {
        if ($line -match '^([a-fA-F0-9]{64})\s+(.+)$' -and $Matches[2] -eq $archiveName) {
            $expected = $Matches[1].ToLowerInvariant()
            break
        }
    }
    if (-not $expected) { throw 'The official Node.js checksum was not found. Installation stopped.' }
    Get-VerifiedDownload "https://nodejs.org/dist/$versionTag/$archiveName" $archive
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item -LiteralPath $archive -Force
        throw 'Node.js checksum verification failed. Installation stopped.'
    }
    $runtimeStage = Join-Path $InstallRoot ('runtime-stage-' + [Guid]::NewGuid().ToString('N'))
    try {
        Expand-SafeArchive $archive $runtimeStage
        Move-Item -LiteralPath (Join-Path $runtimeStage "node-$versionTag-win-$architecture") -Destination $runtimeDir
    } finally { Remove-Item -LiteralPath $runtimeStage -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $archive -Force
    & $runtimeExe -e 'if(parseInt(process.versions.node)<22)process.exit(1)'
    if ($LASTEXITCODE -ne 0) { throw 'The downloaded Node.js runtime could not start.' }
    return $runtimeExe
}

function Get-SavedInstallations {
    param([string]$InstallRoot)
    $folders = @((Join-Path $InstallRoot 'cloud-install'))
    $profiles = Join-Path $InstallRoot 'installations'
    if (Test-Path -LiteralPath $profiles) {
        foreach ($directory in Get-ChildItem -LiteralPath $profiles -Directory) {
            if ($directory.Name -match '^[a-f0-9]{32}$') { $folders += Join-Path $directory.FullName 'cloud-install' }
        }
    }
    foreach ($folder in $folders) {
        $stateFile = Join-Path $folder 'state.json'
        if (-not (Test-Path -LiteralPath $stateFile)) { continue }
        $label = if ($folder -eq (Join-Path $InstallRoot 'cloud-install')) { 'Roshdimo - original installation' } else { 'Roshdimo - ' + (Split-Path -Leaf (Split-Path -Parent $folder)).Substring(0, 8) }
        try {
            $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            if ([string]$saved.url -match '^https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/?$') { $label += ' | ' + [string]$saved.url }
            else { $label += ' | installation in progress' }
        } catch { $label += ' | saved information needs recovery' }
        [PSCustomObject]@{ Folder = $folder; Label = $label }
    }
}

function Select-SavedInstallation {
    param([object[]]$Installations)
    if ($Installations.Count -eq 1) {
        Write-Host $Installations[0].Label -ForegroundColor Cyan
        return $Installations[0].Folder
    }
    Write-Host 'Choose the app you want to update or check:' -ForegroundColor Cyan
    for ($i = 0; $i -lt $Installations.Count; $i++) { Write-Host ("  {0}. {1}" -f ($i + 1), $Installations[$i].Label) }
    for (;;) {
        $answer = Read-Host 'App number (0 cancels)'
        if ($answer -eq '0') { throw 'Installation cancelled. Existing apps are kept.' }
        $chosen = 0
        if ($answer -match '^[1-9][0-9]*$' -and [int]::TryParse($answer, [ref]$chosen) -and $chosen -le $Installations.Count) { return $Installations[$chosen - 1].Folder }
        Write-Host 'Enter one of the app numbers shown above.' -ForegroundColor Yellow
    }
}

try {
    if ($DryRun -and $VerifyOnly) { throw 'Choose either -DryRun or -VerifyOnly.' }
    if ($PSVersionTable.PSVersion -lt [Version]'5.1') { throw 'PowerShell 5.1 or newer is required.' }
    if (-not $env:LOCALAPPDATA) { throw 'The Windows LOCALAPPDATA folder could not be found.' }
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $installMutex = New-Object Threading.Mutex($false, "Local\RooyeshInstaller-$userSid")
    try { $mutexTaken = $installMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $mutexTaken = $true }
    if (-not $mutexTaken) { throw 'Another Rooyesh installer is already running. Close it before starting this one.' }
    $installRoot = Join-Path $env:LOCALAPPDATA 'Rooyesh'
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $savedInstallations = @(Get-SavedInstallations $installRoot)
    $installationMode = $null
    if ($VerifyOnly -and -not $savedInstallations.Count) {
        throw 'No saved installation was found. Run the normal installer first; -VerifyOnly never creates another app.'
    }
    if ($DryRun) {
        $env:ROOYESH_INSTALL_DIR = Join-Path $installRoot 'cloud-install'
    } elseif ($VerifyOnly) {
        $env:ROOYESH_INSTALL_DIR = Select-SavedInstallation $savedInstallations
    } else {
        Write-Host ''
        Write-Host 'Roshdimo - choose what to do' -ForegroundColor Cyan
        if ($savedInstallations.Count) {
            Write-Host '  1. Update an existing app (keeps its address, projects and passwords)'
            Write-Host '  2. Install a separate new app (keeps every existing app)'
            Write-Host '  3. Resume login and database checks only'
            Write-Host '  0. Cancel'
            do { $answer = Read-Host 'Choose 1, 2 or 3 (Enter = Update)' } while ($answer -notin @('', '0', '1', '2', '3'))
            if ($answer -eq '') { $answer = '1' }
        } else {
            Write-Host '  1. Install Roshdimo'
            Write-Host '  0. Cancel'
            do { $answer = Read-Host 'Choose 1 (Enter = Install)' } while ($answer -notin @('', '0', '1'))
            if ($answer -eq '') { $answer = '1' }
        }
        if ($answer -eq '0') { throw 'Installation cancelled. Existing apps are kept.' }
        if ($savedInstallations.Count -and $answer -ne '2') {
            $env:ROOYESH_INSTALL_DIR = Select-SavedInstallation $savedInstallations
            if ($answer -eq '3') { $VerifyOnly = $true } else { $installationMode = '--update' }
        } else {
            $env:ROOYESH_INSTALL_DIR = if ($savedInstallations.Count) { Join-Path (Join-Path (Join-Path $installRoot 'installations') ([Guid]::NewGuid().ToString('N'))) 'cloud-install' } else { Join-Path $installRoot 'cloud-install' }
            $installationMode = '--new-install'
            Write-Host 'A new app has its own Worker, database and app password. Existing apps are preserved.'
        }
    }
    $nodeExe = Get-NodeExecutable $installRoot
    $env:PATH = (Split-Path -Parent $nodeExe) + ';' + $env:PATH

    if ($FromLocalSource) {
        $appRoot = $PSScriptRoot
    } else {
        $releases = Join-Path $installRoot 'releases'
        New-Item -ItemType Directory -Path $releases -Force | Out-Null
        $appRoot = Join-Path $releases $SourceRef
        $marker = Join-Path $appRoot '.rooyesh-source-ref'
        if ($SourceRef -eq 'main' -or -not (Test-Path -LiteralPath $marker)) {
            if ($SourceRef -ne 'main' -and (Test-Path -LiteralPath $appRoot)) {
                throw "An unfinished or unrelated folder exists at $appRoot. Rename that folder and run again."
            }
            Write-Host 'Downloading Roshdimo from GitHub...' -ForegroundColor Cyan
            $stage = Join-Path $installRoot ('source-stage-' + [Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $stage | Out-Null
            try {
                $sourceZip = Join-Path $stage 'source.zip'
                Get-VerifiedDownload "https://codeload.github.com/arzmolaei/testa11/zip/$SourceRef" $sourceZip
                if ($SourceRef -eq 'main') {
                    $sourceHash = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0, 16)
                    $appRoot = Join-Path $releases "main-$sourceHash"
                    $marker = Join-Path $appRoot '.rooyesh-source-ref'
                }
                $expanded = Join-Path $stage 'expanded'
                Expand-SafeArchive $sourceZip $expanded
                $roots = @(Get-ChildItem -LiteralPath $expanded -Directory)
                if ($roots.Count -ne 1) { throw 'The source archive has an unexpected layout.' }
                $downloaded = $roots[0].FullName
                if (-not (Test-Path -LiteralPath (Join-Path $downloaded 'package-lock.json')) -or
                    -not (Test-Path -LiteralPath (Join-Path $downloaded 'scripts\install-cloudflare.mjs'))) {
                    throw 'The GitHub archive does not contain the complete installer.'
                }
                if (-not (Test-Path -LiteralPath $marker)) {
                    if (Test-Path -LiteralPath $appRoot) { throw "An incomplete release exists at $appRoot. Rename it and run again." }
                    Set-Content -LiteralPath (Join-Path $downloaded '.rooyesh-source-ref') -Value $SourceRef -Encoding ASCII
                    Move-Item -LiteralPath $downloaded -Destination $appRoot
                }
            } finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    $helper = Join-Path $appRoot 'scripts\install-cloudflare.mjs'
    if (-not (Test-Path -LiteralPath $helper)) { throw "Installer source is incomplete at $appRoot." }
    Write-Host ''
    if ($VerifyOnly) {
        Write-Host 'Roshdimo - resume final verification' -ForegroundColor Green
        Write-Host 'Your published app is kept. Only login and database read checks will run.'
    } else {
        Write-Host 'Roshdimo - automatic Cloudflare installation' -ForegroundColor Green
        Write-Host 'Cloudflare login approval stays in your browser. No API key is needed.'
    }
    Write-Host 'Keep this window open. If a step fails, run the same command again.'
    Push-Location $appRoot
    try {
        # Recent Node.js versions support the same HTTP(S)_PROXY settings used by Wrangler.
        # Feature-detect the flag so existing Node.js 22.13 installations still work.
        $proxySupported = & $nodeExe -p "process.allowedNodeEnvironmentFlags.has('--use-env-proxy')"
        $nodeArguments = @()
        if ($LASTEXITCODE -eq 0 -and "$proxySupported" -eq 'true') { $nodeArguments += '--use-env-proxy' }
        $nodeArguments += $helper
        if ($DryRun) { $nodeArguments += '--dry-run' }
        if ($VerifyOnly) { $nodeArguments += '--verify-only' }
        if ($installationMode) { $nodeArguments += $installationMode }
        & $nodeExe @nodeArguments
        $helperExitCode = $LASTEXITCODE
    } finally { Pop-Location }
    # A published app remains usable when this terminal's final HTTPS check times out.
    # Create its shortcuts before reporting an unfinished verification.
    if (-not $DryRun) {
        $shortcut = Join-Path $env:ROOYESH_INSTALL_DIR 'Open-Rooyesh.url'
        $desktop = [Environment]::GetFolderPath('Desktop')
        if ($desktop -and (Test-Path -LiteralPath $shortcut)) {
            $profileName = if ($env:ROOYESH_INSTALL_DIR -eq (Join-Path $installRoot 'cloud-install')) { 'Original' } else { (Split-Path -Leaf (Split-Path -Parent $env:ROOYESH_INSTALL_DIR)).Substring(0, 8) }
            $shortcutName = if ($savedInstallations.Count -gt 1 -or $installationMode -eq '--new-install' -and $savedInstallations.Count) { 'Roshdimo ' + $profileName } else { 'Roshdimo' }
            $desktopShortcut = Join-Path $desktop ($shortcutName + '.url')
            if (-not (Test-Path -LiteralPath $desktopShortcut)) {
                try { Copy-Item -LiteralPath $shortcut -Destination $desktopShortcut } catch {
                    Write-Host 'The desktop shortcut could not be created. The app address is printed above.' -ForegroundColor Yellow
                }
            }
            $updater = Join-Path $appRoot 'Update-Alireza-SEO.cmd'
            $desktopUpdater = Join-Path $desktop 'Update Roshdimo.cmd'
            if ((Test-Path -LiteralPath $updater) -and -not (Test-Path -LiteralPath $desktopUpdater)) {
                try { Copy-Item -LiteralPath $updater -Destination $desktopUpdater } catch {
                    Write-Host 'The update shortcut could not be created. Run Update-Alireza-SEO.cmd from the app folder when needed.' -ForegroundColor Yellow
                }
            }
        }
    }
    if ($helperExitCode -ne 0) { throw "Installation stopped (exit $helperExitCode). Your saved deployment information is retained." }
    Write-Host 'Done.' -ForegroundColor Green
    exit 0
} catch {
    Write-Host ''
    Write-Host 'Installation could not finish:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Check the connection and run the same command again. No database is deleted by this installer.'
    exit 1
} finally {
    if ($mutexTaken -and $installMutex) { $installMutex.ReleaseMutex() }
    if ($installMutex) { $installMutex.Dispose() }
}
