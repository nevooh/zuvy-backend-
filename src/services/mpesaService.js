const axios = require('axios');
const datetime = require('node-datetime');
const delay = ms => new Promise(res => setTimeout(res, ms));
class MpesaService {
    static async getOAuthToken() {
    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${key}:${secret}`).toString('base64');

    try {
        const mpesaBase = process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke';
        const response = await axios.get(
            `${mpesaBase}/oauth/v1/generate?grant_type=client_credentials&v=${Math.random()}`,
            { headers: { Authorization: `Basic ${auth}` } }
        );
        return response.data.access_token;
    } catch (error) {
        console.error("Mpesa Auth Error:", error.response?.data || error.message);
        throw new Error("M-Pesa Authentication Failed");
    }
}

    // 1. STK Push for SMS Credits
    static async initiateSTKPush(amount, phoneNumber, schoolId, callbackUrl = null) {
        const token = await this.getOAuthToken();
        const dt = datetime.create();
        const timestamp = dt.format('YmdHMS');

        // ✅ FIXED: Changed MPESA_SHORTCODE to MPESA_STK_SHORTCODE
        const password = Buffer.from(
            process.env.MPESA_STK_SHORTCODE + process.env.MPESA_PASSKEY + timestamp
        ).toString('base64');

        const data = {
            BusinessShortCode: process.env.MPESA_STK_SHORTCODE, // ✅ FIXED
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: process.env.MPESA_STK_SHORTCODE, // ✅ FIXED
            PhoneNumber: phoneNumber,
            CallBackURL: callbackUrl || process.env.MPESA_CALLBACK_URL,
            AccountReference: `School-${schoolId.substring(0, 5)}`,
            TransactionDesc: "SMS Credits Purchase"
        };

        return axios.post(
            `${process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/stkpush/v1/processrequest`,
            data,
            { headers: { Authorization: `Bearer ${token}` } }
        );
    }

    // 2. STK Push for School Fees
    static async initiateFeeSTKPush(amount, phoneNumber, studentId, schoolId) {
        const token = await this.getOAuthToken();
        const dt = datetime.create();
        const timestamp = dt.format('YmdHMS');
        
        // ✅ FIXED: Changed MPESA_SHORTCODE to MPESA_STK_SHORTCODE
        const password = Buffer.from(
            process.env.MPESA_STK_SHORTCODE + process.env.MPESA_PASSKEY + timestamp
        ).toString('base64');

        const data = {
            BusinessShortCode: process.env.MPESA_STK_SHORTCODE, // ✅ FIXED
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.round(amount), 
            PartyA: phoneNumber,
            PartyB: process.env.MPESA_STK_SHORTCODE, // ✅ FIXED
            PhoneNumber: phoneNumber,
            CallBackURL: process.env.MPESA_CALLBACK_URL,
            AccountReference: studentId.substring(0, 12),
            TransactionDesc: "School Fees Payment"
        };

        try {
            return await axios.post(
                `${process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/stkpush/v1/processrequest`,
                data,
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch (error) {
            console.error("❌ STK ERROR:", error.response?.data || error.message);
            throw error;
        }
    }

    // 3. B2B Settlement (The "Pay Out" Logic)
    static async initiateB2BSettlement(amount, schoolPaybill, schoolAccount) {
        try {
            // 🕒 Step 1: Small 2-second delay to ensure the Sandbox gateway is ready
            console.log("⏳ Waiting for fresh token session...");
            await delay(2000); 

            // 🔑 Step 2: Get a fresh token (using your new random-v logic)
            const token = await this.getOAuthToken();
            const url = `${process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/b2b/v1/paymentrequest`;

            const data = {
                "Initiator": process.env.MPESA_INITIATOR_NAME,
                "SecurityCredential": process.env.MPESA_SECURITY_CREDENTIAL,
                "CommandID": "BusinessPayBill", 
                "SenderIdentifierType": "4", // Shortcode
                "RecieverIdentifierType": "4", // Shortcode
                "Amount": Math.floor(amount), 
                "PartyA": process.env.MPESA_B2B_SHORTCODE, 
                "PartyB": schoolPaybill,
                "AccountReference": schoolAccount,
                "Remarks": "Automated Fee Settlement",
                "QueueTimeOutURL": `${process.env.BASE_URL}/api/mpesa/b2b/timeout`, 
                "ResultURL": `${process.env.BASE_URL}/api/mpesa/b2b/result`
            };

            console.log(`💸 B2B REQUEST: Sending ${data.Amount} from ${data.PartyA} to ${schoolPaybill}`);

            const response = await axios.post(url, data, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error) {
            // Log the full error to see if it's STILL a 404
            console.error("❌ B2B Settlement Failed:", error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = MpesaService;