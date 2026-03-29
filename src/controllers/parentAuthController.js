// src/controllers/parentAuthController.js
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const sendOtpSms = require('../services/otpSmsService');
// src/controllers/parentAuthController.js

exports.requestParentAccess = async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) return res.status(400).json({ message: "Phone number required" });

    try {
        // DEBUG CHECK: Fetching school info
        const studentQuery = `
            SELECT s.school_id, sch.name AS school_name 
            FROM students s 
            JOIN schools sch ON s.school_id = sch.id 
            WHERE s.parent_phone = $1 AND s.status = 'ACTIVE' 
            LIMIT 1
        `;
        const studentCheck = await pool.query(studentQuery, [phoneNumber]);

        if (studentCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: "No active student found for this number." });
        }

        const { school_id, school_name } = studentCheck.rows[0];

        // Generate OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        await pool.query("DELETE FROM otp_verifications WHERE phone_number = $1", [phoneNumber]);
        await pool.query(
            "INSERT INTO otp_verifications (phone_number, otp_code) VALUES ($1, $2)",
            [phoneNumber, otp]
        );

        console.log(`[OTP] ${phoneNumber} -> ${otp}`); // keep for dev
await sendOtpSms(phoneNumber, otp); // 👈 send real SMS

        res.status(200).json({
            
    
        
success: true,
    schoolId: school_id,
    schoolName: school_name,
    message: "Verification code sent to your phone."
});
            

    } catch (err) {
        console.error("OTP ERROR:", err.message);
        res.status(500).json({ message: "Server error" });
    }
};
exports.verifyOtp = async (req, res) => {
    const { phoneNumber, otp } = req.body;

    try {
        // 1. Verify the OTP
        const verifyQuery = `
            SELECT * FROM otp_verifications 
            WHERE phone_number = $1 AND otp_code = $2
            AND created_at > NOW() - INTERVAL '2 minutes'
        `;
        const otpResult = await pool.query(verifyQuery, [phoneNumber, otp]);

        if (otpResult.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid or expired code." });
        }

        // 2. Fetch all kids + Class Names for this phone number
        const kidsQuery = `
            SELECT 
                s.id as student_id, 
                s.full_name, 
                s.school_id, 
                c.class_name,
                c.stream_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.parent_phone = $1 AND s.status = 'ACTIVE'
        `;
        const kidsResult = await pool.query(kidsQuery, [phoneNumber]);

        if (kidsResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "No students found." });
        }

        const school_id = kidsResult.rows[0].school_id;

        // 3. Create the Premium JWT
        const token = jwt.sign(
            { phoneNumber, schoolId: school_id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Cleanup OTP
        await pool.query("DELETE FROM otp_verifications WHERE phone_number = $1", [phoneNumber]);

        // 🔥 THE DEBUG BOOM: See exactly what Flutter receives
        console.log("------------------------------------------");
        console.log(`✅ AUTH SUCCESS: ${phoneNumber}`);
        console.log(`📦 SENDING ${kidsResult.rows.length} STUDENT(S) TO FRONTEND:`);
        console.table(kidsResult.rows); // This prints a beautiful table in your terminal
        console.log("------------------------------------------");
        
        // 4. Send to Flutter
        return res.status(200).json({ 
            success: true, 
            token: token,
            schoolId: school_id,
            students: kidsResult.rows 
        });

    } catch (err) {
        console.error("VERIFY ERROR:", err.message);
        res.status(500).json({ message: "Verification failed" });
    }
};