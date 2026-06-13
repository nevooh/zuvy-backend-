const { pool } = require('../config/db');

// GET /api/fees/students
// Returns all students with their invoice status for the active term
exports.getStudentFeeOverview = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const result = await pool.query(`
            SELECT 
                s.id              AS student_id,
                s.full_name,
                s.admission_number,
                c.class_name,
                c.stream_name,
                t.name            AS term_name,
                t.year            AS term_year,
                t.id              AS term_id,
                COALESCE(si.total_amount, 0)             AS total_amount,
                COALESCE(si.balance, 0)                  AS balance,
                COALESCE(si.previous_balance_carried, 0) AS previous_balance,
                COALESCE(si.status, 'UNPAID')            AS invoice_status,
                COALESCE(si.total_amount, 0) - COALESCE(si.balance, 0) AS amount_paid
            FROM students s
            JOIN classes c ON s.class_id = c.id
            JOIN academic_terms t ON t.school_id = $1 AND t.is_active = true
            LEFT JOIN student_invoices si 
                ON si.student_id = s.id AND si.term_id = t.id
            WHERE s.school_id = $1 AND s.status = 'ACTIVE'
            ORDER BY c.level_order ASC, c.class_name ASC, s.full_name ASC
        `, [school_id]);

        res.status(200).json({
            students: result.rows
        });
    } catch (err) {
        console.error('getStudentFeeOverview Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/fees/students/:studentId/history
// Returns full payment history for a single student across all terms
exports.getStudentPaymentHistory = async (req, res) => {
    const school_id = req.user.school_id;
    const { studentId } = req.params;
    try {
        // Student basic info
        const studentResult = await pool.query(`
            SELECT 
                s.id, s.full_name, s.admission_number,
                c.class_name, c.stream_name
            FROM students s
            JOIN classes c ON s.class_id = c.id
            WHERE s.id = $1 AND s.school_id = $2
        `, [studentId, school_id]);

        if (studentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // All invoices for this student
        const invoicesResult = await pool.query(`
            SELECT 
                si.id           AS invoice_id,
                CASE WHEN t.name = 'Opening Balance' THEN 'Arrears' ELSE t.name END AS term_name,
                t.year          AS term_year,
                si.total_amount,
                si.previous_balance_carried AS previous_balance,
                si.balance,
                si.status       AS invoice_status,
                si.total_amount - si.balance AS amount_paid,
                si.created_at
            FROM student_invoices si
            JOIN academic_terms t ON si.term_id = t.id
            WHERE si.student_id = $1 AND si.school_id = $2
            ORDER BY t.year DESC, t.start_date DESC
        `, [studentId, school_id]);

        // All payment transactions for this student
        const paymentsResult = await pool.query(`
            SELECT 
                p.id,
                p.amount_paid,
                p.payment_method,
                p.reference,
                p.created_at,
                t.name AS term_name,
                t.year AS term_year
            FROM payments p
            JOIN academic_terms t ON p.term_id = t.id
            WHERE p.student_id = $1 AND p.school_id = $2
              AND t.name != 'Opening Balance'
            ORDER BY p.created_at DESC
        `, [studentId, school_id]);

        res.status(200).json({
            student:  studentResult.rows[0],
            invoices: invoicesResult.rows,
            payments: paymentsResult.rows
        });
    } catch (err) {
        console.error('getStudentPaymentHistory Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/fees/summary
// School-level fee collection summary for the active term
exports.getFeeSummary = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const result = await pool.query(`
            SELECT
                t.name                          AS term_name,
                t.year                          AS term_year,
                COUNT(si.id)                    AS total_invoices,
                COALESCE(SUM(si.total_amount), 0)           AS total_billed,
                COALESCE(SUM(si.total_amount - si.balance), 0) AS total_collected,
                COALESCE(SUM(si.balance), 0)                AS total_outstanding,
                COUNT(si.id) FILTER (WHERE si.status = 'PAID')    AS paid_count,
                COUNT(si.id) FILTER (WHERE si.status = 'PARTIAL') AS partial_count,
                COUNT(si.id) FILTER (WHERE si.status = 'UNPAID')  AS unpaid_count
            FROM academic_terms t
            LEFT JOIN student_invoices si 
                ON si.term_id = t.id AND si.school_id = $1
            WHERE t.school_id = $1 AND t.is_active = true
            GROUP BY t.id, t.name, t.year
        `, [school_id]);

        res.status(200).json({
            summary: result.rows[0] || {
                term_name: null,
                term_year: null,
                total_invoices: 0,
                total_billed: 0,
                total_collected: 0,
                total_outstanding: 0,
                paid_count: 0,
                partial_count: 0,
                unpaid_count: 0
            }
        });
    } catch (err) {
        console.error('getFeeSummary Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};