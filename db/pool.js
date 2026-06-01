const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

/** Avoid `new Pool()` with no URL — it still opens TCP and can spam SCRAM errors if env is half-set */
const pool = connectionString
  ? new Pool({ connectionString })
  : {
      query() {
        return Promise.reject(
          Object.assign(new Error('DATABASE_URL is not set. Copy .env.example to .env and set a valid URL.'), {
            code: 'NO_DATABASE_URL',
          })
        );
      },
    };

if (!connectionString) {
  console.warn('[db] DATABASE_URL is not set. API routes that need the database will fail until you configure .env');
}

module.exports = { pool };
