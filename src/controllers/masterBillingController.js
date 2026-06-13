const db = require('../config/db');
const {
  sendTrialWarningEmail,
  sendInvoiceEmail,
  sendPaymentReceiptEmail,
} = require('../services/emailService');
const sendSystemSms = require('../services/systemSmsService');

// ── Read rates from DB (never hardcoded) ─────────────────────────────────
async function getSettings() {
  const r   = await db.query('SELECT * FROM billing_settings LIMIT 1');
  const row = r.rows[0] || {};
  return {
    annual:      row.annual_rate          ?? 150,
    termly:      row.termly_rate          ?? 60,
    default:     row.default_billing_type ?? 'termly',
    graceDays:   row.grace_days           ?? 21,
    warningDays: row.warning_days         ?? 3,
  };
}

// ── Invoice number: INV-YYYY-NNNNN ────────────────────────────────────────
async function nextInvoiceNumber() {
  const year   = new Date().getFullYear();
  const result = await db.query(
    `SELECT COUNT(*) AS cnt FROM invoices WHERE invoice_number LIKE $1`, [`INV-${year}-%`]
  );
  return `INV-${year}-${String(parseInt(result.rows[0].cnt) + 1).padStart(5, '0')}`;
}

// ── GET /billing/settings ─────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM billing_settings LIMIT 1');
    res.json(r.rows[0] || { annual_rate: 150, termly_rate: 60, default_billing_type: 'termly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /billing/settings ───────────────────────────────────────────────
exports.updateSettings = async (req, res) => {
  const { annual_rate, termly_rate, default_billing_type, grace_days, warning_days } = req.body;
  if (annual_rate   !== undefined && (isNaN(annual_rate)   || annual_rate < 1))   return res.status(400).json({ error: 'annual_rate must be positive' });
  if (termly_rate   !== undefined && (isNaN(termly_rate)   || termly_rate < 1))   return res.status(400).json({ error: 'termly_rate must be positive' });
  if (grace_days    !== undefined && (isNaN(grace_days)    || grace_days < 1))    return res.status(400).json({ error: 'grace_days must be positive' });
  if (warning_days  !== undefined && (isNaN(warning_days)  || warning_days < 1))  return res.status(400).json({ error: 'warning_days must be positive' });
  if (default_billing_type && !['annual','termly'].includes(default_billing_type)) return res.status(400).json({ error: 'Invalid billing type' });
  try {
    const cur = (await db.query('SELECT * FROM billing_settings LIMIT 1')).rows[0] || {};
    const result = await db.query(`
      UPDATE billing_settings SET
        annual_rate          = $1, termly_rate          = $2,
        default_billing_type = $3, grace_days           = $4,
        warning_days         = $5, updated_at           = NOW()
      WHERE id = (SELECT id FROM billing_settings LIMIT 1)
      RETURNING *
    `, [
      annual_rate          ?? cur.annual_rate          ?? 150,
      termly_rate          ?? cur.termly_rate          ?? 60,
      default_billing_type ?? cur.default_billing_type ?? 'termly',
      grace_days           ?? cur.grace_days           ?? 21,
      warning_days         ?? cur.warning_days         ?? 3,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /billing/overview ─────────────────────────────────────────────────
exports.getOverview = async (req, res) => {
  try {
    const [rates, rev, pending, grace, suspended, recent] = await Promise.all([
      getSettings(),
      db.query(`SELECT COALESCE(SUM(amount_paid), 0)::int AS total FROM invoices WHERE paid_at >= date_trunc('month', NOW())`),
      db.query(`SELECT COUNT(*)::int AS cnt FROM invoices WHERE status = 'PENDING'`),
      db.query(`SELECT COUNT(*)::int AS cnt FROM invoices WHERE status = 'GRACE'`),
      db.query(`SELECT COUNT(*)::int AS cnt FROM schools WHERE is_active = false AND deleted_at IS NULL AND trial_ends_at IS NOT NULL`),
      db.query(`
        SELECT i.invoice_number, i.amount_due, i.status, i.due_date, i.created_at, s.name AS school_name
        FROM invoices i JOIN schools s ON s.id = i.school_id ORDER BY i.created_at DESC LIMIT 10
      `),
    ]);
    res.json({
      mrr:               rev.rows[0].total,
      pending_invoices:  pending.rows[0].cnt,
      grace_invoices:    grace.rows[0].cnt,
      suspended_schools: suspended.rows[0].cnt,
      recent_invoices:   recent.rows,
      annual_rate:       rates.annual,
      termly_rate:       rates.termly,
      default_billing_type: rates.default,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /billing/schools ──────────────────────────────────────────────────
// All schools with their trial + billing + latest invoice status
exports.getSchoolsBilling = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        s.id, s.name, s.email, s.is_active, s.created_at,
        s.trial_ends_at, s.billing_type, s.plan,
        (SELECT COUNT(*) FROM students WHERE school_id = s.id AND status = 'ACTIVE')::int AS student_count,
        inv.id             AS invoice_id,
        inv.invoice_number,
        inv.amount_due,
        inv.amount_paid,
        inv.status         AS invoice_status,
        inv.due_date,
        inv.paid_at
      FROM schools s
      LEFT JOIN LATERAL (
        SELECT * FROM invoices
        WHERE school_id = s.id
        ORDER BY created_at DESC LIMIT 1
      ) inv ON true
      WHERE s.deleted_at IS NULL
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /billing/invoices ─────────────────────────────────────────────────
exports.getAllInvoices = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT i.*, s.name AS school_name, s.email AS school_email
      FROM invoices i JOIN schools s ON s.id = i.school_id
      WHERE s.deleted_at IS NULL ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /schools/:id/trial ──────────────────────────────────────────────
exports.setTrialEndDate = async (req, res) => {
  const { id }                          = req.params;
  const { trial_ends_at, billing_type } = req.body;
  if (!trial_ends_at) return res.status(400).json({ error: 'trial_ends_at required' });
  const btype = ['annual', 'termly'].includes(billing_type) ? billing_type : 'termly';

  try {
    const rates = await getSettings();
    await db.query(`UPDATE schools SET trial_ends_at = $1, billing_type = $2 WHERE id = $3`, [trial_ends_at, btype, id]);

    const school = await db.query(`
      SELECT s.name, s.email, u.full_name, u.phone,
             (SELECT COUNT(*) FROM students WHERE school_id = s.id AND status = 'ACTIVE') AS student_count
      FROM schools s
      LEFT JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE s.id = $1 LIMIT 1`, [id]);

    if (school.rows[0]) {
      const { name, email, full_name, phone, student_count } = school.rows[0];
      const rate      = rates[btype];
      const amountDue = parseInt(student_count) * rate;
      const endDate   = new Date(trial_ends_at);
      if (phone) sendSystemSms(phone, `Hi ${full_name || 'Admin'}, your School OS trial for ${name} ends on ${endDate.toDateString()}. After that, you will be billed KES ${amountDue.toLocaleString()} (${student_count} students × KES ${rate}). - Zuvy`);
      if (email) sendTrialWarningEmail({ adminName: full_name, adminEmail: email, schoolName: name, trialEndsAt: trial_ends_at, billingType: btype, studentCount: parseInt(student_count), amountDue });
    }

    res.json({ message: 'Trial end date set. Notifications sent to school admin.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /billing/process-trials ──────────────────────────────────────────
exports.processTrials = async (req, res) => {
  try {
    const rates   = await getSettings();
    const expired = await db.query(`
      SELECT s.id, s.name, s.email, s.billing_type,
             u.full_name, u.phone, u.email AS admin_email,
             (SELECT COUNT(*) FROM students WHERE school_id = s.id AND status = 'ACTIVE')::int AS student_count
      FROM schools s
      LEFT JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE s.trial_ends_at IS NOT NULL AND s.trial_ends_at <= NOW() AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.school_id = s.id AND i.created_at > NOW() - INTERVAL '60 days'
        )
    `);

    const processed = [];
    for (const school of expired.rows) {
      const btype     = school.billing_type || rates.default;
      const rate      = rates[btype];
      const amount    = school.student_count * rate;
      const dueDate   = new Date(Date.now() + rates.graceDays * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(Date.now() + (btype === 'annual' ? 12 : 4) * 30 * 24 * 60 * 60 * 1000);
      const invNumber = await nextInvoiceNumber();

      const inv = await db.query(`
        INSERT INTO invoices (school_id, invoice_number, student_count, amount_due, billing_type, status, due_date, period_start, period_end)
        VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, NOW(), $7) RETURNING *
      `, [school.id, invNumber, school.student_count, amount, btype, dueDate, periodEnd]);

      if (school.phone)       sendSystemSms(school.phone, `Hello ${school.full_name || 'Admin'}, your School OS trial has ended. Invoice ${invNumber}: KES ${amount.toLocaleString()} due by ${dueDate.toDateString()}. Account pauses if unpaid. - Zuvy`);
      if (school.admin_email) sendInvoiceEmail({ adminName: school.full_name, adminEmail: school.admin_email, schoolName: school.name, invoice: inv.rows[0] });

      processed.push({ school: school.name, invoice: invNumber, amount });
    }

    res.json({ processed: processed.length, details: processed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /billing/warn-trials ─────────────────────────────────────────────
exports.warnTrials = async (req, res) => {
  try {
    const rates = await getSettings();
    const soon  = await db.query(`
      SELECT s.id, s.name, s.billing_type, s.trial_ends_at,
             u.full_name, u.phone, u.email AS admin_email,
             (SELECT COUNT(*) FROM students WHERE school_id = s.id AND status = 'ACTIVE')::int AS student_count
      FROM schools s
      LEFT JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE s.trial_ends_at BETWEEN NOW() AND NOW() + ($1 || ' days')::interval
        AND s.deleted_at IS NULL
    `, [rates.warningDays]);

    for (const school of soon.rows) {
      const btype     = school.billing_type || rates.default;
      const amountDue = school.student_count * rates[btype];
      if (school.phone)       sendSystemSms(school.phone, `Hi ${school.full_name || 'Admin'}, your School OS trial for ${school.name} ends on ${new Date(school.trial_ends_at).toDateString()}. After that, KES ${amountDue.toLocaleString()} will be due. - Zuvy`);
      if (school.admin_email) sendTrialWarningEmail({ adminName: school.full_name, adminEmail: school.admin_email, schoolName: school.name, trialEndsAt: school.trial_ends_at, billingType: btype, studentCount: school.student_count, amountDue });
    }

    res.json({ warned: soon.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /billing/schools/:id/end-trial ─────────────────────────────────
// Clears trial_ends_at so the school is no longer considered in trial.
// Does NOT auto-create an invoice — use /bill for that.
exports.endTrial = async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(
      `UPDATE schools SET trial_ends_at = NULL WHERE id = $1 RETURNING id, name`,
      [id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'School not found' });
    res.json({ message: `Trial cleared for ${r.rows[0].name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /billing/schools/:id/bill ────────────────────────────────────────
// Manually create an invoice for a school right now (bypasses trial guard).
exports.manualBill = async (req, res) => {
  const { id } = req.params;
  try {
    const rates = await getSettings();

    const schoolRes = await db.query(`
      SELECT s.id, s.name, s.billing_type,
             u.full_name, u.email AS admin_email, u.phone AS admin_phone,
             (SELECT COUNT(*) FROM students WHERE school_id = s.id AND status = 'ACTIVE')::int AS student_count
      FROM   schools s
      LEFT   JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE  s.id = $1 AND s.deleted_at IS NULL
      LIMIT  1
    `, [id]);

    if (!schoolRes.rows.length) return res.status(404).json({ error: 'School not found' });
    const school = schoolRes.rows[0];

    if (school.student_count === 0) {
      return res.status(400).json({ error: 'School has no active students' });
    }

    // Guard: no invoice already in last 60 days
    const dup = await db.query(`
      SELECT id FROM invoices
      WHERE school_id = $1 AND created_at > NOW() - INTERVAL '60 days'
      LIMIT 1
    `, [id]);
    if (dup.rows.length) {
      return res.status(409).json({ error: 'An invoice was already created for this school in the last 60 days' });
    }

    const btype     = school.billing_type || rates.default;
    const rate      = btype === 'annual' ? rates.annual : rates.termly;
    const amount    = school.student_count * rate;
    const dueDate   = new Date(Date.now() + rates.graceDays * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + (btype === 'annual' ? 12 : 4) * 30 * 24 * 60 * 60 * 1000);
    const invNumber = await nextInvoiceNumber();

    const inv = await db.query(`
      INSERT INTO invoices
        (school_id, invoice_number, student_count, amount_due, billing_type, status, due_date, period_start, period_end)
      VALUES ($1,$2,$3,$4,$5,'PENDING',$6,NOW(),$7)
      RETURNING *
    `, [id, invNumber, school.student_count, amount, btype, dueDate, periodEnd]);

    if (school.admin_phone) {
      const { sendSystemSms } = require('../services/systemSmsService');
      sendSystemSms(school.admin_phone,
        `${school.name}: Invoice ${invNumber} — ${school.student_count} students x KES ${rate} = KES ${amount.toLocaleString()}. Due ${dueDate.toDateString()}. - Zuvy`);
    }
    if (school.admin_email) {
      const { sendInvoiceEmail } = require('../services/emailService');
      sendInvoiceEmail({
        adminName: school.full_name, adminEmail: school.admin_email,
        schoolName: school.name, invoice: inv.rows[0],
      }).catch(() => {});
    }

    res.json({ invoice: inv.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /billing/schools/:id/type ──────────────────────────────────────
exports.setSchoolBillingType = async (req, res) => {
  const { id }           = req.params;
  const { billing_type } = req.body;
  if (!['annual', 'termly'].includes(billing_type)) {
    return res.status(400).json({ error: 'billing_type must be annual or termly' });
  }
  try {
    await db.query(`UPDATE schools SET billing_type = $1 WHERE id = $2`, [billing_type, id]);
    res.json({ billing_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /billing/invoices/:id/pay ──────────────────────────────────────
exports.markInvoicePaid = async (req, res) => {
  const { id }                          = req.params;
  const { payment_method, payment_ref } = req.body;
  try {
    const inv = await db.query(`
      UPDATE invoices SET status = 'PAID', amount_paid = amount_due, paid_at = NOW(), payment_method = $1, payment_ref = $2
      WHERE id = $3 RETURNING *, school_id
    `, [payment_method || 'bank_transfer', payment_ref || '', id]);

    if (inv.rowCount === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = inv.rows[0];
    await db.query(`UPDATE schools SET is_active = true WHERE id = $1`, [invoice.school_id]);

    const school = await db.query(`
      SELECT s.name, u.full_name, u.phone, u.email AS admin_email
      FROM schools s LEFT JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE s.id = $1 LIMIT 1`, [invoice.school_id]);

    if (school.rows[0]) {
      const { name, full_name, phone, admin_email } = school.rows[0];
      if (phone)       sendSystemSms(phone, `Payment confirmed for ${name}. Invoice ${invoice.invoice_number}: KES ${invoice.amount_paid.toLocaleString()} received. Your account is active. - Zuvy`);
      if (admin_email) sendPaymentReceiptEmail({ adminName: full_name, adminEmail: admin_email, schoolName: name, invoice });
    }

    res.json({ message: 'Invoice marked paid. School reactivated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /billing/invoices/:id/extend ───────────────────────────────────
// Extend grace period by N days — reactivates suspended school
exports.extendGrace = async (req, res) => {
  const { id }   = req.params;
  const { days } = req.body;
  const n        = parseInt(days);
  if (!n || n < 1) return res.status(400).json({ error: 'days must be a positive number' });

  try {
    const inv = await db.query(`
      UPDATE invoices
      SET due_date = NOW() + ($1 || ' days')::interval, status = 'PENDING'
      WHERE id = $2
      RETURNING *, school_id
    `, [n, id]);

    if (inv.rowCount === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = inv.rows[0];
    await db.query(`UPDATE schools SET is_active = true WHERE id = $1`, [invoice.school_id]);

    const school = await db.query(`
      SELECT s.name, u.full_name, u.phone, u.email AS admin_email
      FROM schools s
      LEFT JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE s.id = $1 LIMIT 1
    `, [invoice.school_id]);

    if (school.rows[0]) {
      const { name, full_name, phone, admin_email } = school.rows[0];
      const newDue = new Date(invoice.due_date);
      if (phone) sendSystemSms(phone,
        `Hi ${full_name || 'Admin'}, your School OS grace period for ${name} has been extended by ${n} days. New due date: ${newDue.toDateString()}. - Zuvy`
      );
    }

    res.json({ message: `Grace extended by ${n} days.`, new_due_date: invoice.due_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /billing/suspend-overdue ────────────────────────────────────────
exports.suspendOverdue = async (req, res) => {
  try {
    const overdue = await db.query(`
      SELECT i.id, i.school_id, i.invoice_number, s.name, u.full_name, u.phone
      FROM invoices i JOIN schools s ON s.id = i.school_id
      LEFT JOIN users u ON u.school_id = s.id AND u.role = 'ADMIN' AND u.is_active = true
      WHERE i.status = 'PENDING' AND i.due_date < NOW() AND s.deleted_at IS NULL
    `);

    for (const row of overdue.rows) {
      await db.query(`UPDATE invoices SET status = 'GRACE' WHERE id = $1`, [row.id]);
      await db.query(`UPDATE schools SET is_active = false WHERE id = $1`, [row.school_id]);
      if (row.phone) sendSystemSms(row.phone, `${row.name} School OS account has been paused due to unpaid invoice ${row.invoice_number}. Contact Zuvy to pay and reactivate. - Zuvy`);
    }

    res.json({ suspended: overdue.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
