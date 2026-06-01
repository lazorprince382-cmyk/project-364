require('dotenv').config();
const { pool } = require('../db/pool');

async function markStaffDmPeerSeen(readerStaffId, senderStaffId) {
  const reader = Number(readerStaffId);
  const sender = Number(senderStaffId);
  await pool.query(
    `INSERT INTO staff_direct_message_receipts (message_id, reader_staff_id, delivered_at, seen_at)
     SELECT m.id, $1, NOW(), NOW()
     FROM staff_direct_messages m
     WHERE m.recipient_staff_id = $1 AND m.sender_staff_id = $2
     ON CONFLICT (message_id, reader_staff_id)
     DO UPDATE SET
       delivered_at = COALESCE(staff_direct_message_receipts.delivered_at, EXCLUDED.delivered_at),
       seen_at = NOW()`,
    [reader, sender]
  );
}

async function attachStaffDmReceiptTicks(rows, viewerStaffId) {
  const viewer = Number(viewerStaffId);
  const sent = rows.filter((m) => Number(m.sender_staff_id) === viewer);
  const ids = sent.map((m) => m.id);
  const { rows: receiptRows } = await pool.query(
    `SELECT m.id AS message_id, r.delivered_at, r.seen_at
     FROM staff_direct_messages m
     LEFT JOIN staff_direct_message_receipts r
       ON r.message_id = m.id AND r.reader_staff_id = m.recipient_staff_id
     WHERE m.sender_staff_id = $1 AND m.id = ANY($2::int[])`,
    [viewer, ids]
  );
  const byId = new Map(receiptRows.map((r) => [r.message_id, r]));
  sent.forEach((m) => {
    const rec = byId.get(m.id);
    m.receipt_tick = rec && rec.seen_at ? 3 : rec && rec.delivered_at ? 2 : 1;
    console.log('msg', m.id, 'tick', m.receipt_tick, 'seen', rec && rec.seen_at);
  });
}

(async () => {
  await markStaffDmPeerSeen(1, 37);
  const { rows } = await pool.query(
    `SELECT id, sender_staff_id, recipient_staff_id FROM staff_direct_messages WHERE id IN (5,6)`
  );
  await attachStaffDmReceiptTicks(rows, 37);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
