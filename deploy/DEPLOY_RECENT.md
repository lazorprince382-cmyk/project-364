# Deploy recent changes to VPS

## One command (from your PC)

Open **PowerShell** in the project folder:

```powershell
cd "C:\Users\PRINCE\Desktop\Project 364"
.\deploy\deploy-recent-changes.ps1
```

Enter your VPS password when `ssh` / `scp` ask for it.

This script:

1. Uploads all files changed in recent sessions (classes UI, sign-in modal, Clear Ocean dashboards, staff lock, comments, weekly goals, DM voice share, session timeout, etc.)
2. Runs `npm run db:init` on the VPS (applies new migrations safely)
3. Restarts the app with PM2

---

## What gets uploaded

| Area | Files |
|------|--------|
| Server | `server.js`, `scripts/init-db.js`, `db/migration_class_weekly_goals.sql` |
| Classes page | `public/classes.html`, `public/css/classes-ocean.css`, `public/js/classes-cards.js`, `classes-config.js`, `classes-signin.js` |
| Clear Ocean UI | `public/css/clear-ocean-ui.css`, `public/js/welcome-banner.js`, `public/js/settings.js` |
| Dashboards | `dashboard.html`, `director/head/skill-dashboard.html`, `dashboard-app.css`, related JS |
| Auth & features | `staff-auth.js`, `class-comments.js`, `weekly-goal-ratings.js`, `dm-voice.js`, `leadership-messages.js`, etc. |
| Background | `public/images/ocean-staff-hero.png` (if present locally) |

---

## Custom VPS

```powershell
.\deploy\deploy-recent-changes.ps1 -Vps "root@YOUR_IP" -RemoteDir "/var/www/ocean-school"
```

---

## Full deploy (if incremental fails)

Uploads the entire project as a tarball:

```powershell
.\deploy.ps1
```

---

## After deploy

1. Open **http://185.214.134.41/classes.html** (or your domain)
2. **Ctrl+F5** hard refresh
3. Test: class cards, sign-in modal, dashboard “Change UI” → Clear Ocean

Check logs if needed:

```bash
ssh root@185.214.134.41 "pm2 logs ocean-school --lines 30"
```

---

## Ghost account not working on VPS

Deploy **does not copy** your local `.env` (keeps server secrets safe). If deploy logged:

`Ghost account skipped: set GHOST_STAFF_PASSWORD in .env`

the ghost user was never created. Fix:

```powershell
.\deploy\enable-ghost-on-vps.ps1
```

Or SSH manually:

```bash
ssh root@185.214.134.41
cd /var/www/ocean-school
nano .env
```

Add (password **must be in quotes** if it contains `#`):

```
GHOST_STAFF_EMAIL=tomdaniel382@gmail.com
GHOST_STAFF_PASSWORD="pri372#nce"
GHOST_STAFF_NAME=System Admin
```

Then:

```bash
npm run db:init
pm2 restart ocean-school
```

Sign in at **http://185.214.134.41/admin.html** or via a class card on `/classes.html`.

---

## Troubleshooting

| Problem | Fix on VPS |
|---------|------------|
| Ghost / Invalid credentials | Set `GHOST_STAFF_PASSWORD` in `.env` (quoted if `#` in password), then `npm run db:init` |
| Schema / DB errors | `cd /var/www/ocean-school && bash deploy/fix-db-owner-on-vps.sh && npm run db:init` |
| Old UI still showing | Hard refresh; confirm files uploaded: `ls -la public/css/classes-ocean.css` |
| Hero image missing | Copy `public/images/ocean-staff-hero.png` to PC project, re-run deploy script |
| `pm2 not found` | `npm install -g pm2` then `pm2 start deploy/ecosystem.config.cjs` |
