# Deploy today's updates to VPS (185.214.134.41)

Updates include: group chats, clear chat, profile photos in messages, staff profile save, head comment edits, and related API/database changes.

**Keeps:** existing `.env`, PostgreSQL data, and `uploads/` (learner photos, message attachments, profile images).

---

## Quick deploy (recommended)

On your **Windows PC** (PowerShell):

```powershell
cd "C:\Users\PRINCE\Desktop\Project 364"
.\deploy\upload-full-update.ps1
```

Enter your VPS root password when `ssh` / `scp` ask for it.

---

## Manual deploy (if the script fails)

### 1) Pack and upload (PC)

```powershell
cd "C:\Users\PRINCE\Desktop\Project 364"
tar -czf $env:TEMP\ocean-school-update.tgz --exclude=node_modules --exclude=.git --exclude=.env --exclude=uploads .
scp $env:TEMP\ocean-school-update.tgz root@185.214.134.41:/tmp/
scp deploy\update-vps.sh root@185.214.134.41:/var/www/ocean-school/deploy/
```

### 2) Apply on VPS (SSH)

```bash
ssh root@185.214.134.41
chmod +x /var/www/ocean-school/deploy/update-vps.sh
bash /var/www/ocean-school/deploy/update-vps.sh /tmp/ocean-school-update.tgz
```

---

## After deploy

1. Open **http://185.214.134.41**
2. **Hard refresh** (Ctrl+F5) or use a private tab on phones
3. Test:
   - **Messages** → New chat → **New group**, send a message
   - **Clear chat** on an open conversation
   - **Settings** → save display name / upload profile photo

---

## Verify on VPS

```bash
pm2 status
pm2 logs ocean-school --lines 20
grep "20260530j" /var/www/ocean-school/public/dashboard.html
```

---

## Fix: `must be owner of table students`

Your data was imported as the `postgres` user, but the app uses `ocean_user`. Migrations need table ownership.

**SSH into the VPS** and run:

```bash
cd /var/www/ocean-school
bash deploy/fix-db-owner-on-vps.sh
npm run db:init
pm2 restart ocean-school
```

You should see `Schema applied successfully.` Then hard-refresh the site.

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `Could not clear chat` / `Could not save profile` | Old Node process still running. On VPS: `pm2 restart ocean-school` |
| `must be owner of table students` | `bash deploy/fix-db-owner-on-vps.sh` then `npm run db:init` (see below) |
| Other `Schema` / database errors | `cd /var/www/ocean-school && npm run db:init` then `pm2 restart ocean-school` |
| UI looks old | Hard refresh; confirm HTML has `?v=20260530j` on `leadership-messages.js` |
| `pm2: command not found` | `npm install -g pm2` then `pm2 start deploy/ecosystem.config.cjs` |

---

## Partial upload (only changed files)

If you prefer a smaller upload:

```powershell
$VPS = "root@185.214.134.41"
$APP = "C:\Users\PRINCE\Desktop\Project 364"
$R = "/var/www/ocean-school"

scp "$APP\server.js" "${VPS}:${R}/"
scp "$APP\scripts\init-db.js" "${VPS}:${R}/scripts/"
scp "$APP\db\migration_staff_message_groups.sql" "$APP\db\migration_school_staff_profile.sql" "${VPS}:${R}/db/"
scp "$APP\public\js\leadership-messages.js" "$APP\public\js\settings.js" "${VPS}:${R}/public/js/"
scp "$APP\public\css\dashboard-app.css" "${VPS}:${R}/public/css/"
scp "$APP\public\dashboard.html" "$APP\public\head-dashboard.html" "$APP\public\director-dashboard.html" "$APP\public\skill-dashboard.html" "${VPS}:${R}/public/"
```

Then on VPS:

```bash
cd /var/www/ocean-school
npm run db:init
pm2 restart ocean-school
```
