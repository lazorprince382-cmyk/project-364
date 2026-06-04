# GitHub + VPS deploy

Repository: **https://github.com/lazorprince382-cmyk/project-364**

`.env` is **not required** on GitHub for secrets you set per server, but **`.env.example`** and **`config/system-admin.defaults.json`** are committed so a new host can seed the system admin account. Each VPS still keeps its own `.env` (especially `DATABASE_URL`). `uploads/` are never on GitHub (see `.gitignore`).

---

## One-time setup on your PC

```powershell
cd "C:\Users\PRINCE\Desktop\Project 364"

git init
git remote add origin https://github.com/lazorprince382-cmyk/project-364.git
git add -A
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

Sign in to GitHub when prompted (browser or personal access token).

---

## One-time setup on VPS

SSH in and link the app folder to GitHub (backs up current folder, restores `.env` + `uploads`):

```bash
ssh root@185.214.134.41
export GITHUB_REPO=https://github.com/lazorprince382-cmyk/project-364.git
cd /var/www/ocean-school
# upload setup-git-on-vps.sh first, OR after first git push:
bash deploy/setup-git-on-vps.sh
```

If `setup-git-on-vps.sh` is not on the server yet, run from your PC once:

```powershell
scp deploy/setup-git-on-vps.sh root@185.214.134.41:/var/www/ocean-school/deploy/
scp deploy/deploy-from-github.sh root@185.214.134.41:/var/www/ocean-school/deploy/
```

**Private repo (VPS will ask for username/password):** GitHub no longer accepts account passwords for `git clone`. Use either:

**Option A — Make repo public (easiest)**  
GitHub → **project-364** → **Settings** → **Danger zone** → **Change visibility** → Public.

**Option B — Personal access token on VPS**

```bash
export GITHUB_TOKEN=ghp_paste_your_token_here
bash deploy/setup-git-on-vps.sh
```

Create token: GitHub → **Settings** → **Developer settings** → **Personal access tokens** → Generate (scope: `repo`).

At the `Username for 'https://github.com':` prompt (if you see it):

- **Username:** `lazorprince382-cmyk`
- **Password:** paste the **token** (not your GitHub login password)

---

## Every deploy (normal workflow)

From your PC:

```powershell
cd "C:\Users\PRINCE\Desktop\Project 364"
.\deploy\push-and-deploy.ps1 -Message "Describe your change"
```

This will:

1. Commit any local changes (if needed)
2. `git push` to GitHub
3. SSH to VPS → `git pull` → `npm install` → `db:init` → `pm2 restart`

---

## VPS only (after push from another machine)

```bash
cd /var/www/ocean-school
bash deploy/deploy-from-github.sh
```

---

## System admin account (new VPS or fresh database)

Committed in the repo:

- `config/system-admin.defaults.json` — email, password, display name
- `.env.example` — same values (copy to `.env` on first install)

After `npm run db:init`, sign in with that email/password (hidden system admin role).

Override on a specific server by setting `SYSTEM_ADMIN_STAFF_*` in that server's `.env` (takes priority over the JSON file).

## Hosting on another VPS (quick)

```bash
git clone https://github.com/lazorprince382-cmyk/project-364.git
cd project-364
cp .env.example .env
# Edit DATABASE_URL for that server's PostgreSQL
npm install
npm run db:init
npm start
# or: pm2 start deploy/ecosystem.config.cjs
```

---

## Old deploy (SCP, no Git)

```powershell
.\deploy\deploy-recent-changes.ps1
```

Use GitHub deploy when possible; SCP is a fallback.
