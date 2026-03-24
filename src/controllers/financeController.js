const { pool } = require('../config/db');
const smsController = require('./smsController');
exports.generateInvoice = async (req, res) => {
    // 🕵️ DEBUG 1: See exactly what Flutter sent
    console.log("📥 RECEIVED BODY:", JSON.stringify(req.body, null, 2));

    const { student_id, term_id, fees } = req.body;
    const school_id = req.user.school_id;

    // 🕵️ DEBUG 2: Check the total of fees before any processing
    if (fees && Array.isArray(fees)) {
        const checkTotal = fees.reduce((sum, f) => sum + Number(f.amount), 0);
        console.log("🧐 WHAT IS THE TOTAL OF FEES SENT FROM FLUTTER?:", checkTotal);
    }

    // Validation Check: Ensure we have the data needed to start the process
    if (!student_id || !term_id || !fees || !Array.isArray(fees)) {
        console.error("❌ VALIDATION FAILED: Missing fields or fees is not an array");
        return res.status(400).json({ error: "Invalid request data" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check for existing invoice to prevent double-billing
        const existingInvoice = await client.query(
            `SELECT id FROM student_invoices
             WHERE student_id = $1 AND term_id = $2`,
            [student_id, term_id]
        );

        if (existingInvoice.rowCount > 0) {
            throw new Error("Invoice already exists for this student and term.");
        }

        // ⚖️ NEW: Get the absolute truth from the Ledger (includes overpayments)
        // This calculates the net balance by subtracting Credits (payments) from Debits (charges)
        const ledgerBalanceResult = await client.query(
            `SELECT COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END) - 
                            SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) as balance
             FROM student_ledger 
             WHERE student_id = $1`,
            [student_id]
        );
        
        let previousBalance = Number(ledgerBalanceResult.rows[0].balance);
        console.log("⚖️ PREVIOUS LEDGER BALANCE:", previousBalance);
        
        // 1. Calculate ONLY this term's new fees first
        let currentTermFees = 0;
        fees.forEach(fee => {
            console.log(`  -> New Fee: ${fee.fee_name}, Amount: ${fee.amount}`);
            currentTermFees += Number(fee.amount);
        });

      // 2. THE PREMIUM MATH
let amountToBill = currentTermFees; // The current cost (14,750)
let finalBalance = currentTermFees + previousBalance; // The cost + old debt (e.g., 10,750)

// 3. Create the Invoice header record
const invoiceResult = await client.query(
    `INSERT INTO student_invoices
     (school_id, student_id, term_id, total_amount, balance)
     VALUES ($1, $2, $3, $4, $5) 
     RETURNING *`,
    [school_id, student_id, term_id, amountToBill, finalBalance] // Use $5 for the real balance!
);
        const invoice = invoiceResult.rows[0];

        // 4. Insert the individual new term fees into line items
        for (const fee of fees) {
            await client.query(
                `INSERT INTO student_invoice_items
                 (invoice_id, fee_name, amount, is_mandatory)
                 VALUES ($1, $2, $3, $4)`,
                [invoice.id, fee.fee_name, fee.amount, fee.is_mandatory ?? true]
            );
        }

       

        // 📝 Record ONLY the new term fees. The ledger's running balance handles the rest.
        console.log(`📝 ATTEMPTING LEDGER INSERT: Student: ${student_id}, New Fees: ${currentTermFees}`);
        
        await client.query(
            `INSERT INTO student_ledger
             (student_id, term_id, type, amount, reference_type, reference_id)
             VALUES ($1, $2, 'DEBIT', $3, 'INVOICE', $4)`,
            [student_id, term_id, currentTermFees, invoice.id]
        );

        await client.query('COMMIT');
        console.log("✅ TRANSACTION COMPLETE");

        res.status(201).json(invoice);

    } catch (err) {
        await client.query('ROLLBACK');
        // 🕵️ DEBUG 6: Catch exactly where the process failed
        console.error("🚨 INVOICE GENERATION ERROR:", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};
exports.postPayment = async (req, res) => {
    const { student_id, term_id, amount, method, reference } = req.body;
    const school_id = req.user.school_id;

    if (!student_id || !amount || !reference) {
        return res.status(400).json({ error: "Missing payment details" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Insert the payment record ONLY
        // The Database Trigger (handle_payment_logic) will now automatically:
        // - Insert into student_ledger
        // - Update student_invoices balance & status
        // - Update students overall fee_balance
        const paymentResult = await client.query(
            `INSERT INTO payments (student_id, term_id, school_id, amount_paid, payment_method, reference) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [student_id, term_id, school_id, amount, method, reference]
        );

        await client.query('COMMIT');
        
        console.log(`✅ Payment Recorded: KES ${amount} for Student ${student_id}. Trigger handled the rest.`);

        // 2. Trigger Auto-SMS (Background Task)
        smsController.triggerAutoReceipt(school_id, student_id, amount)
            .catch(err => console.error("Background SMS Error:", err.message));

        res.status(201).json({
            success: true,
            message: "Payment successful and balances updated",
            data: paymentResult.rows[0]
        });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error("Payment Error:", err.message);
        res.status(500).json({ error: "Server Error during payment processing" });
    } finally {
        client.release();
    }
};
exports.getStudentFinancialSummary = async (req, res) => {
    const { student_id } = req.params;
    const client = await pool.connect();

    try {
        // 1. Get the LATEST Invoice
        // 1. Get the LATEST Invoice (Using the new Hierarchy of Truth)
const invoiceRes = await client.query(
    `SELECT i.id, i.total_amount, t.name as term_name, t.id as term_id
     FROM student_invoices i
     JOIN academic_terms t ON i.term_id = t.id
     WHERE i.student_id = $1 
     -- Use the same logic as the list for total consistency
     ORDER BY 
        t.is_active DESC, 
        t.year DESC, 
        t.start_date DESC 
     LIMIT 1`,
    [student_id]
);

        const inv = invoiceRes.rows[0];
        if (!inv) return res.status(404).json({ message: "No records." });

        // 2. Calculate TOTAL PAID for this specific term
        // This is safer than using timestamps
        const paymentsRes = await client.query(
            `SELECT COALESCE(SUM(amount_paid), 0) as total_paid
             FROM payments 
             WHERE student_id = $1 AND term_id = $2`,
            [student_id, inv.term_id]
        );

        const totalPaidForTerm = Number(paymentsRes.rows[0].total_paid);
        const invoiceAmount = Number(inv.total_amount);
        
        // The Grand Balance is what's left of the invoice after payments
        const grandBalance = invoiceAmount - totalPaidForTerm;

        // 3. Get Breakdown
        const itemsRes = await client.query(
            `SELECT fee_name, amount, is_mandatory FROM student_invoice_items 
             WHERE invoice_id = $1`,
            [inv.id]
        );

        res.json({
            summary: {
                term_name: inv.term_name,
                term_id: inv.term_id,
                total_paid: totalPaidForTerm, 
                grand_total_balance: grandBalance,
                current_term_total: invoiceAmount,
            },
            current_term_breakdown: itemsRes.rows.map(item => ({
                fee_name: item.fee_name,
                amount: Number(item.amount),
                is_mandatory: item.is_mandatory
            }))
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};
// GET /api/finance/payments/:student_id
exports.getStudentPayments = async (req, res) => {
    const { student_id } = req.params;
    const client = await pool.connect();

    try {
        // We query exactly the columns in your psql \d+ output
        const result = await client.query(
            `SELECT 
                id, 
                amount_paid, 
                payment_method, 
                reference, 
                created_at 
             FROM payments 
             WHERE student_id = $1 
             ORDER BY created_at DESC`,
            [student_id]
        );

        // Return the array of payments
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("🚨 FETCH PAYMENTS ERROR:", err.message);
        res.status(500).json({ error: "Failed to fetch payment history" });
    } finally {
        client.release();
    }
};
exports.searchStudents = async (req, res) => {
    try {
        const { query } = req.query;
        // ✅ FIX: Use 'full_name' instead of first/last name
        const students = await pool.query(
            `SELECT id, full_name, admission_number 
             FROM students 
             WHERE full_name ILIKE $1 
             OR admission_number ILIKE $1 
             LIMIT 10`,
            [`%${query}%`]
        );
        res.json(students.rows);
    } catch (err) {
        console.error("Search Error:", err.message);
        res.status(500).json({ error: "Search failed" });
    }
};


exports.getGeneralAudit = async (req, res) => {
    try {
        const { school_id } = req.user; 

        const query = `
            SELECT 
                p.id, 
                p.amount_paid, 
                p.payment_method, 
                p.reference,
                p.created_at,
                s.full_name,  -- ✅ Corrected column name
                t.name as term_name
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN academic_terms t ON p.term_id = t.id
            WHERE p.school_id = $1
            ORDER BY p.created_at DESC
            LIMIT 50;
        `;

        const result = await pool.query(query, [school_id]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("🚨 GENERAL AUDIT ERROR:", err.message);
        res.status(500).json({ error: "Failed to fetch live audit feed" });
    }
};
exports.getStudentStatement = async (req, res) => {
    const { student_id } = req.params;
    const client = await pool.connect();
    try {
        const query = `
            SELECT t.id AS term_id, t.name, t.year, t.start_date, t.end_date,
            -- 🚀 JOYRIDING THE BILLING DATA HERE
            COALESCE((SELECT total_amount FROM student_invoices WHERE term_id = t.id AND student_id = $1), 0) AS total_billed,
            COALESCE((SELECT balance FROM student_invoices WHERE term_id = t.id AND student_id = $1), 0) AS balance,
            
            COALESCE((SELECT SUM(amount_paid) FROM payments WHERE term_id = t.id AND student_id = $1), 0) AS total_paid,
            COALESCE((SELECT json_agg(json_build_object(
                'id', p.id, 'amount', p.amount_paid, 'method', p.payment_method,
                'ref', p.reference, 'date', p.created_at
            ) ORDER BY p.created_at DESC) FROM payments p WHERE p.term_id = t.id AND p.student_id = $1), '[]'::json) AS transactions
            FROM academic_terms t 
            ORDER BY t.start_date DESC LIMIT 4;`;
            
        const result = await client.query(query, [student_id]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Statement Error:", err);
        res.status(500).json({ error: "Statement failed" });
    } finally { client.release(); }
};

exports.getDetailedAudit = async (req, res) => {
    const { student_id } = req.params;
    const client = await pool.connect();
    try {
        const query = `
            SELECT 
                t.id AS term_id, 
                t.name AS term_name, 
                t.year, 
                t.start_date,
                t.end_date,
                -- The "Billing" side
                COALESCE(si.total_amount, 0) AS amount_billed,
                COALESCE(si.balance, 0) AS term_closing_balance,
                -- The "Payment" side
                COALESCE((SELECT SUM(amount_paid) FROM payments WHERE term_id = t.id AND student_id = $1), 0) AS total_paid_this_term,
                -- The "Proof" (Detailed list of payments for this specific term)
                COALESCE((
                    SELECT json_agg(json_build_object(
                        'amount', p.amount_paid, 
                        'method', p.payment_method,
                        'ref', p.reference, 
                        'date', p.created_at
                    ) ORDER BY p.created_at DESC) 
                    FROM payments p 
                    WHERE p.term_id = t.id AND p.student_id = $1
                ), '[]'::json) AS payment_history
            FROM academic_terms t
            LEFT JOIN student_invoices si ON si.term_id = t.id AND si.student_id = $1
            ORDER BY t.start_date DESC;`;

        const result = await client.query(query, [student_id]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Audit Error:", err);
        res.status(500).json({ error: "Could not fetch audit trail" });
    } finally {
        client.release();
    }
};