/* eslint-disable no-console */
const http = require('http');

function req(path, opts = {}, body) {
  return new Promise((resolve, reject) => {
    const o = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const r = http.request(o, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch {
          resolve({ status: res.statusCode, data: d });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const headS = await req('/api/auth/dev-session?as=head_teacher');
  const dirS = await req('/api/auth/dev-session?as=director');
  const head = headS.data.token;
  const dir = dirS.data.token;
  console.log('head staff', headS.data.staff);
  console.log('dir staff', dirS.data.staff);

  const headId = headS.data.staff.id;
  const dirId = dirS.data.staff.id;

  const send = await req(
    '/api/staff-messages',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + head, 'Content-Type': 'application/json' },
    },
    JSON.stringify({ recipient_staff_id: dirId, body: 'tick-verify-' + Date.now() })
  );
  console.log('send status', send.status, send.data);

  const dirThread = await req('/api/staff-messages/thread?with=' + headId, {
    headers: { Authorization: 'Bearer ' + dir },
  });
  console.log('dir thread status', dirThread.status);

  const headThread = await req('/api/staff-messages/thread?with=' + dirId, {
    headers: { Authorization: 'Bearer ' + head },
  });
  const mine = (headThread.data.messages || []).filter((m) => m.is_mine);
  const last = mine[mine.length - 1];
  console.log('last mine msg', last && { id: last.id, tick: last.receipt_tick });

  require('dotenv').config();
  const { pool } = require('../db/pool');
  if (last) {
    const r = await pool.query(
      'SELECT * FROM staff_direct_message_receipts WHERE message_id = $1',
      [last.id]
    );
    console.log('db receipts', r.rows);
    const m = await pool.query('SELECT * FROM staff_direct_messages WHERE id = $1', [last.id]);
    console.log('db message', m.rows[0]);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
