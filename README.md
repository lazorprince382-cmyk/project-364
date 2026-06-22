# Ocean School Management

School management app — classes, learners, marks, comments, staff messaging, and reports.

## Stack

- Node.js + Express
- PostgreSQL
- Static front end in `public/`

## Local development

```bash
cp .env.example .env
# Edit DATABASE_URL for your PostgreSQL server
npm install
npm run db:init   # creates the schema and default staff accounts
npm start
```

Open http://localhost:3000

## Deploy to VPS (GitHub)

1. Push code: `git push origin main`
2. Deploy: `.\deploy\push-and-deploy.ps1`

See [deploy/GITHUB_DEPLOY.md](deploy/GITHUB_DEPLOY.md).
