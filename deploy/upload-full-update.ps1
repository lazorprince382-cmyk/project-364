# Pack project and update VPS (keeps server .env and uploads/).
# Run from PowerShell:
#   cd "C:\Users\PRINCE\Desktop\Project 364"
#   .\deploy\upload-full-update.ps1
param(
  [string]$Vps = "root@185.214.134.41",
  [string]$RemoteDir = "/var/www/ocean-school"
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $AppRoot

$Tgz = Join-Path $env:TEMP "ocean-school-update.tgz"
if (Test-Path $Tgz) { Remove-Item $Tgz -Force }

Write-Host "==> Packing project (excluding node_modules, .git, .env, uploads)..."
& tar -czf $Tgz `
  --exclude=node_modules `
  --exclude=.git `
  --exclude=.env `
  --exclude=uploads `
  --exclude="*.tgz" `
  -C $AppRoot .

Write-Host "==> Uploading to $Vps ..."
ssh $Vps "mkdir -p $RemoteDir/deploy"
scp $Tgz "${Vps}:/tmp/ocean-school-update.tgz"
scp (Join-Path $AppRoot "deploy\update-vps.sh") "${Vps}:${RemoteDir}/deploy/update-vps.sh"

Write-Host "==> Running update on VPS..."
ssh $Vps "chmod +x ${RemoteDir}/deploy/update-vps.sh && bash ${RemoteDir}/deploy/update-vps.sh /tmp/ocean-school-update.tgz"

Write-Host ""
Write-Host "Done. Open http://185.214.134.41 and hard-refresh (Ctrl+F5)."
