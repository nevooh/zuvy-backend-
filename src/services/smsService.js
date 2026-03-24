const { pool } = require('../config/db');
const AfricasTalking = require('africastalking');

const africasTalking = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});

const sms = africasTalking.SMS;

/**
 * sendSMS with Automatic Billing
 * @param {string} school_id - The ID of the school paying
 * @param {string|string[]} phoneOrArray - Recipient numbers
 * @param {string} message - The content
 */
const sendSMS = async (school_id, phoneOrArray, message) => {
  const client = await pool.connect(); // Use a single client for transaction safety
  try {
    // 1. Prepare recipients
    let recipients = Array.isArray(phoneOrArray) ? phoneOrArray : [phoneOrArray];
    recipients = recipients.map(phone => {
        let cleaned = String(phone).trim();
        if (cleaned.startsWith('0')) cleaned = '+254' + cleaned.substring(1);
        else if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = '+254' + cleaned;
        else if (cleaned.startsWith('254') && !cleaned.startsWith('+')) cleaned = '+' + cleaned;
        return cleaned;
    });

    const recipientCount = recipients.length;

    // 2. START TRANSACTION: Lock the wallet while we calculate
    await client.query('BEGIN');

    // 3. GET CURRENT RATE & BALANCE
    // We assume the rate is 2.0, but you could fetch this from a 'settings' table too
    const rate = 2.0; 
    const totalCost = recipientCount * rate;

    const walletData = await client.query(
      'SELECT balance FROM sms_wallets WHERE school_id = $1 FOR UPDATE', 
      [school_id]
    );

    const currentBalance = parseFloat(walletData.rows[0]?.balance || 0);

    // 4. THE GATEKEEPER: Check if they can afford it
    if (currentBalance < totalCost) {
      throw new Error(`Insufficient SMS Credits. Required: KES ${totalCost}, Available: KES ${currentBalance}`);
    }

    // 5. ACTUALLY SEND VIA AFRICA'S TALKING
    console.log(`📤 Sending ${recipientCount} SMS for School: ${school_id}`);
    const response = await sms.send({ to: recipients, message: message });

    // 6. DEDUCT THE CASH
    await client.query(
      'UPDATE sms_wallets SET balance = balance - $1 WHERE school_id = $2',
      [totalCost, school_id]
    );

    // 7. RECORD THE USAGE IN HISTORY
    await client.query(
      `INSERT INTO wallet_transactions (school_id, amount, transaction_type, description) 
       VALUES ($1, $2, 'usage', $3)`,
      [school_id, -totalCost, `Sent ${recipientCount} SMS Messages`]
    );

    await client.query('COMMIT');
    console.log("✅ SMS Sent and Wallet Deducted:", response);
    return response;

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ SMS Process Blocked:", err.message);
    throw err; // Send the "Insufficient Balance" error up to the Flutter app
  } finally {
    client.release();
  }
};

module.exports = sendSMS;