# Upload ghost helper and run it on the VPS (interactive password on server).
# Run from project root:
#   .\deploy\enable-ghost-on-vps.ps1

param(
  [string]$Vps = "root@185.214.134.41",
  [string]$RemoteDir = "/var/www/ocean-school"
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$helper = Join-Path $AppRoot "deploy\enable-ghost-on-vps.sh"

Write-Host "==> Uploading enable-ghost-on-vps.sh ..."
ssh $Vps "mkdir -p $RemoteDir/deploy"
scp $helper "${Vps}:${RemoteDir}/deploy/enable-ghost-on-vps.sh"

Write-Host "==> Run on VPS (you will type the ghost password there) ..."
$remoteCmd = "sed -i 's/\r`$//' $RemoteDir/deploy/enable-ghost-on-vps.sh; chmod +x $RemoteDir/deploy/enable-ghost-on-vps.sh; APP_DIR='$RemoteDir' bash $RemoteDir/deploy/enable-ghost-on-vps.sh"
ssh -t $Vps $remoteCmd
