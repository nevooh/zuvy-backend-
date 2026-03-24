const pool = require('../config/db');

exports.getStudentPremiumLedger = async (req, res) => {
    const { studentId } = req.params;
    const { schoolId } = req.user; 

    try {
        const query = `
          WITH active_term AS (
    SELECT id, name as term_name, year, is_active 
    FROM academic_terms 
    WHERE school_id = $2 
    -- 🔥 MAGIC: Active first, otherwise the one that ends the latest
    ORDER BY is_active DESC, end_date DESC 
    LIMIT 1
)
            SELECT 
                s.id as student_id,
                s.full_name,
                c.class_name,
                c.stream_name,
                at.term_name,
                at.year as academic_year,
                
                -- FINANCIAL TOTALS
                COALESCE(si.total_amount, 0) as total_term_invoice,
                
                -- Calculate paid amount
                COALESCE(si.total_amount - si.balance, 0) as amount_paid_this_term,
                
                COALESCE(si.balance, 0) as current_outstanding_balance,
                
                -- ITEM BREAKDOWN
                (SELECT json_agg(items) FROM (
                    SELECT fee_name, amount 
                    FROM student_invoice_items 
                    WHERE invoice_id = si.id
                ) items) as fee_breakdown,

                -- PAYMENT HISTORY
                (SELECT json_agg(history) FROM (
                    SELECT amount_paid, payment_method, reference, created_at 
                    FROM payments 
                    WHERE student_id = s.id 
                    ORDER BY created_at DESC 
                    LIMIT 5
                ) history) as recent_payments

            FROM students s
            JOIN classes c ON s.class_id = c.id
            CROSS JOIN active_term at
            LEFT JOIN student_invoices si ON si.student_id = s.id AND si.term_id = at.id
            WHERE s.id = $1 AND s.school_id = $2;
        `;

        const result = await pool.query(query, [studentId, schoolId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "No financial records found. Ensure student is assigned to a class and an active term exists." 
            });
        }

        res.status(200).json({
            success: true,
            data: result.rows[0]
        });

    } catch (err) {
        // Keep this error log for system safety
        console.error("🔥 DATABASE CRASH:", err.message);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error." 
        });
    }
};