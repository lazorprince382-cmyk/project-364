# Deploy head teacher + director updates to VPS

Ocean School path on VPS: `/var/www/ocean-school`

## Why the VPS looked unchanged

`head-dashboard.html` and `director-dashboard.html` loaded CSS/JS **without cache-busting** (`?v=...`). Phones and browsers kept old `dashboard-app.css` and JS even after partial uploads.

Local project now uses `?v=20260529a` on those pages.

## Upload from Windows (PowerShell)

```powershell
$VPS = "root@185.214.134.41"
$APP = "C:\Users\PRINCE\Desktop\Project 364"
$R = "/var/www/ocean-school"

scp "$APP\public\head-dashboard.html" "$APP\public\director-dashboard.html" "${VPS}:${R}/public/"
scp "$APP\public\css\dashboard-app.css" "$APP\public\css\class-page1.css" "${VPS}:${R}/public/css/"
scp "$APP\public\js\head-dashboard.js" "$APP\public\js\head-comment-review.js" "$APP\public\js\head-learner-comments.js" "${VPS}:${R}/public/js/"
scp "$APP\public\js\director-dashboard.js" "$APP\public\js\settings.js" "${VPS}:${R}/public/js/"
scp "$APP\public\js\message-notify.js" "$APP\public\js\leadership-messages.js" "${VPS}:${R}/public/js/"
scp "$APP\server.js" "${VPS}:${R}/"
```

## On VPS

```bash
cd /var/www/ocean-school
pm2 restart ocean-school
pm2 save
```

## Verify files updated

```bash
grep "20260529a" /var/www/ocean-school/public/head-dashboard.html
grep "20260529a" /var/www/ocean-school/public/director-dashboard.html
ls -la /var/www/ocean-school/public/css/dashboard-app.css
ls -la /var/www/ocean-school/public/js/head-comment-review.js
```

## On phone / browser

1. Hard refresh, or use a **private tab**
2. Open head teacher or director dashboard
3. In DevTools → Network, confirm CSS loads as `dashboard-app.css?v=20260529a`

If you still see the old UI, clear site data for the school URL once.
