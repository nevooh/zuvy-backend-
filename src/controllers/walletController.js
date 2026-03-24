const { pool } = require('../config/db');
const MpesaService = require('../services/mpesaService');

// 1. FETCH BALANCE
exports.getBalance = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const result = await pool.query(
            `SELECT balance FROM sms_wallets WHERE school_id = $1`, 
            [school_id]
        );
        res.json({ balance: result.rows[0]?.balance || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. GET SMS RATE
exports.getRate = async (req, res) => {
    res.json({ rate_per_sms: 2.0 });
};



// 4. TRANSACTION HISTORY
exports.getHistory = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const result = await pool.query(
            `SELECT * FROM wallet_transactions WHERE school_id = $1 ORDER BY created_at DESC`,
            [school_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 5. UPDATE SETTLEMENT (The "Steering Wheel")
exports.updateSettlementDetails = async (req, res) => {
    const { paybill, account } = req.body;
    const school_id = req.user.school_id;

    try {
        await pool.query(
            "UPDATE schools SET settlement_paybill = $1, settlement_account = $2 WHERE id = $3",
            [paybill, account, school_id]
        );
        res.status(200).json({ 
            success: true, 
            message: "Success! Your school's settlement details are now live." 
        });
    } catch (err) {
        console.error("❌ Settlement Update Error:", err.message);
        res.status(500).json({ success: false, message: "Failed to update settlement details" });
    }
};
// INITIATE: Fixed to use mpesa_sessions for memory
exports.initiateTopUp = async (req, res) => {
    let { amount, phoneNumber } = req.body;
    const school_id = req.user.school_id;

    let cleanPhone = phoneNumber.replace(/[\s\-\+]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '254' + cleanPhone.slice(1);
    else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) cleanPhone = '254' + cleanPhone;

    try {
        console.log(`🚀 Requesting STK Push: KES ${amount} to ${cleanPhone}`);
        const response = await MpesaService.initiateSTKPush(amount, cleanPhone, school_id);
        
        await pool.query(
            `INSERT INTO mpesa_sessions (checkout_request_id, school_id, amount) VALUES ($1, $2, $3)`,
            [response.data.CheckoutRequestID, school_id, amount]
        );

        res.status(200).json({ 
            success: true, 
            message: "M-Pesa prompt sent!",
            CheckoutRequestID: response.data.CheckoutRequestID 
        });
    } catch (err) {
        res.status(500).json({ error: "M-Pesa request failed" });
    }
};
exports.mpesaB2BResult = async (req, res) => {
    const { Result } = req.body;
    if (!Result) return res.status(400).send("Invalid Body");

    const conversationId = Result.ConversationID; 
    const resultCode = Result.ResultCode;
    const resultDesc = Result.ResultDesc;

  // Safaricom hides the Receipt Number in the ResultParameters array
    let receipt = null;
    if (Result.ResultParameters && Result.ResultParameters.ResultParameter) {
        const rawParams = Result.ResultParameters.ResultParameter;
        // ✅ Ensure it's an array so .find() doesn't crash
        const params = Array.isArray(rawParams) ? rawParams : [rawParams];
        
        const receiptObj = params.find(p => p.Key === 'TransactionReceipt');
        if (receiptObj) receipt = receiptObj.Value;
    }

    try {
        if (resultCode === 0) {
            console.log(`✅ B2B SUCCESS: [${receipt}] for Conv: ${conversationId}`);
            
            await pool.query(
                `UPDATE disbursements 
                 SET status = 'SUCCESS', 
                     mpesa_receipt = $1, 
                     result_desc = $2, 
                     updated_at = NOW() 
                 WHERE conversation_id = $3`, 
                [receipt, resultDesc, conversationId]
            );
        } else {
            console.error(`❌ B2B FAILED: ${resultDesc}`);
            
            await pool.query(
                `UPDATE disbursements 
                 SET status = 'FAILED', 
                     result_desc = $1, 
                     updated_at = NOW() 
                 WHERE conversation_id = $2`, 
                [resultDesc, conversationId]
            );
        }
    } catch (err) {
        console.error("🔥 DB Update Error:", err.message);
    }

    res.status(200).send("OK");
};
// 7. B2B TIMEOUT HANDLER
exports.mpesaB2BTimeout = (req, res) => {
    console.error("⏰ B2B Request Timed Out - Safaricom did not process in time.");
    res.status(200).send("OK");
};
// Example of how you trigger the B2B and track it
exports.processSchoolSettlement = async (schoolId, amount) => {
    // 1. Get school paybill/account from DB
    const school = await pool.query("SELECT settlement_paybill, settlement_account FROM schools WHERE id = $1", [schoolId]);
    const { settlement_paybill, settlement_account } = school.rows[0];

    try {
        // 2. Call M-Pesa
        const response = await MpesaService.initiateB2BSettlement(amount, settlement_paybill, settlement_account);
        
        // 3. Save the ConversationID so the Result Handler can find this record later
        const conversationId = response.data.ConversationID; 
        
        await pool.query(
            `INSERT INTO disbursements (school_id, amount, conversation_id, status) 
             VALUES ($1, $2, $3, 'PENDING')`,
            [schoolId, amount, conversationId]
        );

        return { success: true, conversationId };
    } catch (err) {
        console.error("B2B Initiation Error:", err.message);
        throw err;
    }
};