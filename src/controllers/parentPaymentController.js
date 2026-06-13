// Destructure 'pool' out of the object exported by db.js
const { pool } = require('../config/db');
const MpesaService = require('../services/mpesaService');
const smsController = require('./smsController');
const { assertParentOwnsStudent, isParentRole } = require('../utils/parentAccess');

function parsePositiveAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}
// 1. GET CHECKOUT SUMMARY
exports.getCheckoutSummary = async (req, res) => {
    try {
        const amount = parsePositiveAmount(req.body.amount);
        if (!amount) {
            return res.status(400).json({ success: false, message: "Valid amount required" });
        }
        const feePercent = 0.01; // change this one place only
        const serviceFee = amount * feePercent;
        const totalAmount = amount + serviceFee;

        res.status(200).json({
            success: true,
            data: {
                original_amount: amount,
                service_fee: serviceFee,
                fee_percentage: feePercent,  // 👈 send the actual number not a string
                total_amount: totalAmount
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error calculating summary" });
    }
};

exports.initiateFeePayment = async (req, res) => {
    const { phone, student_id } = req.body;
    const amount = parsePositiveAmount(req.body.amount);
    const schoolId = req.user.schoolId;

    try {
        if (!amount || !phone || !student_id) {
            return res.status(400).json({ success: false, message: "Amount, phone, and student_id are required" });
        }

        if (isParentRole(req)) {
            await assertParentOwnsStudent(pool, req, student_id);
        }

        // ✅ CHECK PAYBILL FIRST before doing anything
        const schoolCheck = await pool.query(
            `SELECT settlement_paybill FROM schools WHERE id = $1`,
            [schoolId]
        );

        if (!schoolCheck.rows[0]?.settlement_paybill) {
            return res.status(400).json({ 
                success: false, 
                code: 'NO_PAYBILL',
                message: "School has not set up M-Pesa payments yet. Please contact your school admin." 
            });
        }

        // --- DEBUG: LOG START ---
        console.log(`🚀 STK PUSH TRIGGERED: Student: ${student_id}, Phone: ${phone}, Amt: ${amount}`);

        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);

        const response = await MpesaService.initiateFeeSTKPush(
            amount, 
            formattedPhone, 
            student_id, 
            schoolId
        );

        const checkoutId = response.data.CheckoutRequestID;
        console.log(`✅ Safaricom Accepted: CheckoutID: ${checkoutId}`);

        await pool.query(
            "INSERT INTO mpesa_attempts (checkout_id, student_id, school_id, amount, status) VALUES ($1, $2, $3, $4, $5)",
            [checkoutId, student_id, schoolId, amount, 'PENDING']
        );

        res.status(200).json({ success: true, message: "Prompt sent to phone" });

    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ success: false, message: err.message });
        }
        console.error("❌ STK ERROR:", err.message);
        res.status(500).json({ success: false, message: "M-Pesa Service Unavailable" });
    }
};
exports.mpesaFeeCallback = async (req, res) => {
    const { Body } = req.body;
    const checkoutId = Body.stkCallback.CheckoutRequestID;

    if (Body.stkCallback.ResultCode === 0) {
        const metadata = Body.stkCallback.CallbackMetadata.Item;
        const amountPaid = metadata.find(i => i.Name === 'Amount').Value;
        const mpesaReceipt = metadata.find(i => i.Name === 'MpesaReceiptNumber').Value;

        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');

            // 1. RECOGNIZE STUDENT
            const feeAttempt = await client.query(
                "SELECT student_id, school_id FROM mpesa_attempts WHERE checkout_id = $1",
                [checkoutId]
            );

            if (feeAttempt.rows.length > 0) {
                const { student_id, school_id } = feeAttempt.rows[0];

                // 2. FETCH ACTIVE TERM & SYSTEM SETTINGS (B2B Logic added here)
                const config = await client.query(
                    `SELECT 
                        (SELECT id FROM academic_terms WHERE school_id = $1 ORDER BY is_active DESC, end_date DESC LIMIT 1) as term_id,
                        (SELECT commission_percent FROM system_settings LIMIT 1) as global_rate,
                        s.settlement_paybill, 
                        s.settlement_account 
                    FROM schools s WHERE s.id = $1`,
                    [school_id]
                );

                if (config.rows.length > 0 && config.rows[0].term_id) {
                    const { term_id, global_rate, settlement_paybill, settlement_account } = config.rows[0];

                    // 3. THE JUNCTION: Insert into payments
                    await client.query(
                        `INSERT INTO payments (student_id, term_id, school_id, amount_paid, payment_method, reference) 
                         VALUES ($1, $2, $3, $4, 'MPESA', $5)`,
                        [student_id, term_id, school_id, amountPaid, mpesaReceipt]
                    );

                    await client.query("UPDATE mpesa_attempts SET status = 'COMPLETED' WHERE checkout_id = $1", [checkoutId]);
                    
                    // COMMIT database changes first
                    await client.query('COMMIT');
                    console.log(`✅ Success: Payment for Student ${student_id} linked to Term ${term_id}`);

                   // 4. AUTOMATIC B2B SETTLEMENT
if (settlement_paybill) {
    const rate = (global_rate || 1.00) / 100;
    const myCut = amountPaid * rate;
    const amountToSend = Math.floor(amountPaid - myCut);

    MpesaService.initiateB2BSettlement(
        amountToSend, 
        settlement_paybill, 
        settlement_account
    ).then(async (b2bResponse) => {
        // ✅ FIXED: Access ConversationID directly from the response
        const conversationId = b2bResponse.ConversationID || b2bResponse.data?.ConversationID;

        if (conversationId) {
            await pool.query(
                `INSERT INTO disbursements (school_id, amount, conversation_id, status) 
                 VALUES ($1, $2, $3, 'PENDING')`,
                [school_id, amountToSend, conversationId]
            );
            console.log(`✅ Disbursement recorded: ConvID ${conversationId}`);
        } else {
            console.error("⚠️ B2B Success but no ConversationID found in response:", b2bResponse);
        }
    }).catch(err => console.error("❌ B2B Settlement Failed:", err.message));

    console.log(`💸 B2B Sent: KES ${amountToSend} to Paybill ${settlement_paybill}`);
}

                    // 5. SMS Receipt
                    smsController.triggerAutoReceipt(school_id, student_id, amountPaid)
                        .catch(e => console.error("SMS Error:", e.message));


                } else {
                    console.error("❌ Critical: Could not find ANY term for this school.");
                    await client.query('ROLLBACK');
                }
            } 
            // 6. SMS TOP-UP LOGIC (Kept exactly as you had it)
            else {
                const smsAttempt = await client.query(
                    "SELECT school_id FROM mpesa_sessions WHERE checkout_request_id = $1",
                    [checkoutId]
                );

                if (smsAttempt.rows.length > 0) {
                    const { school_id } = smsAttempt.rows[0];

                    await client.query(
                        `INSERT INTO sms_wallets (school_id, balance) 
                         VALUES ($1, $2) ON CONFLICT (school_id) 
                         DO UPDATE SET balance = sms_wallets.balance + $2`,
                        [school_id, amountPaid]
                    );

                    await client.query(
                        `INSERT INTO wallet_transactions (school_id, amount, transaction_type, description, reference_id) 
                         VALUES ($1, $2, 'topup', 'M-Pesa SMS Top-up', $3)`,
                        [school_id, amountPaid, mpesaReceipt]
                    );

                    await client.query("DELETE FROM mpesa_sessions WHERE checkout_request_id = $1", [checkoutId]);
                    
                    await client.query('COMMIT');
                    console.log(`✅ SMS Success: KES ${amountPaid} added to School ${school_id}`);
                } else {
                    console.log("⚠️ GHOST CALLBACK: No matching student fee or SMS session found.");
                    await client.query('ROLLBACK');
                }
            }
        } catch (err) {
            if (client) await client.query('ROLLBACK');
            console.error("🔥 Callback Error:", err.message);
        } finally {
            if (client) client.release();
        }
    }
    res.status(200).send("OK");
};
