const pool = require('../config/db');
const sendSMS = require('../services/smsService');

// --- FETCH ALL LOGS ---
exports.getLogs = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const result = await pool.query(
      `SELECT s.*, st.full_name FROM sent_sms s 
       JOIN students st ON s.student_id = st.id 
       WHERE s.school_id = $1 ORDER BY s.sent_at DESC`,
      [schoolId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT auto_sms_enabled FROM school_profiles WHERE id = $1',
      [req.user.school_id]
    );

    // If no row exists, return a default object so Flutter doesn't break
    if (result.rows.length === 0) {
      return res.json({ auto_sms_enabled: false });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.toggleAutoSMS = async (req, res) => {
  const { auto_sms_enabled } = req.body;
  const schoolId = req.user.school_id;

  console.log("DEBUG: POST /toggle-auto hit. New Value:", auto_sms_enabled, "for School:", schoolId);
  
  try {
    // This query: inserts a new row OR updates the existing one if 'id' matches
    const result = await pool.query(
      `INSERT INTO school_profiles (id, auto_sms_enabled) 
       VALUES ($1, $2) 
       ON CONFLICT (id) 
       DO UPDATE SET auto_sms_enabled = $2 
       RETURNING auto_sms_enabled`,
      [schoolId, auto_sms_enabled]
    );
    
    console.log("DEBUG: Success. Current DB state:", result.rows[0].auto_sms_enabled);
    res.json({ success: true, message: "Settings synced" });

  } catch (err) {
    console.error("DEBUG ERROR (toggleAutoSMS):", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
exports.sendBulkSMS = async (req, res) => {
  const { classIds, templateId } = req.body;
  const schoolId = req.user.school_id;
  const userId = req.user.id;

  try {
    // 1. Get Template Text
    const tpl = await pool.query(
      'SELECT template_text FROM sms_templates WHERE id = $1 AND school_id = $2', 
      [templateId, schoolId]
    );

    if (tpl.rows.length === 0) return res.status(404).json({ error: "Template not found" });
    const templateText = tpl.rows[0].template_text;

    // 2. Fetch Active Unique Students with the LATEST balance only
    let studentQuery = `
      SELECT DISTINCT ON (s.id)
        s.id, 
        s.full_name, 
        s.parent_phone, 
        c.class_name, 
        i.balance as total_balance 
      FROM students s
      JOIN classes c ON s.class_id = c.id
      JOIN student_invoices i ON s.id = i.student_id
      WHERE s.school_id = $1 
        AND s.status = 'ACTIVE'
    `;
    
    let queryParams = [schoolId];

    if (!classIds.includes('all')) {
      studentQuery += ` AND s.class_id = ANY($2::uuid[])`;
      queryParams.push(classIds);
    }

    // CRITICAL: DISTINCT ON requires ordering by the distinct column (s.id) first
    studentQuery += ` ORDER BY s.id, i.created_at DESC`;

    const result = await pool.query(studentQuery, queryParams);
    const students = result.rows;

    // 3. START BACKGROUND SENDING
    processBulkSMS(students, templateText, schoolId, userId);

    // 4. RESPOND TO FLUTTER IMMEDIATELY
    res.json({ 
      success: true, 
      count: students.length,
      message: `Bulk SMS started for ${students.length} students.`
    });

  } catch (err) {
    console.error("BULK SMS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// --- BACKGROUND WORKER ---
async function processBulkSMS(students, templateText, schoolId, userId) {
  console.log(`🚀 Starting Bulk Process: ${students.length} messages.`);
  
  for (const student of students) {
    if (!student.parent_phone) {
      console.log(`⚠️ Skipping ${student.full_name}: No phone number.`);
      continue;
    }

    try {
      // Logic for Clean Balance Display
      const bal = Number(student.total_balance);
      const balanceString = bal < 0 
        ? `Credit: ${Math.abs(bal).toLocaleString('en-KE')}` 
        : bal.toLocaleString('en-KE');

      // A. RESOLVE TAGS
      const finalMsg = templateText
        .replace(/{{student_name}}/g, student.full_name)
        .replace(/{{balance}}/g, balanceString)
        .replace(/{{date}}/g, new Date().toLocaleDateString('en-GB'))
        .replace(/{{grade}}/g, student.class_name);

      // B. SEND VIA AFRICA'S TALKING
      const sendSMS = require('../services/smsService'); 
      await sendSMS(schoolId, student.parent_phone, finalMsg); 

      // C. LOG TO DATABASE
      await pool.query(
        `INSERT INTO sent_sms (school_id, student_id, phone, message, sent_by) 
         VALUES ($1, $2, $3, $4, $5)`,
        [schoolId, student.id, student.parent_phone, finalMsg, userId]
      );
      
      console.log(`✅ Sent to ${student.full_name} | Balance: ${balanceString}`);

    } catch (e) {
      console.error(`❌ Failed to send to ${student.full_name}:`, e.message);

      if (e.message.includes("Insufficient SMS Credits")) {
        console.log("🛑 Bulk process halted: Wallet empty.");
        break; 
      }
    }
  }
  console.log(`🏁 Bulk SMS process finished for school ${schoolId}`);
}

// --- BACKGROUND WORKER ---
async function processBulkSMS(students, templateText, schoolId, userId) {
  console.log(`🚀 Starting Bulk Process: ${students.length} messages.`);
  
  for (const student of students) {
    if (!student.parent_phone) {
      console.log(`⚠️ Skipping ${student.full_name}: No phone number.`);
      continue;
    }

    try {
      // A. RESOLVE TAGS (This defines finalMsg so it's ready for use)
      const finalMsg = templateText
        .replace(/{{student_name}}/g, student.full_name)
        .replace(/{{balance}}/g, Math.abs(Number(student.total_balance)).toLocaleString('en-KE'))
        .replace(/{{date}}/g, new Date().toLocaleDateString('en-GB'))
        .replace(/{{grade}}/g, student.class_name);

      // B. SEND VIA AFRICA'S TALKING (Now with schoolId for the wallet check)
      await sendSMS(schoolId, student.parent_phone, finalMsg); 

      // C. LOG TO DATABASE
      await pool.query(
        `INSERT INTO sent_sms (school_id, student_id, phone, message, sent_by) 
         VALUES ($1, $2, $3, $4, $5)`,
        [schoolId, student.id, student.parent_phone, finalMsg, userId]
      );
      
      console.log(`✅ Sent to ${student.full_name}`);

    } catch (e) {
      console.error(`❌ Failed to send to ${student.full_name}:`, e.message);

      // If they run out of money mid-way, don't keep trying the rest
      if (e.message.includes("Insufficient SMS Credits")) {
        console.log("🛑 Bulk process halted: Wallet empty.");
        break; 
      }
    }
  }
  console.log(`🏁 Bulk SMS process finished for school ${schoolId}`);
}
// --- FETCH ALL TEMPLATES ---
exports.getTemplates = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sms_templates WHERE school_id = $1 AND active = TRUE ORDER BY created_at DESC',
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// --- CREATE NEW TEMPLATE ---
// --- CREATE NEW TEMPLATE (Updated with Logging) ---
exports.createTemplate = async (req, res) => {
  const { template_name, template_text } = req.body;
  const schoolId = req.user.school_id;
  const userId = req.user.id;

  // Validation: Don't allow empty saves
  if (!template_name || !template_text) {
    return res.status(400).json({ success: false, error: "Name and text are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sms_templates (school_id, template_name, template_text, created_by, active) 
       VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
      [schoolId, template_name, template_text, userId]
    );

    console.log("SUCCESS: Template Created:", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // This will tell you if it's a UUID error or a Foreign Key violation
    console.error("DATABASE ERROR (createTemplate):", err.detail || err.message);
    res.status(500).json({ 
      success: false, 
      error: "Database save failed. Check logs for UUID constraints." 
    });
  }
};
// smsController.js

exports.getSupportedTags = (req, res) => {
  // These are the "Real" tags that your backend resolveTags function will use
  const tags = [
    { "tag": "{{student_name}}", "desc": "Full Name" },
    { "tag": "{{admission_no}}", "desc": "Admission Number" },
    { "tag": "{{parent_name}}", "desc": "Parent Name" },
    { "tag": "{{grade}}", "desc": "Grade Level" },
    { "tag": "{{amount}}", "desc": "Payment Amount" },
    { "tag": "{{balance}}", "desc": "Fee Balance" },
    { "tag": "{{school_motto}}", "desc": "School Motto" },
    { "tag": "{{date}}", "desc": "Current Date" }
  ];
  res.json(tags);
};
// --- LINK TEMPLATE TO AUTO-RECEIPTS ---
exports.setDefaultPaymentTemplate = async (req, res) => {
  const { template_id } = req.body;
  const schoolId = req.user.school_id;

  if (!template_id) {
    return res.status(400).json({ success: false, error: "Template ID is required" });
  }

  try {
    const result = await pool.query(
      `UPDATE school_profiles 
       SET default_payment_template_id = $1 
       WHERE id = $2 
       RETURNING default_payment_template_id`,
      [template_id, schoolId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "School profile not found" });
    }

    console.log(`DEBUG: Default template for school ${schoolId} set to ${template_id}`);
    res.json({ 
      success: true, 
      message: "Default payment template linked successfully",
      data: result.rows[0] 
    });
  } catch (err) {
    console.error("DATABASE ERROR (setDefaultTemplate):", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
/// --- THE AUTOMATION ENGINE ---
// --- THE AUTOMATION ENGINE ---
exports.triggerAutoReceipt = async (schoolId, studentId, amountPaid) => {
  // 🕒 1. WAIT: Ensure the database has finished updating the invoice balance
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    // 2. FETCH: Get student info and the ACTUAL invoice balance
    const query = `
      SELECT 
        s.full_name, 
        s.parent_phone,
        i.balance AS current_balance,
        t.template_text
      FROM students s
      JOIN school_profiles p ON s.school_id = p.id
      JOIN sms_templates t ON p.default_payment_template_id = t.id
      JOIN student_invoices i ON s.id = i.student_id
      WHERE s.id = $1 
        AND p.id = $2 
        AND p.auto_sms_enabled = true
      ORDER BY i.created_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [studentId, schoolId]);

    if (result.rows.length === 0) {
      console.log("ℹ️ Auto-SMS skipped: No default template, balance zero, or SMS disabled.");
      return;
    }

    const { full_name, parent_phone, current_balance, template_text } = result.rows[0];

    if (!parent_phone) return console.log(`⚠️ No phone for ${full_name}`);

    // 3. FORMAT: Professional currency formatting
    const formattedAmount = Number(amountPaid).toLocaleString('en-KE');
    const formattedBalance = Number(current_balance).toLocaleString('en-KE');

    const finalMsg = template_text
      .replace(/{{student_name}}/g, full_name)
      .replace(/{{amount}}/g, formattedAmount)
      .replace(/{{balance}}/g, formattedBalance)
      .replace(/{{date}}/g, new Date().toLocaleDateString('en-GB'));

    // 4. SEND: Africa's Talking (VIA THE BILLING SERVICE)
    const sendSMS = require('../services/smsService'); 
    
    // ✅ FIX: Passing schoolId as the 1st argument to avoid the UUID error
    // This also triggers the automatic deduction from the school's wallet
    await sendSMS(schoolId, parent_phone, finalMsg);

    // 5. LOG: Save to history
    await pool.query(
      `INSERT INTO sent_sms (school_id, student_id, phone, message, sent_by) 
       VALUES ($1, $2, $3, $4, $5)`,
      [schoolId, studentId, parent_phone, finalMsg, 'SYSTEM_AUTO']
    );

    console.log(`✅ SUCCESS: Auto-SMS Sent to ${full_name} | Wallet Deducted | Balance: ${formattedBalance}`);
  } catch (err) {
    // This will now catch "Insufficient Balance" errors from the wallet check too
    console.error("🚨 SMS TRIGGER ERROR:", err.message);
  }
};