# Deploy recent Ocean School changes to VPS (incremental — faster than full pack).
# Uploads only files touched in recent UI/auth/comments sessions, runs DB migrations, restarts PM2.
#
# Run from PowerShell (project root):
#   cd "C:\Users\PRINCE\Desktop\Project 364"
#   .\deploy\deploy-recent-changes.ps1
#
# Custom VPS:
#   .\deploy\deploy-recent-changes.ps1 -Vps "root@YOUR_IP" -RemoteDir "/var/www/ocean-school"
#
# Full redeploy instead (all files):
#   .\deploy.ps1

param(
  [string]$Vps = "root@185.214.134.41",
  [string]$RemoteDir = "/var/www/ocean-school"
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $AppRoot

# Every file changed in recent sessions (server + Clear Ocean UI + classes page + auth/DM/comments).
$RelativeFiles = @(
  "server.js",
  "scripts/init-db.js",
  "db/migration_class_weekly_goals.sql",
  "public/classes.html",
  "public/dashboard.html",
  "public/director-dashboard.html",
  "public/head-dashboard.html",
  "public/skill-dashboard.html",
  "public/css/clear-ocean-ui.css",
  "public/css/classes-ocean.css",
  "public/css/dashboard-app.css",
  "public/css/main.css",
  "public/js/welcome-banner.js",
  "public/js/settings.js",
  "public/js/classes-cards.js",
  "public/js/classes-config.js",
  "public/js/classes-signin.js",
  "public/js/staff-auth.js",
  "public/js/class-comments.js",
  "public/js/dashboard.js",
  "public/js/director-dashboard.js",
  "public/js/head-dashboard.js",
  "public/js/skill-dashboard.js",
  "public/js/weekly-goal-ratings.js",
  "public/js/skill-progress.js",
  "public/js/leadership-messages.js",
  "public/js/dm-voice.js",
  "public/js/password-field.js",
  "public/images/ocean-staff-hero.png"
)

function Initialize-RemoteParentDir {
  param([string]$RemotePath)
  $dir = ($RemotePath -replace '\\', '/') -replace '/[^/]+$', ''
  if ($dir) {
    ssh $Vps "mkdir -p `"$dir`"" | Out-Null
  }
}

Write-Host "==> Ocean School - deploy recent changes to $Vps"
Write-Host "    Remote: $RemoteDir"
Write-Host ""

$uploaded = 0
$skipped = 0

foreach ($rel in $RelativeFiles) {
  $local = Join-Path $AppRoot ($rel -replace '/', '\')
  if (-not (Test-Path $local)) {
    Write-Host "  skip (missing): $rel"
    $skipped++
    continue
  }
  $remote = "$RemoteDir/" + ($rel -replace '\\', '/')
  Initialize-RemoteParentDir -RemotePath $remote
  Write-Host "  upload: $rel"
  scp $local "${Vps}:${remote}"
  $uploaded++
}

Write-Host ""
Write-Host "==> Uploaded $uploaded file(s), skipped $skipped missing."
Write-Host "==> Uploading deploy helper script..."
$helperSh = Join-Path $AppRoot "deploy\deploy-recent-changes.sh"
Initialize-RemoteParentDir -RemotePath "$RemoteDir/deploy/deploy-recent-changes.sh"
scp $helperSh "${Vps}:${RemoteDir}/deploy/deploy-recent-changes.sh"

Write-Host "==> Running migrations + PM2 restart on VPS..."
$shPath = "$RemoteDir/deploy/deploy-recent-changes.sh"
# Use semicolons (not &&) so Windows PowerShell 5.1 does not parse the remote command.
$remoteCmd = "sed -i 's/\r`$//' $shPath; APP_DIR='$RemoteDir' bash $shPath"
ssh $Vps $remoteCmd

Write-Host ""
Write-Host "Done. Open your site and hard-refresh (Ctrl+F5)."
Write-Host "  Classes:  http://185.214.134.41/classes.html"
Write-Host ('  Logs:     ssh ' + $Vps + ' "pm2 logs ocean-school --lines 30"')
