# Committed configuration defaults

## System admin account (`system-admin.defaults.json`)

These values are used by `npm run db:init` when `SYSTEM_ADMIN_STAFF_*` is not set in `.env`.
That lets a **fresh deploy** (new VPS, new database) get the same hidden system admin login after migrations run.

| Field | Env override |
|-------|----------------|
| `email` | `SYSTEM_ADMIN_STAFF_EMAIL` |
| `password` | `SYSTEM_ADMIN_STAFF_PASSWORD` |
| `displayName` | `SYSTEM_ADMIN_STAFF_NAME` |

Legacy env names `GHOST_STAFF_*` still work.

**Security:** Anyone with access to this repository can see these credentials. Change them in this file (and `.env.example`) if you fork the project for a different school, then run `npm run db:init` again.

Sign-in: staff login with the email and password above (role is hidden from staff lists).
