const db = require('../config/db');

// ── GET /api/owner/dashboard ───────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        s.id,
        s.name              AS school_name,
        s.email,
        s.is_active,
        s.created_at,
        COUNT(DISTINCT st.id)  FILTER (WHERE st.status = 'ACTIVE') AS student_count,
        COUNT(DISTINCT t.id)                                        AS teacher_count,
        COALESCE(sb.status,       'TRIAL')                         AS billing_status,
        COALESCE(sb.amount_due,   0)                               AS amount_due,
        COALESCE(sb.amount_paid,  0)                               AS amount_paid,
        sb.billing_date,
        sb.next_billing_date,
        sb.paid_at
      FROM schools s
      LEFT JOIN students  st ON st.school_id = s.id
      LEFT JOIN teachers  t  ON t.school_id  = s.id
      LEFT JOIN school_billing sb ON sb.school_id = s.id
        AND sb.billing_date = (
          SELECT MAX(b2.billing_date) FROM school_billing b2 WHERE b2.school_id = s.id
        )
      GROUP BY s.id, sb.status, sb.amount_due, sb.amount_paid,
               sb.billing_date, sb.next_billing_date, sb.paid_at
      ORDER BY s.created_at DESC
    `);

    // Summary totals
    const totals = result.rows.reduce((acc, row) => {
      acc.schools++;
      acc.students += parseInt(row.student_count) || 0;
      acc.teachers += parseInt(row.teacher_count) || 0;
      acc.revenue  += parseInt(row.amount_paid)   || 0;
      return acc;
    }, { schools: 0, students: 0, teachers: 0, revenue: 0 });

    return res.json({ success: true, schools: result.rows, totals });
  } catch (err) {
    console.error('[getDashboard]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/owner/schools/:id/pause ─────────────────────────────────────────
exports.pauseSchool = async (req, res) => {
  try {
    await db.query('UPDATE schools SET is_active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/owner/schools/:id/activate ──────────────────────────────────────
exports.activateSchool = async (req, res) => {
  try {
    await db.query('UPDATE schools SET is_active = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/owner/billing/record-payment ────────────────────────────────────
exports.recordPayment = async (req, res) => {
  const { school_id, amount_paid, note } = req.body;
  if (!school_id || !amount_paid) {
    return res.status(400).json({ success: false, message: 'school_id and amount_paid required.' });
  }

  try {
    // Get current student count to compute amount_due
    const students = await db.query(
      `SELECT COUNT(*) AS cnt FROM students WHERE school_id = $1 AND status = 'ACTIVE'`,
      [school_id]
    );
    const studentCount = parseInt(students.rows[0].cnt) || 0;
    const amountDue    = studentCount * 100;
    const nextBilling  = new Date();
    nextBilling.setFullYear(nextBilling.getFullYear() + 1);

    await db.query(`
      INSERT INTO school_billing
        (school_id, billing_date, amount_due, amount_paid, status, next_billing_date, paid_at, note)
      VALUES ($1, NOW(), $2, $3, 'PAID', $4, NOW(), $5)
      ON CONFLICT (school_id, billing_date::date) DO UPDATE SET
        amount_paid      = EXCLUDED.amount_paid,
        status           = EXCLUDED.status,
        next_billing_date= EXCLUDED.next_billing_date,
        paid_at          = EXCLUDED.paid_at,
        note             = EXCLUDED.note
    `, [school_id, amountDue, amount_paid, nextBilling, note || '']);

    // Ensure school is active after payment
    await db.query('UPDATE schools SET is_active = true WHERE id = $1', [school_id]);

    res.json({ success: true });
  } catch (err) {
    console.error('[recordPayment]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
