const { pool } = require('../config/db');
const axios    = require('axios');

const CELCOM_BASE      = 'https://isms.celcomafrica.com/api/services';
const CELCOM_API_KEY   = process.env.CELCOM_API_KEY;
const CELCOM_PARTNER_ID = process.env.CELCOM_PARTNER_ID || '1373';
const CELCOM_SHORTCODE  = process.env.CELCOM_SENDER_ID  || 'ZUVY_TECH';

// ─── Normalise phone to 254XXXXXXXXX ─────────────────────────────────────────
function normalisePhone(phone) {
  let p = String(phone).trim();
  if (p.startsWith('+'))                              p = p.substring(1);
  if (p.startsWith('0'))                              p = '254' + p.substring(1);
  if (p.startsWith('7') || p.startsWith('1'))        p = '254' + p;
  return p;
}

// ─── Send SMS via Celcom ──────────────────────────────────────────────────────
// phoneOrArray: single phone string OR array of phone strings
// Returns the full Celcom response object.
const sendSMS = async (school_id, phoneOrArray, message) => {
  const client = await pool.connect();
  try {
    const phones     = (Array.isArray(phoneOrArray) ? phoneOrArray : [phoneOrArray])
                         .map(normalisePhone);
    const mobile     = phones.join(',');
    const count      = phones.length;

    // ── 1. Get rate & check balance (transaction-locked) ─────────────────────
    await client.query('BEGIN');

    const rateRow = await client.query(
      "SELECT value FROM platform_settings WHERE key = 'sms_rate_per_sms'"
    );
    const rate      = parseFloat(rateRow.rows[0]?.value ?? '2.0');
    const totalCost = count * rate;

    const walletRow = await client.query(
      'SELECT balance FROM sms_wallets WHERE school_id = $1 FOR UPDATE',
      [school_id]
    );
    const balance = parseFloat(walletRow.rows[0]?.balance ?? '0');

    if (balance < totalCost) {
      throw new Error(
        `Insufficient SMS Credits. Required: KES ${totalCost}, Available: KES ${balance}`
      );
    }

    // ── 2. Send via Celcom ────────────────────────────────────────────────────
    console.log(`📤 Sending ${count} SMS via Celcom for school: ${school_id}`);

    const { data } = await axios.post(
      `${CELCOM_BASE}/sendsms/`,
      {
        apikey:    CELCOM_API_KEY,
        partnerID: CELCOM_PARTNER_ID,
        shortcode: CELCOM_SHORTCODE,
        mobile,
        message,
        pass_type: 'plain',
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    // Celcom returns { responses: [{ respose-code, response-description, mobile, messageid, networkid }] }
    const responses = data?.responses ?? [];
    const firstCode = responses[0]?.['respose-code'];
    if (firstCode && firstCode !== 200) {
      throw new Error(`Celcom error ${firstCode}: ${responses[0]?.['response-description']}`);
    }

    // ── 3. Deduct wallet & record transaction ─────────────────────────────────
    await client.query(
      'UPDATE sms_wallets SET balance = balance - $1 WHERE school_id = $2',
      [totalCost, school_id]
    );
    await client.query(
      `INSERT INTO wallet_transactions (school_id, amount, transaction_type, description)
       VALUES ($1, $2, 'usage', $3)`,
      [school_id, -totalCost, `Sent ${count} SMS message${count === 1 ? '' : 's'}`]
    );

    await client.query('COMMIT');
    console.log('✅ SMS sent and wallet deducted');
    return data; // caller reads data.responses[i].messageid
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ SMS send failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─── Poll DLR for a single Celcom messageId ───────────────────────────────────
// Returns 'delivered' | 'failed' | 'sent' (still in transit)
async function pollDLR(celcomMessageId) {
  try {
    const { data } = await axios.post(
      `${CELCOM_BASE}/getdlr/`,
      {
        apikey:    CELCOM_API_KEY,
        partnerID: CELCOM_PARTNER_ID,
        messageID: String(celcomMessageId),
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    // Celcom DLR response: { responses: [{ respose-code, response-description, ... }] }
    const desc = (data?.responses?.[0]?.['response-description'] ?? '').toLowerCase();
    if (desc.includes('delivrd') || desc.includes('delivered') || desc.includes('success')) {
      return 'delivered';
    }
    if (data?.responses?.[0]?.['respose-code'] === 1008) {
      return 'sent'; // code 1008 = "No Delivery Report yet" — still in transit
    }
    if (desc.includes('fail') || desc.includes('reject') || desc.includes('undeliv')) {
      return 'failed';
    }
    return 'sent'; // treat unknown as still pending
  } catch {
    return 'sent'; // don't mark as failed on network error
  }
}

// ─── Background DLR poller ────────────────────────────────────────────────────
// Call once at server startup: startDLRPoller()
// Polls every 5 minutes for rows that are still 'sent' and have a celcom_message_id.
function startDLRPoller(intervalMs = 5 * 60 * 1000) {
  async function run() {
    try {
      const { rows } = await pool.query(
        `SELECT id, celcom_message_id
         FROM sent_sms
         WHERE status = 'sent'
           AND celcom_message_id IS NOT NULL
           AND sent_at > NOW() - INTERVAL '48 hours'
         LIMIT 100`
      );
      for (const row of rows) {
        const status = await pollDLR(row.celcom_message_id);
        if (status !== 'sent') {
          await pool.query(
            'UPDATE sent_sms SET status = $1 WHERE id = $2',
            [status, row.id]
          );
        }
      }
      if (rows.length > 0) {
        console.log(`🔄 DLR poll: checked ${rows.length} messages`);
      }
    } catch (err) {
      console.error('DLR poller error:', err.message);
    }
  }
  setInterval(run, intervalMs);
  run(); // run immediately on startup too
  console.log('📡 Celcom DLR poller started');
}

module.exports = sendSMS;
module.exports.startDLRPoller = startDLRPoller;
module.exports.pollDLR        = pollDLR;