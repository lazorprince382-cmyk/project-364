# Deploy Ocean School to VPS (pack, upload, migrate, restart PM2).
# Keeps server .env, database, and uploads/ untouched.
#
# Usage (PowerShell):
#   cd "C:\Users\PRINCE\Desktop\Project 364"
#   .\deploy.ps1
#
# Optional:
#   .\deploy.ps1 -Vps "root@185.214.134.41" -RemoteDir "/var/www/ocean-school"

param(
  [string]$Vps = "root@185.214.134.41",
  [string]$RemoteDir = "/var/www/ocean-school"
)

& (Join-Path $PSScriptRoot "deploy\upload-full-update.ps1") -Vps $Vps -RemoteDir $RemoteDir
