const { pool } = require('../config/db');
const intasend = require('../services/instasendService');

// INITIATE TOP-UP via IntaSend STK Push
exports.initiateTopUp = async (req, res) => {
    let { amount, phoneNumber } = req.body;
    const school_id = req.user.school_id;
    const email = req.user.email;

    // Normalize phone → 2547xxxxxxxx
    let cleanPhone = phoneNumber.replace(/[\s\-\+]/g, '');
    if (cleanPhone.startsWith('0'))       cleanPhone = '254' + cleanPhone.slice(1);
    else if (/^[71]/.test(cleanPhone))    cleanPhone = '254' + cleanPhone;

    try {
        const result = await intasend.stkPush({
            phone:  cleanPhone,
            email:  email,
            amount: amount,
            apiRef: `sms-wallet-${school_id}-${Date.now()}`,
        });

        const invoiceId = result?.invoice?.invoice_id;
        if (!invoiceId) {
            console.error('IntaSend STK response missing invoice_id:', result);
            return res.status(500).json({ error: 'Payment initiation failed' });
        }

        // Store the invoice_id so the webhook can match it back to this school
        await pool.query(
            `INSERT INTO mpesa_sessions (checkout_request_id, school_id, amount)
             VALUES ($1, $2, $3)`,
            [invoiceId, school_id, amount]
        );

        res.json({
            success: true,
            message: 'M-Pesa prompt sent — check your phone',
            invoice_id: invoiceId,
        });
    } catch (err) {
        console.error('IntaSend STK error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Payment request failed' });
    }
};

// WEBHOOK — IntaSend calls this when payment completes
exports.intasendWebhook = async (req, res) => {
    // 1. Verify signature (don't crash if IntaSend omits it in sandbox)
    const sig     = intasend.extractSig(req.headers);
    const rawBody = req.rawBody || JSON.stringify(req.body); // needs rawBody middleware
    if (sig && !intasend.verifyWebhook(rawBody, sig)) {
        console.warn('IntaSend webhook: bad signature — rejecting');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload    = req.body;
    const state      = payload?.invoice?.state;      // 'COMPLETE' | 'FAILED' | 'PENDING'
    const invoiceId  = payload?.invoice?.invoice_id;
    const paidAmount = parseFloat(payload?.invoice?.net_amount ?? payload?.invoice?.amount ?? 0);

    console.log(`IntaSend webhook: invoice=${invoiceId} state=${state} amount=${paidAmount}`);

    if (state !== 'COMPLETE') {
        // Nothing to do for PENDING/FAILED — just acknowledge
        return res.json({ received: true });
    }

    if (!invoiceId || paidAmount <= 0) {
        return res.status(400).json({ error: 'Missing invoice data' });
    }

    try {
        // 2. Look up the pending session
        const sessionRes = await pool.query(
            `SELECT school_id, amount FROM mpesa_sessions
             WHERE checkout_request_id = $1 LIMIT 1`,
            [invoiceId]
        );
        if (!sessionRes.rows.length) {
            console.warn(`IntaSend webhook: no session found for invoice ${invoiceId}`);
            return res.json({ received: true }); // don't retry
        }

        const { school_id, amount } = sessionRes.rows[0];

        // 3. Credit the wallet (use paidAmount from IntaSend, not our stored amount)
        await pool.query(
            `INSERT INTO sms_wallets (school_id, balance)
             VALUES ($1, $2)
             ON CONFLICT (school_id)
             DO UPDATE SET balance = sms_wallets.balance + EXCLUDED.balance`,
            [school_id, paidAmount]
        );

        // 4. Record the transaction
        await pool.query(
            `INSERT INTO wallet_transactions (school_id, amount, reference, status, created_at)
             VALUES ($1, $2, $3, 'SUCCESS', NOW())`,
            [school_id, paidAmount, invoiceId]
        );

        // 5. Clean up the session so duplicate webhooks are ignored
        await pool.query(
            `DELETE FROM mpesa_sessions WHERE checkout_request_id = $1`,
            [invoiceId]
        );

        console.log(`✅ Wallet credited: school=${school_id} +KES ${paidAmount}`);
        res.json({ received: true });
    } catch (err) {
        console.error('Webhook DB error:', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
};
exports.getSmsSettings = async (req, res) => {
    try {
        const r = await pool.query(
            "SELECT key, value FROM platform_settings WHERE key IN ('sms_rate_per_sms', 'sms_min_top_up')"
        );
        const map = Object.fromEntries(r.rows.map(row => [row.key, parseFloat(row.value)]));
        res.json({
            sms_rate_per_sms: map['sms_rate_per_sms'] ?? 2.0,
            sms_min_top_up:   map['sms_min_top_up']   ?? 100,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateSmsSettings = async (req, res) => {
    const { sms_rate_per_sms, sms_min_top_up } = req.body;
    try {
        if (sms_rate_per_sms !== undefined) {
            const rate = parseFloat(sms_rate_per_sms);
            if (isNaN(rate) || rate <= 0) return res.status(400).json({ error: 'Invalid rate' });
            await pool.query(
                `INSERT INTO platform_settings (key, value, updated_at) VALUES ('sms_rate_per_sms', $1, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
                [String(rate)]
            );
        }
        if (sms_min_top_up !== undefined) {
            const min = parseFloat(sms_min_top_up);
            if (isNaN(min) || min < 0) return res.status(400).json({ error: 'Invalid minimum' });
            await pool.query(
                `INSERT INTO platform_settings (key, value, updated_at) VALUES ('sms_min_top_up', $1, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
                [String(min)]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getBalance = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const result = await pool.query(
            `SELECT balance FROM sms_wallets WHERE school_id = $1`, [school_id]
        );
        res.json({ balance: result.rows[0]?.balance || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getRate = async (req, res) => {
    try {
        const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'sms_rate_per_sms'");
        const rate = r.rows[0] ? parseFloat(r.rows[0].value) : 2.0;
        res.json({ rate_per_sms: rate });
    } catch (err) {
        res.json({ rate_per_sms: 2.0 });
    }
};

exports.getWalletInfo = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const [walletRes, settingsRes] = await Promise.all([
            pool.query('SELECT balance FROM sms_wallets WHERE school_id = $1', [school_id]),
            pool.query("SELECT key, value FROM platform_settings WHERE key IN ('sms_rate_per_sms', 'sms_min_top_up')")
        ]);
        const balance = parseFloat(walletRes.rows[0]?.balance ?? 0);
        const settingsMap = Object.fromEntries(settingsRes.rows.map(r => [r.key, parseFloat(r.value)]));
        const smsRate  = settingsMap['sms_rate_per_sms'] ?? 2.0;
        const minTopUp = settingsMap['sms_min_top_up']   ?? 100;
        const smsCount = Math.floor(balance / smsRate);
        res.json({ balance, smsCount, smsRate, minTopUp, lowBalanceThreshold: 20 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getHistory = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const result = await pool.query(
            `SELECT * FROM wallet_transactions WHERE school_id = $1 ORDER BY created_at DESC`, [school_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateSettlementDetails = async (req, res) => {
    const { paybill, account } = req.body;
    const school_id = req.user.school_id;
    try {
        await pool.query(
            "UPDATE schools SET settlement_paybill = $1, settlement_account = $2 WHERE id = $3",
            [paybill, account, school_id]
        );
        res.json({ success: true, message: "Settlement details updated." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to update" });
    }
};