# Upload setup script (LF) and run on VPS. Fixes Windows CRLF issues.
#   .\deploy\run-setup-git-on-vps.ps1

param(
  [string]$Vps = "root@185.214.134.41",
  [string]$RemoteDir = "/var/www/ocean-school"
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$deployDir = Join-Path $AppRoot "deploy"

Get-ChildItem (Join-Path $deployDir "*.sh") | ForEach-Object {
  $c = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n" -replace "`r", "`n"
  [IO.File]::WriteAllText($_.FullName, $c, [Text.UTF8Encoding]::new($false))
}

$files = @("setup-git-on-vps.sh", "deploy-from-github.sh", "fix-db-owner-on-vps.sh")
foreach ($name in $files) {
  $local = Join-Path $deployDir $name
  if (-not (Test-Path $local)) { continue }
  Write-Host "==> Upload $name ..."
  ssh $Vps "mkdir -p $RemoteDir/deploy"
  scp $local "${Vps}:${RemoteDir}/deploy/$name"
}

Write-Host "==> Running setup-git-on-vps.sh on VPS ..."
$remoteCmd = "sed -i 's/\r`$//' $RemoteDir/deploy/*.sh; APP_DIR='$RemoteDir' bash $RemoteDir/deploy/setup-git-on-vps.sh"
ssh $Vps $remoteCmd

Write-Host ""
Write-Host "Done."
