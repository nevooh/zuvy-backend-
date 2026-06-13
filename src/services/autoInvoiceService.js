const db               = require('../config/db');
const { sendInvoiceEmail }  = require('./emailService');
const { sendSystemSms }     = require('./systemSmsService');

/**
 * Called fire-and-forget whenever a school activates a new term.
 * - termly schools  → invoice every term activation (guard: no invoice in last 60 days)
 * - annual schools  → invoice only on first term of the year (guard: no annual invoice this year)
 */
async function generateInvoiceOnTermActivation(schoolId, termYear) {
  try {
    // ── 1. Load school + admin contact ───────────────────────────────────────
    const schoolRes = await db.query(`
      SELECT s.id, s.name, s.billing_type, s.trial_ends_at,
             u.email AS admin_email, u.phone AS admin_phone, u.full_name AS admin_name
      FROM   schools s
      LEFT   JOIN users u ON u.school_id = s.id AND u.role = 'admin'
      WHERE  s.id = $1 AND s.deleted_at IS NULL AND s.is_active = true
      LIMIT  1
    `, [schoolId]);

    if (!schoolRes.rows.length) return;
    const school = schoolRes.rows[0];

    // ── 2. Skip schools still in active trial ────────────────────────────────
    if (school.trial_ends_at && new Date(school.trial_ends_at) > new Date()) return;

    const billingType = school.billing_type || 'termly';

    // ── 3. Billing settings (rates + grace days) ──────────────────────────────
    const sRes  = await db.query('SELECT * FROM billing_settings LIMIT 1');
    const cfg   = sRes.rows[0] || {};
    const grace = cfg.grace_days || 21;

    // ── 4. Duplicate guards + pro-rata calculation ────────────────────────────
    let effectiveRate;
    let periodMonths;

    if (billingType === 'termly') {
      const dup = await db.query(`
        SELECT id FROM invoices
        WHERE  school_id = $1 AND billing_type = 'termly'
          AND  created_at > NOW() - INTERVAL '60 days'
        LIMIT  1
      `, [schoolId]);
      if (dup.rows.length) return;

      effectiveRate = cfg.termly_rate || 60;
      periodMonths  = 4; // ~1 term
    } else {
      // annual — guard: no annual invoice already this year
      const dup = await db.query(`
        SELECT id FROM invoices
        WHERE  school_id = $1 AND billing_type = 'annual'
          AND  EXTRACT(YEAR FROM created_at) = $2
        LIMIT  1
      `, [schoolId, termYear]);
      if (dup.rows.length) return;

      // How many terms exist for this school-year? Determines pro-rata slice.
      const termCountRes = await db.query(`
        SELECT COUNT(*) AS cnt FROM academic_terms
        WHERE  school_id = $1 AND year = $2
      `, [schoolId, termYear]);
      const termCount    = parseInt(termCountRes.rows[0].cnt) || 1;
      const remaining    = 4 - termCount;          // Term1→3, Term2→2, Term3→1
      const annualRate   = cfg.annual_rate || 150;
      effectiveRate      = Math.round((annualRate * remaining) / 3);
      periodMonths       = remaining * 4;           // Term1→12m, Term2→8m, Term3→4m
    }

    // ── 5. Active student count ──────────────────────────────────────────────
    const stuRes = await db.query(
      `SELECT COUNT(*) AS cnt FROM students WHERE school_id = $1 AND status = 'ACTIVE'`,
      [schoolId]
    );
    const studentCount = parseInt(stuRes.rows[0].cnt) || 0;
    if (studentCount === 0) return;

    const amountDue = studentCount * effectiveRate;

    // ── 6. Invoice period ────────────────────────────────────────────────────
    const now         = new Date();
    const periodStart = now;
    const periodEnd   = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + periodMonths);
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + grace);

    // ── 7. Generate unique invoice number ────────────────────────────────────
    const cntRes      = await db.query('SELECT COUNT(*) FROM invoices');
    const seq         = (parseInt(cntRes.rows[0].count) + 1).toString().padStart(5, '0');
    const invoiceNumber = `INV-${now.getFullYear()}-${seq}`;

    // ── 8. Insert invoice ────────────────────────────────────────────────────
    await db.query(`
      INSERT INTO invoices
        (school_id, invoice_number, student_count, amount_due,
         billing_type, status, due_date, period_start, period_end)
      VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8)
    `, [
      schoolId, invoiceNumber, studentCount, amountDue,
      billingType, dueDate.toISOString(),
      periodStart.toISOString(), periodEnd.toISOString(),
    ]);

    console.log(`✅ Auto-invoice ${invoiceNumber}: ${school.name} | ${studentCount} students x KES ${effectiveRate} = KES ${amountDue} | ${billingType} (${periodMonths}m)`);

    // ── 9. Notify school admin ────────────────────────────────────────────────
    const dueDateStr = dueDate.toDateString();
    const smsMsg = `${school.name}: Invoice ${invoiceNumber} generated. ${studentCount} students x KES ${effectiveRate} = KES ${amountDue}. Due ${dueDateStr}. Pay to keep account active. - Zuvy`;
    if (school.admin_phone) sendSystemSms(school.admin_phone, smsMsg);
    if (school.admin_email) {
      sendInvoiceEmail({
        adminEmail:  school.admin_email,
        adminName:   school.admin_name,
        schoolName:  school.name,
        invoice: {
          invoice_number: invoiceNumber,
          student_count:  studentCount,
          amount_due:     amountDue,
          billing_type:   billingType,
          due_date:       dueDate.toISOString(),
          period_start:   periodStart.toISOString(),
          period_end:     periodEnd.toISOString(),
        },
      }).catch(() => {});
    }
  } catch (err) {
    console.error('❌ autoInvoice error:', err.message);
  }
}

module.exports = { generateInvoiceOnTermActivation };
