const { pool } = require('../config/db');
const smsController = require('./smsController');
const { v4: uuidv4 } = require('uuid');

// Guard: verify the student belongs to this school before returning data
async function assertStudentOwnership(client, studentId, schoolId) {
  const r = await client.query(
    `SELECT 1 FROM students WHERE id = $1 AND school_id = $2`,
    [studentId, schoolId]
  );
  if (r.rowCount === 0) {
    const err = new Error('Student not found.');
    err.status = 404;
    throw err;
  }
}

exports.generateInvoice = async (req, res, next) => {
  const { student_id, term_id, fees } = req.body;
  const school_id = req.user.school_id;

  if (!student_id || !term_id || !fees || !Array.isArray(fees) || fees.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: student_id, term_id, fees[]' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertStudentOwnership(client, student_id, school_id);

    const existingInvoice = await client.query(
      `SELECT id FROM student_invoices WHERE student_id = $1 AND term_id = $2`,
      [student_id, term_id]
    );
    if (existingInvoice.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Invoice already exists for this student and term.' });
    }

    const ledgerResult = await client.query(
      `SELECT COALESCE(
         SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END) -
         SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END),
       0) AS balance
       FROM student_ledger WHERE student_id = $1`,
      [student_id]
    );

    const previousBalance = Number(ledgerResult.rows[0].balance);
    const currentTermFees = fees.reduce((sum, f) => sum + Number(f.amount), 0);
    const finalBalance = currentTermFees + previousBalance;

    const invoiceResult = await client.query(
      `INSERT INTO student_invoices
         (school_id, student_id, term_id, total_amount, balance)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [school_id, student_id, term_id, currentTermFees, finalBalance]
    );
    const invoice = invoiceResult.rows[0];

    for (const fee of fees) {
      await client.query(
        `INSERT INTO student_invoice_items
           (invoice_id, fee_name, amount, is_mandatory)
         VALUES ($1, $2, $3, $4)`,
        [invoice.id, fee.fee_name, fee.amount, fee.is_mandatory ?? true]
      );
    }

    await client.query(
      `INSERT INTO student_ledger
         (student_id, term_id, type, amount, reference_type, reference_id)
       VALUES ($1, $2, 'DEBIT', $3, 'INVOICE', $4)`,
      [student_id, term_id, currentTermFees, invoice.id]
    );

    await client.query('COMMIT');
    res.status(201).json(invoice);

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

exports.postPayment = async (req, res, next) => {
  const { student_id, term_id, amount, method, reference } = req.body;
  const school_id = req.user.school_id;

  if (!student_id || !amount || !reference) {
    return res.status(400).json({ error: 'Missing required fields: student_id, amount, reference' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertStudentOwnership(client, student_id, school_id);

    const paymentResult = await client.query(
      `INSERT INTO payments
         (student_id, term_id, school_id, amount_paid, payment_method, reference)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [student_id, term_id, school_id, amount, method, reference]
    );

    await client.query('COMMIT');

    smsController.triggerAutoReceipt(school_id, student_id, amount)
      .catch(err => console.error('[postPayment] SMS Error:', err.message));

    res.status(201).json({
      success: true,
      message: 'Payment successful and balances updated',
      data: paymentResult.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

exports.getStudentFinancialSummary = async (req, res, next) => {
  const { student_id } = req.params;
  const school_id = req.user.school_id;
  const client = await pool.connect();

  try {
    await assertStudentOwnership(client, student_id, school_id);

    const invoiceRes = await client.query(
      `SELECT i.id, i.total_amount,
              CASE WHEN t.name = 'Opening Balance' THEN 'Arrears' ELSE t.name END AS term_name,
              t.id AS term_id
       FROM student_invoices i
       JOIN academic_terms t ON i.term_id = t.id
       WHERE i.student_id = $1
       ORDER BY t.is_active DESC, t.year DESC, t.start_date DESC
       LIMIT 1`,
      [student_id]
    );

    const inv = invoiceRes.rows[0];
    if (!inv) return res.status(404).json({ message: 'No records.' });

    const paymentsRes = await client.query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid
       FROM payments WHERE student_id = $1 AND term_id = $2`,
      [student_id, inv.term_id]
    );

    const totalPaidForTerm = Number(paymentsRes.rows[0].total_paid);
    const invoiceAmount    = Number(inv.total_amount);
    const grandBalance     = invoiceAmount - totalPaidForTerm;

    const itemsRes = await client.query(
      `SELECT fee_name, amount, is_mandatory
       FROM student_invoice_items WHERE invoice_id = $1`,
      [inv.id]
    );

    res.json({
      summary: {
        term_name:           inv.term_name,
        term_id:             inv.term_id,
        total_paid:          totalPaidForTerm,
        grand_total_balance: grandBalance,
        current_term_total:  invoiceAmount,
      },
      current_term_breakdown: itemsRes.rows.map(item => ({
        fee_name:     item.fee_name,
        amount:       Number(item.amount),
        is_mandatory: item.is_mandatory,
      })),
    });

  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

exports.getStudentPayments = async (req, res, next) => {
  const { student_id } = req.params;
  const school_id = req.user.school_id;
  const client = await pool.connect();

  try {
    await assertStudentOwnership(client, student_id, school_id);

    const result = await client.query(
      `SELECT
         id, amount_paid, payment_method, reference, created_at,
         ROUND(
           COALESCE(
             (SELECT SUM(si.balance) FROM student_invoices si WHERE si.student_id = $1),
             0
           ) +
           COALESCE(
             SUM(amount_paid) OVER (
               ORDER BY created_at DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ),
             0
           ),
         2) AS balance_after
       FROM payments
       WHERE student_id = $1
         AND term_id NOT IN (
           SELECT id FROM academic_terms WHERE name = 'Opening Balance'
         )
       ORDER BY created_at DESC`,
      [student_id]
    );

    res.status(200).json(result.rows);

  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

exports.searchStudents = async (req, res, next) => {
  const { query } = req.query;
  const school_id = req.user.school_id;

  if (!query || query.trim().length < 1) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  try {
    const students = await pool.query(
      `SELECT id, full_name, admission_number
       FROM students
       WHERE school_id = $1
         AND (full_name ILIKE $2 OR admission_number ILIKE $2)
       LIMIT 10`,
      [school_id, `%${query.trim()}%`]
    );
    res.json(students.rows);
  } catch (err) {
    next(err);
  }
};

exports.getGeneralAudit = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT
         p.id, p.amount_paid, p.payment_method, p.reference, p.created_at,
         s.full_name,
         t.name AS term_name
       FROM payments p
       JOIN students s      ON p.student_id = s.id
       JOIN academic_terms t ON p.term_id   = t.id
       WHERE p.school_id = $1
         AND t.name != 'Opening Balance'
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [school_id]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
};

exports.getStudentStatement = async (req, res, next) => {
  const { student_id } = req.params;
  const school_id = req.user.school_id;
  const client = await pool.connect();

  try {
    await assertStudentOwnership(client, student_id, school_id);

    const result = await client.query(
      `SELECT
         t.id AS term_id, t.name, t.year, t.start_date, t.end_date,
         COALESCE((SELECT total_amount FROM student_invoices
                   WHERE term_id = t.id AND student_id = $1), 0) AS total_billed,
         COALESCE((SELECT balance FROM student_invoices
                   WHERE term_id = t.id AND student_id = $1), 0) AS balance,
         COALESCE((SELECT SUM(amount_paid) FROM payments
                   WHERE term_id = t.id AND student_id = $1), 0) AS total_paid,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id',     p.id,
             'amount', p.amount_paid,
             'method', p.payment_method,
             'ref',    p.reference,
             'date',   p.created_at
           ) ORDER BY p.created_at DESC)
           FROM payments p
           WHERE p.term_id = t.id AND p.student_id = $1
         ), '[]'::json) AS transactions
       FROM academic_terms t
       WHERE t.school_id = $2
       ORDER BY t.start_date DESC
       LIMIT 20`,
      [student_id, school_id]
    );

    res.status(200).json(result.rows);

  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

exports.getDetailedAudit = async (req, res, next) => {
  const { student_id } = req.params;
  const school_id = req.user.school_id;
  const client = await pool.connect();

  try {
    await assertStudentOwnership(client, student_id, school_id);

    const result = await client.query(
      `SELECT
         t.id AS term_id,
         t.name AS term_name,
         t.year,
         t.start_date,
         t.end_date,
         COALESCE(si.total_amount, 0) AS amount_billed,
         COALESCE(si.balance, 0)      AS term_closing_balance,
         COALESCE((
           SELECT SUM(amount_paid) FROM payments
           WHERE term_id = t.id AND student_id = $1
         ), 0) AS total_paid_this_term,
         COALESCE((
           SELECT json_agg(json_build_object(
             'amount', p.amount_paid,
             'method', p.payment_method,
             'ref',    p.reference,
             'date',   p.created_at
           ) ORDER BY p.created_at DESC)
           FROM payments p
           WHERE p.term_id = t.id AND p.student_id = $1
         ), '[]'::json) AS payment_history
       FROM academic_terms t
       LEFT JOIN student_invoices si
         ON si.term_id = t.id AND si.student_id = $1
       ORDER BY t.start_date DESC`,
      [student_id]
    );

    res.status(200).json(result.rows);

  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

// ── POST /api/finance/set-class-fee ──────────────────────────────────────────
// Body: { class_id, total_amount, term }  (term = "Term 1" / "Term 2" / "Term 3")
exports.setClassFee = async (req, res) => {
  const { class_id, total_amount, term } = req.body;
  const school_id = req.user.school_id || req.user.schoolId;

  if (!class_id || !total_amount || !term)
    return res.status(400).json({ error: 'class_id, total_amount and term are required' });

  try {
    const classRes = await pool.query(
      'SELECT academic_year FROM classes WHERE id = $1 AND school_id = $2',
      [class_id, school_id]
    );
    const academic_year = classRes.rows[0]?.academic_year || new Date().getFullYear();

    // Get or create a "Tuition Fee" item for this school
    let feeItemRes = await pool.query(
      `SELECT id FROM fee_items WHERE school_id = $1 AND name = 'Tuition Fee' LIMIT 1`,
      [school_id]
    );
    let feeItemId;
    if (feeItemRes.rows.length === 0) {
      const ni = await pool.query(
        `INSERT INTO fee_items (id, school_id, name, is_optional) VALUES ($1,$2,'Tuition Fee',false) RETURNING id`,
        [uuidv4(), school_id]
      );
      feeItemId = ni.rows[0].id;
    } else {
      feeItemId = feeItemRes.rows[0].id;
    }

    // Get or create fee structure for class+term+year
    let structureRes = await pool.query(
      `SELECT id FROM fee_structures WHERE school_id=$1 AND class_id=$2 AND term=$3 AND academic_year=$4`,
      [school_id, class_id, term, academic_year]
    );
    let structureId;
    if (structureRes.rows.length === 0) {
      const ns = await pool.query(
        `INSERT INTO fee_structures (id, school_id, class_id, academic_year, term) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [uuidv4(), school_id, class_id, academic_year, term]
      );
      structureId = ns.rows[0].id;
    } else {
      structureId = structureRes.rows[0].id;
    }

    // Delete old amount and insert new
    await pool.query(
      `DELETE FROM fee_structure_items WHERE fee_structure_id=$1 AND fee_item_id=$2`,
      [structureId, feeItemId]
    );
    await pool.query(
      `INSERT INTO fee_structure_items (id, fee_structure_id, fee_item_id, amount) VALUES ($1,$2,$3,$4)`,
      [uuidv4(), structureId, feeItemId, total_amount]
    );

    res.status(201).json({ success: true, message: 'Fee structure saved' });
  } catch (err) {
    console.error('[setClassFee]', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/finance/class-fees ───────────────────────────────────────────────
exports.getAdminClassFees = async (req, res) => {
  const school_id = req.user.school_id || req.user.schoolId;
  try {
    const result = await pool.query(
      `SELECT fs.id, fs.class_id, fs.term, fs.academic_year,
              c.class_name, c.stream_name,
              COALESCE(SUM(fsi.amount), 0) AS total_amount
       FROM fee_structures fs
       JOIN classes c ON c.id = fs.class_id
       LEFT JOIN fee_structure_items fsi ON fsi.fee_structure_id = fs.id
       WHERE fs.school_id = $1
       GROUP BY fs.id, fs.class_id, fs.term, fs.academic_year, c.class_name, c.stream_name
       ORDER BY c.class_name, c.stream_name, fs.term`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[getAdminClassFees]', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/finance/bulk-apply ──────────────────────────────────────────────
// Body: { class_id, term }
exports.bulkApplyFees = async (req, res) => {
  const { class_id, term } = req.body;
  const school_id = req.user.school_id || req.user.schoolId;

  if (!class_id || !term)
    return res.status(400).json({ error: 'class_id and term are required' });

  try {
    const classRes = await pool.query(
      'SELECT academic_year FROM classes WHERE id=$1 AND school_id=$2',
      [class_id, school_id]
    );
    const academic_year = classRes.rows[0]?.academic_year || new Date().getFullYear();

    const structureRes = await pool.query(
      `SELECT COALESCE(SUM(fsi.amount), 0) AS total_amount
       FROM fee_structures fs
       JOIN fee_structure_items fsi ON fsi.fee_structure_id = fs.id
       WHERE fs.school_id=$1 AND fs.class_id=$2 AND fs.term=$3 AND fs.academic_year=$4`,
      [school_id, class_id, term, academic_year]
    );
    const total_amount = parseFloat(structureRes.rows[0]?.total_amount || 0);
    if (total_amount === 0)
      return res.status(400).json({ error: 'No fee structure found. Set the fee first.' });

    const studentsRes = await pool.query(
      `SELECT id FROM students WHERE class_id=$1 AND school_id=$2 AND status='ACTIVE'`,
      [class_id, school_id]
    );
    if (studentsRes.rows.length === 0)
      return res.status(400).json({ error: 'No active students in this class' });

    let created = 0, skipped = 0;
    for (const s of studentsRes.rows) {
      const exists = await pool.query(
        `SELECT id FROM fee_invoices WHERE student_id=$1 AND academic_year=$2 AND term=$3`,
        [s.id, academic_year, term]
      );
      if (exists.rows.length > 0) { skipped++; continue; }
      await pool.query(
        `INSERT INTO fee_invoices (id, school_id, student_id, academic_year, term, total_amount, balance)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [uuidv4(), school_id, s.id, academic_year, term, total_amount]
      );
      created++;
    }

    res.json({ message: `Done — ${created} invoice(s) created, ${skipped} already existed.`, created, skipped });
  } catch (err) {
    console.error('[bulkApplyFees]', err.message);
    res.status(500).json({ error: err.message });
  }
};
