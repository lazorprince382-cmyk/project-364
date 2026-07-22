require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');
const { hashPassword } = require('../lib/staffAuth');

function loadDefaults() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', 'system-admin.defaults.json'), 'utf8')
    );
  } catch (_) {
    return {};
  }
}

async function main() {
  const defaults = loadDefaults();
  const email = String(
    process.env.SYSTEM_ADMIN_STAFF_EMAIL || process.env.GHOST_STAFF_EMAIL || defaults.email || ''
  ).trim().toLowerCase();
  const password = String(
    process.env.SYSTEM_ADMIN_STAFF_PASSWORD || process.env.GHOST_STAFF_PASSWORD || defaults.password || ''
  );
  const displayName = String(
    process.env.SYSTEM_ADMIN_STAFF_NAME || process.env.GHOST_STAFF_NAME || defaults.displayName || 'Tom'
  ).trim();

  if (!email || !password) {
    throw new Error('Missing system admin email or password.');
  }

  const { salt, hash } = hashPassword(password);
  const { rows } = await pool.query(
    `UPDATE school_staff
     SET display_name = $2, role = 'system_admin', class_level = NULL, stream = '',
         password_hash = $3, password_salt = $4, active = TRUE, updated_at = NOW()
     WHERE LOWER(TRIM(email)) = $1
     RETURNING id, email, display_name, role, active`,
    [email, displayName, hash, salt]
  );

  if (!rows.length) {
    const inserted = await pool.query(
      `INSERT INTO school_staff
         (email, display_name, role, class_level, stream, password_hash, password_salt, active)
       VALUES ($1, $2, 'system_admin', NULL, '', $3, $4, TRUE)
       RETURNING id, email, display_name, role, active`,
      [email, displayName, hash, salt]
    );
    console.log('Activated system admin:', inserted.rows[0]);
    return;
  }

  console.log('Activated system admin:', rows[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
