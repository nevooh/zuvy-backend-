const pool = require('../config/db'); // Your existing Postgres pool
const { v4: uuidv4 } = require('uuid');

// ---------- Fee Items ----------
exports.createFeeItem = async (req, res) => {
  try {
    const { school_id, name, is_optional = false } = req.body;
    const result = await pool.query(
      `INSERT INTO fee_items (id, school_id, name, is_optional) VALUES ($1,$2,$3,$4) RETURNING *`,
      [uuidv4(), school_id, name, is_optional]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getFeeItems = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const result = await pool.query(
      `SELECT * FROM fee_items WHERE school_id = $1`,
      [schoolId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateFeeItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_optional } = req.body;
    const result = await pool.query(
      `UPDATE fee_items SET name=$1, is_optional=$2 WHERE id=$3 RETURNING *`,
      [name, is_optional, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteFeeItem = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM fee_items WHERE id=$1`, [id]);
    res.json({ message: 'Fee item deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------- Fee Structures ----------
exports.createFeeStructure = async (req, res) => {
  try {
    const { school_id, class_id, academic_year, term } = req.body;
    const result = await pool.query(
      `INSERT INTO fee_structures (id, school_id, class_id, academic_year, term) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [uuidv4(), school_id, class_id, academic_year, term]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getFeeStructures = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const result = await pool.query(
      `SELECT fs.*, c.class_name FROM fee_structures fs JOIN classes c ON c.id=fs.class_id WHERE fs.school_id=$1`,
      [schoolId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateFeeStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_locked } = req.body;
    const result = await pool.query(
      `UPDATE fee_structures SET is_locked=$1 WHERE id=$2 RETURNING *`,
      [is_locked, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------- Fee Structure Items ----------
exports.addItemsToStructure = async (req, res) => {
  try {
    const { id: structureId } = req.params;
    const { items } = req.body; // [{ fee_item_id, amount }]
    const results = [];
    for (const item of items) {
      const r = await pool.query(
        `INSERT INTO fee_structure_items (id, fee_structure_id, fee_item_id, amount) VALUES ($1,$2,$3,$4) RETURNING *`,
        [uuidv4(), structureId, item.fee_item_id, item.amount]
      );
      results.push(r.rows[0]);
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStructureItems = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT fsi.*, fi.name FROM fee_structure_items fsi JOIN fee_items fi ON fi.id=fsi.fee_item_id WHERE fsi.fee_structure_id=$1`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------- Invoice Generation ----------
exports.generateInvoices = async (req, res) => {
  try {
    const { classId, academicYear, term } = req.body;

    // 1. Get students in class
    const studentsRes = await pool.query(
      `SELECT id, school_id FROM students WHERE class_id=$1`,
      [classId]
    );
    const students = studentsRes.rows;

    // 2. Get fee structure + items
    const structureRes = await pool.query(
      `SELECT fs.id AS structure_id, fsi.fee_item_id, fsi.amount
       FROM fee_structures fs
       JOIN fee_structure_items fsi ON fs.id=fsi.fee_structure_id
       WHERE fs.class_id=$1 AND fs.academic_year=$2 AND fs.term=$3`,
      [classId, academicYear, term]
    );
    const structureItems = structureRes.rows;

    if (!structureItems.length) return res.status(400).json({ error: 'No fee structure found' });

    // 3. Create invoices
    const invoices = [];
    for (const student of students) {
      const totalAmount = structureItems.reduce((acc, i) => acc + Number(i.amount), 0);
      const invoiceRes = await pool.query(
        `INSERT INTO fee_invoices (id, school_id, student_id, academic_year, term, total_amount, balance) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [uuidv4(), student.school_id, student.id, academicYear, term, totalAmount, totalAmount]
      );
      const invoice = invoiceRes.rows[0];

      // 4. Insert invoice items
      for (const item of structureItems) {
        await pool.query(
          `INSERT INTO fee_invoice_items (id, invoice_id, fee_item_id, amount) VALUES ($1,$2,$3,$4)`,
          [uuidv4(), invoice.id, item.fee_item_id, item.amount]
        );
      }

      invoices.push(invoice);
    }

    res.json(invoices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ---------- Student Invoices ----------
exports.getStudentInvoices = async (req, res) => {
  try {
    const { studentId } = req.params;
    const invoicesRes = await pool.query(
      `SELECT fi.*, s.full_name FROM fee_invoices fi JOIN students s ON s.id=fi.student_id WHERE fi.student_id=$1`,
      [studentId]
    );
    res.json(invoicesRes.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------- Payments ----------
exports.recordPayment = async (req, res) => {
  try {
    const { invoice_id, amount_paid, payment_source, reference_number } = req.body;

    // 1. Insert payment
    const paymentRes = await pool.query(
      `INSERT INTO fee_payments (id, invoice_id, amount_paid, payment_source, payment_date, reference_number) VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING *`,
      [uuidv4(), invoice_id, amount_paid, payment_source, reference_number]
    );

    // 2. Update invoice balance
    await pool.query(
      `UPDATE fee_invoices SET balance=balance-$1 WHERE id=$2`,
      [amount_paid, invoice_id]
    );

    res.json(paymentRes.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------- Adjustments ----------
exports.applyAdjustment = async (req, res) => {
  try {
    const { invoice_id, amount, adjustment_type, reason, approved_by } = req.body;
    const adjRes = await pool.query(
      `INSERT INTO fee_adjustments (id, invoice_id, adjustment_type, amount, reason, approved_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [uuidv4(), invoice_id, adjustment_type, amount, reason, approved_by]
    );

    // 2. Update invoice balance
    const multiplier = adjustment_type === 'DISCOUNT' ? -1 : 1;
    await pool.query(
      `UPDATE fee_invoices SET balance=balance + $1 WHERE id=$2`,
      [amount * multiplier, invoice_id]
    );

    res.json(adjRes.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
