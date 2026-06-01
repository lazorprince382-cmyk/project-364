# Export local ocean_school PostgreSQL database for VPS import.
# Run from project root: powershell -ExecutionPolicy Bypass -File deploy/export-local-db.ps1

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DumpPath = Join-Path $ProjectRoot 'ocean-school.sql'
$PgDump = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'

if (-not (Test-Path $PgDump)) {
  throw "pg_dump not found at $PgDump. Install PostgreSQL client tools or update the path in this script."
}

$envFile = Join-Path $ProjectRoot '.env'
if (-not (Test-Path $envFile)) {
  throw "Missing .env in project root."
}
$databaseUrl = (Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
if (-not $databaseUrl) {
  throw 'DATABASE_URL not set in .env'
}

$uri = [Uri]$databaseUrl
$user = [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0])
$pass = if ($uri.UserInfo.Contains(':')) { [Uri]::UnescapeDataString($uri.UserInfo.Split(':', 2)[1]) } else { '' }
$hostName = $uri.Host
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$dbName = $uri.AbsolutePath.TrimStart('/')

$env:PGPASSWORD = $pass
& $PgDump -h $hostName -p $port -U $user -d $dbName --no-owner --no-acl --clean --if-exists -f $DumpPath
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# PG 18 dumps may include settings older servers do not recognize.
$lines = Get-Content $DumpPath | Where-Object {
  $_ -notmatch 'transaction_timeout' -and $_ -notmatch '^\\restrict' -and $_ -notmatch '^\\unrestrict'
}
Set-Content -Path $DumpPath -Value $lines -Encoding utf8

$sizeMb = [math]::Round((Get-Item $DumpPath).Length / 1MB, 2)
Write-Host "Exported $dbName to $DumpPath ($sizeMb MB)"
Write-Host ""
Write-Host "Upload and import on VPS:"
Write-Host "  scp `"$DumpPath`" root@185.214.134.41:/tmp/ocean-school.sql"
Write-Host "  scp deploy/import-db-on-vps.sh root@185.214.134.41:/var/www/ocean-school/deploy/"
Write-Host "  ssh root@185.214.134.41 `"cd /var/www/ocean-school && sed -i 's/\r$//' deploy/import-db-on-vps.sh && bash deploy/import-db-on-vps.sh /tmp/ocean-school.sql`""
