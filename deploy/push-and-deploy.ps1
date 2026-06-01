# Push to GitHub, then deploy on VPS (git pull + migrate + PM2).
# Run from project root:
#   .\deploy\push-and-deploy.ps1
#   .\deploy\push-and-deploy.ps1 -Message "Clear Ocean UI and classes page"

param(
  [string]$Vps = "root@185.214.134.41",
  [string]$RemoteDir = "/var/www/ocean-school",
  [string]$Message = "Deploy from local"
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $AppRoot

if (-not (Test-Path (Join-Path $AppRoot ".git"))) {
  Write-Host "ERROR: Not a git repo. Run first:"
  Write-Host "  git init"
  Write-Host "  git remote add origin https://github.com/lazorprince382-cmyk/project-364.git"
  Write-Host "  git add -A"
  Write-Host '  git commit -m "Initial commit"'
  Write-Host "  git branch -M main"
  Write-Host "  git push -u origin main"
  exit 1
}

$status = git status --porcelain
if ($status) {
  Write-Host "==> Committing local changes ..."
  git add -A
  git commit -m $Message
} else {
  Write-Host "==> No local changes to commit."
}

Write-Host "==> Pushing to GitHub (origin main) ..."
git push origin main

Write-Host "==> Deploying on VPS ..."
$shPath = "$RemoteDir/deploy/deploy-from-github.sh"
$deployDir = "$RemoteDir/deploy"
$remoteCmd = "for f in $deployDir/*.sh; do [ -f `"`$f`" ] && sed -i 's/\r`$//' `"`$f`"; done; test -d $RemoteDir/.git || (echo 'Run setup-git-on-vps.sh on VPS first.' >&2; exit 1); APP_DIR='$RemoteDir' bash $shPath"
ssh $Vps $remoteCmd

Write-Host ""
Write-Host "Done. Site updated from GitHub."
