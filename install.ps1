# Dotaz install/update script for Windows
# Usage: irm https://raw.githubusercontent.com/contember/dotaz/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "contember/dotaz"
$Artifact = "dotaz-win-x64-setup.exe"

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

$DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$Artifact"

Write-Host "Installing Dotaz $Version (win-x64)..."

# ── Download and run installer ──────────────────────────────

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "dotaz-install-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $InstallerPath = Join-Path $TmpDir $Artifact

    Write-Host "Downloading $DownloadUrl..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $InstallerPath -UseBasicParsing

    Write-Host "Running installer..."
    Start-Process -FilePath $InstallerPath -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait

    Write-Host ""
    Write-Host "Done! Dotaz $Version installed."
} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
