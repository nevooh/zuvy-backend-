const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// Apply opening balance to a student
exports.applyOpeningBalance = async (req, res) => {
    const school_id = req.user.school_id; // from auth middleware
    const { student_id, amount } = req.body;

    if (!student_id || amount === undefined) {
        return res.status(400).json({ error: "student_id and amount are required" });
    }

    try {
        // 1️⃣ Validate student exists in this school
        const studentCheck = await pool.query(
            `SELECT id FROM students WHERE id = $1 AND school_id = $2`,
            [student_id, school_id]
        );
        if (studentCheck.rowCount === 0) {
            return res.status(404).json({ error: "Student not found in your school" });
        }

        // 2️⃣ Find or create the dummy "Opening Balance" term
        let termResult = await pool.query(
            `SELECT id FROM academic_terms WHERE school_id = $1 AND name = 'Opening Balance' LIMIT 1`,
            [school_id]
        );

        let term_id;
        if (termResult.rowCount > 0) {
            term_id = termResult.rows[0].id;
        } else {
            const now = new Date();
            const start_date = now.toISOString().split('T')[0]; // today
            const end_date = start_date; // same day, dummy term
            const year = now.getFullYear();

            const insertTerm = await pool.query(
                `INSERT INTO academic_terms(id, school_id, name, year, start_date, end_date, is_active, is_locked, created_at)
                 VALUES($1, $2, $3, $4, $5, $6, false, true, NOW())
                 RETURNING id`,
                [uuidv4(), school_id, 'Opening Balance', year, start_date, end_date]
            );
            term_id = insertTerm.rows[0].id;
        }

        // 3️⃣ Insert student invoice
        const invoice_id = uuidv4();
        await pool.query(
            `INSERT INTO student_invoices(id, school_id, student_id, term_id, total_amount, balance, status, previous_balance_carried, created_at)
             VALUES($1, $2, $3, $4, $5, $6, 'UNPAID', 0, NOW())`,
            [invoice_id, school_id, student_id, term_id, amount, amount]
        );

        // 4️⃣ Insert student ledger entry
        await pool.query(
            `INSERT INTO student_ledger(id, student_id, term_id, type, amount, reference_type, reference_id, created_at)
             VALUES($1, $2, $3, 'DEBIT', $4, 'Opening Balance', $5, NOW())`,
            [uuidv4(), student_id, term_id, amount, invoice_id]
        );

        res.status(200).json({ message: "Opening balance applied successfully" });
    } catch (err) {
        console.error("OpeningBalance Error:", err);
        res.status(500).json({ error: err.message });
    }
};