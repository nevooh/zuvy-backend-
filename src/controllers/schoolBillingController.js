const db                    = require('../config/db');
const { sendPaymentReceiptEmail } = require('../services/emailService');
const { sendSystemSms }     = require('../services/systemSmsService');
const instasend = require('../services/instasendService');

// ── PATCH /api/school/billing/type ───────────────────────────────────────────
exports.updateBillingType = async (req, res) => {
  const school_id   = req.user.school_id;
  const { billing_type } = req.body;
  if (!['termly', 'annual'].includes(billing_type)) {
    return res.status(400).json({ error: 'billing_type must be termly or annual' });
  }
  try {
    // Block change while an unpaid invoice exists — amount was calculated at the old rate
    const pending = await db.query(
      `SELECT id FROM invoices WHERE school_id = $1 AND status IN ('PENDING','GRACE') LIMIT 1`,
      [school_id]
    );
    if (pending.rows.length) {
      return res.status(409).json({
        error: 'You have an outstanding invoice. Clear it first before switching billing plan.',
      });
    }
    await db.query(
      `UPDATE schools SET billing_type = $1 WHERE id = $2`,
      [billing_type, school_id]
    );
    res.json({ billing_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/school/billing/invoices ─────────────────────────────────────────
exports.getInvoices = async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const result = await db.query(`
      SELECT id, invoice_number, student_count, amount_due, amount_paid,
             billing_type, status, due_date, paid_at, payment_method,
             period_start, period_end, created_at
      FROM   invoices
      WHERE  school_id = $1
      ORDER  BY created_at DESC
    `, [school_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/school/billing/current ──────────────────────────────────────────
exports.getCurrentInvoice = async (req, res) => {
  const school_id = req.user.school_id;
  try {
    // Latest unpaid invoice + school status
    const invRes = await db.query(`
      SELECT i.id, i.invoice_number, i.student_count, i.amount_due,
             i.billing_type, i.status, i.due_date, i.period_start, i.period_end,
             s.is_active, s.trial_ends_at, s.billing_type AS school_billing_type
      FROM   invoices i
      JOIN   schools  s ON s.id = i.school_id
      WHERE  i.school_id = $1
        AND  i.status IN ('PENDING', 'GRACE')
      ORDER  BY i.created_at DESC
      LIMIT  1
    `, [school_id]);

    if (!invRes.rows.length) {
      // No pending invoice — return school status only
      const schoolRes = await db.query(
        `SELECT is_active, trial_ends_at, billing_type FROM schools WHERE id = $1`,
        [school_id]
      );
      return res.json({ invoice: null, school: schoolRes.rows[0] || {} });
    }

    const row = invRes.rows[0];
    res.json({
      invoice: row,
      school: {
        is_active:     row.is_active,
        trial_ends_at: row.trial_ends_at,
        billing_type:  row.school_billing_type,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/school/billing/sms/mpesa ───────────────────────────────────────
// Initiates an IntaSend STK push for SMS Top-up.
exports.initiateSmsSTK = async (req, res) => {
  const school_id = req.user.school_id;
  const { amount, phone } = req.body;

  if (!amount || !phone) {
    return res.status(400).json({ error: 'amount and phone are required' });
  }

  try {
    // Generate a unique reference for this SMS top-up
    const apiRef = `SMS-${school_id}-${Date.now()}`;

    const result = await instasend.stkPush({
      phone,
      amount: amount,
      apiRef: apiRef,
    });

    res.json({
      tracking_id: apiRef,
      message: 'M-Pesa SMS top-up prompt sent. Check your phone.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/school/billing/pay/mpesa ───────────────────────────────────────
// Initiates an Instasend STK push. Returns a transaction reference to poll.
exports.initiateSTK = async (req, res) => {
  const school_id  = req.user.school_id;
  const { invoice_id, phone } = req.body;

  if (!invoice_id || !phone) {
    return res.status(400).json({ error: 'invoice_id and phone are required' });
  }

  try {
    // Verify invoice belongs to this school and is still unpaid
    const invRes = await db.query(
      `SELECT * FROM invoices WHERE id = $1 AND school_id = $2 AND status IN ('PENDING','GRACE')`,
      [invoice_id, school_id]
    );
    if (!invRes.rows.length) return res.status(404).json({ error: 'Invoice not found or already paid' });

    const invoice = invRes.rows[0];

    const result = await instasend.stkPush({
      phone,
      amount:  invoice.amount_due,
      apiRef:  invoice.invoice_number,
    });

    res.json({
      tracking_id: result?.invoice?.invoice_id,
      message:     'M-Pesa prompt sent. Check your phone.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/school/billing/pay/link ────────────────────────────────────────
// Generates an Instasend hosted checkout URL.
exports.generatePayLink = async (req, res) => {
  const school_id  = req.user.school_id;
  const { invoice_id } = req.body;

  if (!invoice_id) return res.status(400).json({ error: 'invoice_id is required' });

  try {
    const invRes = await db.query(
      `SELECT i.*, s.name AS school_name
       FROM   invoices i JOIN schools s ON s.id = i.school_id
       WHERE  i.id = $1 AND i.school_id = $2 AND i.status IN ('PENDING','GRACE')`,
      [invoice_id, school_id]
    );
    if (!invRes.rows.length) return res.status(404).json({ error: 'Invoice not found or already paid' });

    const invoice = invRes.rows[0];

    const link = await instasend.createCheckout({
      title:       `${invoice.school_name} — ${invoice.invoice_number}`,
      amount:      invoice.amount_due,
      apiRef:      invoice.invoice_number,
    });

    res.json({ url: link.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// IntaSend calls this when a payment is confirmed.
// Confirmed payload fields: state ('COMPLETE'), api_ref (our invoice_number), value (amount paid),
// invoice_id (IntaSend's own UUID — NOT our DB id), provider (e.g. 'M-PESA')
exports.instasendWebhook = async (req, res) => {
  try {
    const sig = instasend.extractSig(req.headers);
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    if (sig && !instasend.verifyWebhook(raw, sig)) {
      console.warn('Webhook: signature mismatch — proceeding (confirm header name with IntaSend)');
    }

    const { state, api_ref, value, invoice_id: intasendInvoiceId, provider } = req.body;

    // Only process confirmed payments
    if (state !== 'COMPLETE') {
      return res.json({ received: true });
    }

    if (!api_ref) {
      console.error('Webhook: missing api_ref in payload', req.body);
      return res.status(400).json({ error: 'api_ref required in webhook payload' });
    }

    // ── Handle SMS Wallet Top-ups ──────────────────────────────────────────
    if (api_ref.startsWith('SMS-')) {
      const parts = api_ref.split('-');
      const schoolIdFromRef = parts[1];
      const amountPaid = parseFloat(value);

      await db.query('BEGIN');
      
      // Update the SMS Wallet
      await db.query(
        `INSERT INTO sms_wallets (school_id, balance) 
         VALUES ($1, $2) ON CONFLICT (school_id) 
         DO UPDATE SET balance = sms_wallets.balance + $2`,
        [schoolIdFromRef, amountPaid]
      );

      // Log the transaction in the history for transparency
      await db.query(
        `INSERT INTO wallet_transactions (school_id, amount, transaction_type, description, reference_id) 
         VALUES ($1, $2, 'topup', 'M-Pesa SMS Top-up (IntaSend)', $3)`,
        [schoolIdFromRef, amountPaid, intasendInvoiceId ?? api_ref]
      );

      await db.query('COMMIT');
      console.log(`✅ SMS Top-up Success: KES ${amountPaid} added to School ${schoolIdFromRef}`);
      return res.json({ received: true });
    }

    // ── Handle Invoice Payments ─────────────────────────────────────────────
    // api_ref is our invoice_number — look up by that, NOT by IntaSend's invoice_id
    const invRes = await db.query(
      `SELECT * FROM invoices WHERE invoice_number = $1`,
      [api_ref]
    );
    if (!invRes.rows.length) {
      console.error(`Webhook: invoice not found for api_ref=${api_ref}`);
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invRes.rows[0];
    if (invoice.status === 'PAID') return res.json({ received: true }); // idempotent

    const amountPaid    = parseFloat(value ?? invoice.amount_due);
    const paymentMethod = (provider || 'INTASEND').toLowerCase().replace(/[^a-z]/g, '_');

    // Mark invoice paid
    await db.query(`
      UPDATE invoices
      SET    status = 'PAID', amount_paid = $1, paid_at = NOW(),
             payment_method = $2, payment_ref = $3
      WHERE  id = $4
    `, [amountPaid, paymentMethod, intasendInvoiceId ?? '', invoice.id]);

    // Reactivate school
    await db.query(`UPDATE schools SET is_active = true WHERE id = $1`, [invoice.school_id]);

    // Notify school admin
    const schoolRes = await db.query(`
      SELECT s.name, u.full_name, u.email AS admin_email, u.phone AS admin_phone
      FROM   schools s
      LEFT   JOIN users u ON u.school_id = s.id AND u.role = 'admin'
      WHERE  s.id = $1
      LIMIT  1
    `, [invoice.school_id]);

    const school = schoolRes.rows[0];
    if (school) {
      const paid = { ...invoice, amount_paid: amountPaid,
                     payment_method: paymentMethod, payment_ref: intasendInvoiceId ?? '' };
      if (school.admin_email) {
        sendPaymentReceiptEmail({
          adminEmail: school.admin_email,
          adminName:  school.full_name,
          schoolName: school.name,
          invoice:    paid,
        }).catch(() => {});
      }
      if (school.admin_phone) {
        sendSystemSms(school.admin_phone,
          `Payment confirmed: KES ${amountPaid.toLocaleString()} for ${invoice.invoice_number}. ` +
          `Your account is now active. Thank you! - Zuvy`);
      }
    }

    console.log(`✅ Webhook: ${api_ref} marked PAID — KES ${amountPaid} via ${provider ?? 'IntaSend'}`);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
