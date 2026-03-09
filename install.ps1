# Dotaz install/update script for Windows
# Usage: irm https://raw.githubusercontent.com/contember/dotaz/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "contember/dotaz"
$Artifact = "dotaz-win-x64"
$InstallDir = if ($env:DOTAZ_INSTALL_DIR) { $env:DOTAZ_INSTALL_DIR } else { "$env:LOCALAPPDATA\Dotaz" }

# ── Resolve version ─────────────────────────────────────────

$Version = $env:DOTAZ_VERSION
if (-not $Version) {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $Version = $release.tag_name
    if (-not $Version) {
        Write-Error "Could not determine latest version"
        exit 1
    }
}

$DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$Artifact.zip"

Write-Host "Installing Dotaz $Version (win-x64)..."

# ── Download and extract ────────────────────────────────────

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "dotaz-install-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $ZipPath = Join-Path $TmpDir "dotaz.zip"

    Write-Host "Downloading $DownloadUrl..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing

    Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force

    # Find the extracted app directory
    $AppSrc = Get-ChildItem -Path $TmpDir -Directory -Filter "Dotaz*" | Select-Object -First 1
    if (-not $AppSrc) {
        Write-Error "No Dotaz directory found in archive"
        exit 1
    }

    # ── Install ─────────────────────────────────────────────

    Write-Host "Installing to $InstallDir..."

    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
    }
    Copy-Item -Recurse -Path $AppSrc.FullName -Destination $InstallDir

    # Create Start Menu shortcut
    $StartMenu = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs")
    $ShortcutPath = Join-Path $StartMenu "Dotaz.lnk"
    $LauncherPath = Join-Path $InstallDir "bin\launcher.exe"

    if (Test-Path $LauncherPath) {
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = $LauncherPath
        $Shortcut.WorkingDirectory = $InstallDir
        $Shortcut.Description = "Desktop database client"

        $IconPath = Join-Path $InstallDir "Resources\appIcon.ico"
        if (Test-Path $IconPath) {
            $Shortcut.IconLocation = $IconPath
        }

        $Shortcut.Save()
        Write-Host "Start Menu shortcut created."
    }

    Write-Host ""
    Write-Host "Done! Dotaz installed to $InstallDir"

} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
