const { randomUUID } = require('crypto');
const pool    = require('../config/db');
const sendSMS = require('../services/smsService');

// ─── LOGS ─────────────────────────────────────────────────────────────────────
exports.getLogs = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*,
              st.full_name,
              COALESCE(u.full_name,
                CASE WHEN s.sent_by = 'SYSTEM_AUTO' THEN 'System' ELSE 'Admin' END
              ) AS sent_by_name
       FROM sent_sms s
       JOIN students st ON s.student_id = st.id
       LEFT JOIN users u ON u.id::text = s.sent_by
       WHERE s.school_id = $1
       ORDER BY s.sent_at DESC
       LIMIT 500`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── STATS ────────────────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                                              AS total_all_time,
         COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW()))         AS total_this_month,
         COUNT(*) FILTER (WHERE sent_at >= date_trunc('week',  NOW()))         AS total_this_week,
         COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE)                       AS total_today,
         COUNT(*) FILTER (WHERE sent_by = 'SYSTEM_AUTO')                       AS auto_count,
         COUNT(*) FILTER (WHERE sent_by != 'SYSTEM_AUTO')                      AS bulk_count,
         COUNT(*) FILTER (WHERE status  = 'delivered')                         AS delivered_count,
         COUNT(*) FILTER (WHERE status  = 'failed')                            AS failed_count
       FROM sent_sms
       WHERE school_id = $1`,
      [req.user.school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DELIVERY REPORT WEBHOOK ──────────────────────────────────────────────────
// Africa's Talking calls this with form-encoded data (no auth header).
exports.handleDeliveryReport = async (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).send('Bad Request');

  const mapped =
    (status === 'Success' || status === 'Delivered')  ? 'delivered' :
    (status === 'Failed'  || status === 'Rejected')   ? 'failed'    : 'sent';

  try {
    await pool.query(
      `UPDATE sent_sms SET status = $1 WHERE at_message_id = $2`,
      [mapped, id]
    );
    res.status(200).send('OK');
  } catch (err) {
    console.error('Delivery report error:', err.message);
    res.status(200).send('OK'); // always 200 so AT doesn't retry infinitely
  }
};

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT auto_sms_enabled FROM school_profiles WHERE id = $1',
      [req.user.school_id]
    );
    res.json(result.rows[0] ?? { auto_sms_enabled: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.toggleAutoSMS = async (req, res) => {
  const { auto_sms_enabled } = req.body;
  try {
    await pool.query(
      `INSERT INTO school_profiles (id, auto_sms_enabled)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET auto_sms_enabled = $2`,
      [req.user.school_id, auto_sms_enabled]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
exports.getTemplates = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sms_templates
       WHERE school_id = $1 AND active = TRUE
       ORDER BY created_at DESC`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.editTemplate = async (req, res) => {
  const { id } = req.params;
  const { template_name, template_text } = req.body;
  if (!template_name || !template_text) {
    return res.status(400).json({ error: 'Name and text are required' });
  }
  try {
    const result = await pool.query(
      `UPDATE sms_templates
       SET template_name = $1, template_text = $2
       WHERE id = $3 AND school_id = $4 AND active = TRUE
       RETURNING *`,
      [template_name, template_text, id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE sms_templates SET active = FALSE WHERE id = $1 AND school_id = $2 RETURNING id`,
      [id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTemplate = async (req, res) => {
  const { template_name, template_text } = req.body;
  if (!template_name || !template_text) {
    return res.status(400).json({ error: 'Name and text are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO sms_templates
         (school_id, template_name, template_text, created_by, active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      [req.user.school_id, template_name, template_text, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setDefaultPaymentTemplate = async (req, res) => {
  const { template_id } = req.body;
  if (!template_id) return res.status(400).json({ error: 'Template ID required' });
  try {
    const result = await pool.query(
      `UPDATE school_profiles
       SET default_payment_template_id = $1
       WHERE id = $2
       RETURNING default_payment_template_id`,
      [template_id, req.user.school_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'School profile not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── SUPPORTED TAGS ───────────────────────────────────────────────────────────
exports.getSupportedTags = (req, res) => {
  res.json([
    { tag: '{{student_name}}', desc: 'Student full name' },
    { tag: '{{admission_no}}', desc: 'Admission number'  },
    { tag: '{{parent_name}}',  desc: 'Parent name'       },
    { tag: '{{grade}}',        desc: 'Class / grade'     },
    { tag: '{{balance}}',      desc: 'Fee balance'       },
    { tag: '{{date}}',         desc: "Today's date"      },
  ]);
};

// ─── STUDENT SEARCH ───────────────────────────────────────────────────────────
exports.searchStudents = async (req, res) => {
  const { query } = req.query;
  if (!query || query.trim().length < 1) {
    return res.status(400).json({ error: 'Query required' });
  }
  try {
    const result = await pool.query(
      `SELECT id, full_name, admission_number, parent_phone, parent_name,
              (SELECT class_name FROM classes WHERE id = s.class_id) AS class_name
       FROM students s
       WHERE school_id = $1
         AND status = 'ACTIVE'
         AND parent_phone IS NOT NULL
         AND (full_name ILIKE $2 OR admission_number ILIKE $2)
       LIMIT 10`,
      [req.user.school_id, `%${query.trim()}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── BULK SEND ────────────────────────────────────────────────────────────────
exports.sendBulkSMS = async (req, res) => {
  const { classIds, templateId, studentIds, minBalance, excludeNoInvoice } = req.body;
  const { school_id: schoolId, id: userId } = req.user;

  try {
    const tpl = await pool.query(
      'SELECT template_text FROM sms_templates WHERE id = $1 AND school_id = $2',
      [templateId, schoolId]
    );
    if (tpl.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    const templateText = tpl.rows[0].template_text;

    let students;

    if (studentIds && studentIds.length > 0) {
      const r = await pool.query(
        `SELECT DISTINCT ON (s.id)
           s.id, s.full_name, s.admission_number, s.parent_phone, s.parent_name,
           c.class_name,
           COALESCE(i.balance, 0) AS total_balance
         FROM students s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN student_invoices i ON i.student_id = s.id
         WHERE s.id = ANY($1::uuid[]) AND s.school_id = $2 AND s.status = 'ACTIVE'
         ORDER BY s.id, i.created_at DESC`,
        [studentIds, schoolId]
      );
      students = r.rows;
    } else {
      // excludeNoInvoice forces INNER JOIN; otherwise LEFT JOIN so students
      // with no invoice still appear (with balance = 0).
      const invoiceJoin = excludeNoInvoice ? 'JOIN' : 'LEFT JOIN';

      // Build the inner query: DISTINCT ON picks the MOST RECENT invoice per
      // student. The balance filter MUST live in the outer WHERE so it operates
      // on the already-deduplicated (current) balance, not on historical rows.
      const params = [schoolId];
      let innerWhere = '';

      if (classIds && !classIds.includes('all')) {
        params.push(classIds);
        innerWhere += ` AND s.class_id = ANY($${params.length}::uuid[])`;
      }

      let outerWhere = '';
      if (minBalance && minBalance > 0) {
        params.push(minBalance);
        outerWhere = `AND total_balance >= $${params.length}`;
      }

      const q = `
        SELECT sub.*
        FROM (
          SELECT DISTINCT ON (s.id)
            s.id, s.full_name, s.admission_number, s.parent_phone, s.parent_name,
            c.class_name,
            COALESCE(i.balance, 0) AS total_balance
          FROM students s
          JOIN classes c ON c.id = s.class_id
          ${invoiceJoin} student_invoices i ON i.student_id = s.id
          WHERE s.school_id = $1 AND s.status = 'ACTIVE'
          ${innerWhere}
          ORDER BY s.id, i.created_at DESC
        ) sub
        WHERE 1=1 ${outerWhere}
      `;

      const r = await pool.query(q, params);
      students = r.rows;
    }

    _processBulkSMS(students, templateText, schoolId, userId);

    res.json({
      success: true,
      count:   students.length,
      message: `Sending SMS to ${students.length} student(s).`,
    });
  } catch (err) {
    console.error('BULK SMS ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};
// ─── In sendBulkSMS background worker ────────────────────────────────────────
// Replace the AT-specific messageId extraction with Celcom's shape:
async function _processBulkSMS(students, templateText, schoolId, userId) {
  const batchId = randomUUID();
  console.log(`🚀 Bulk SMS started [batch ${batchId}]: ${students.length} messages`);

  for (const s of students) {
    if (!s.parent_phone) {
      console.log(`⚠️  Skipping ${s.full_name}: no phone`);
      continue;
    }

    const bal    = Number(s.total_balance);
    const balStr = bal < 0
      ? `Credit: KES ${Math.abs(bal).toLocaleString('en-KE')}`
      : `KES ${bal.toLocaleString('en-KE')}`;

    const msg = templateText
      .replace(/{{student_name}}/g, s.full_name         ?? '')
      .replace(/{{admission_no}}/g,  s.admission_number  ?? '')
      .replace(/{{parent_name}}/g,   s.parent_name       ?? '')
      .replace(/{{grade}}/g,         s.class_name        ?? '')
      .replace(/{{balance}}/g,       balStr)
      .replace(/{{date}}/g,          new Date().toLocaleDateString('en-GB'));

    try {
      const response       = await sendSMS(schoolId, s.parent_phone, msg);
      // Celcom: response.responses[0].messageid  (note: NOT messageId)
      const celcomMessageId = response?.responses?.[0]?.messageid ?? null;

      await pool.query(
        `INSERT INTO sent_sms
           (school_id, student_id, phone, message, sent_by, batch_id, status, celcom_message_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7)`,
        [schoolId, s.id, s.parent_phone, msg, userId, batchId, celcomMessageId]
      );

      console.log(`✅ Sent to ${s.full_name}`);
    } catch (err) {
      console.error(`❌ Failed for ${s.full_name}:`, err.message);

      await pool.query(
        `INSERT INTO sent_sms
           (school_id, student_id, phone, message, sent_by, batch_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'failed')`,
        [schoolId, s.id, s.parent_phone, msg, userId, batchId]
      ).catch(() => {});

      if (err.message.includes('Insufficient SMS Credits')) {
        console.log('🛑 Halted: wallet empty');
        break;
      }
    }
  }

  console.log(`🏁 Bulk SMS finished [batch ${batchId}]`);
}

// ─── AUTO-RECEIPT ENGINE ──────────────────────────────────────────────────────
exports.triggerAutoReceipt = async (schoolId, studentId, amountPaid) => {
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    const result = await pool.query(
      `SELECT
         s.full_name, s.admission_number, s.parent_phone, s.parent_name,
         c.class_name,
         i.balance AS current_balance,
         t.template_text
       FROM students s
       JOIN school_profiles p ON s.school_id = p.id
       JOIN sms_templates t   ON p.default_payment_template_id = t.id
       JOIN student_invoices i ON s.id = i.student_id
       JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1
         AND p.id = $2
         AND p.auto_sms_enabled = true
       ORDER BY i.created_at DESC
       LIMIT 1`,
      [studentId, schoolId]
    );

    if (result.rows.length === 0) return;

    const { full_name, admission_number, parent_phone, parent_name,
            class_name, current_balance, template_text } = result.rows[0];

    if (!parent_phone) return;

    const msg = template_text
      .replace(/{{student_name}}/g, full_name         ?? '')
      .replace(/{{admission_no}}/g,  admission_number  ?? '')
      .replace(/{{parent_name}}/g,   parent_name       ?? '')
      .replace(/{{grade}}/g,         class_name        ?? '')
      .replace(/{{amount}}/g,        `KES ${Number(amountPaid).toLocaleString('en-KE')}`)
      .replace(/{{balance}}/g,       `KES ${Number(current_balance).toLocaleString('en-KE')}`)
      .replace(/{{date}}/g,          new Date().toLocaleDateString('en-GB'));

    const response = await sendSMS(schoolId, parent_phone, msg);
    
    // ⭐ FIXED: Using Celcom message tracking instead of Africa's Talking
    const celcomMessageId = response?.responses?.[0]?.messageid ?? null;

    // ⭐ FIXED: Insert targets 'celcom_message_id' column inside the async function context
    await pool.query(
      `INSERT INTO sent_sms
         (school_id, student_id, phone, message, sent_by, status, celcom_message_id)
       VALUES ($1, $2, $3, $4, 'SYSTEM_AUTO', 'sent', $5)`,
      [schoolId, studentId, parent_phone, msg, celcomMessageId]
    );

    console.log(`✅ Auto-receipt sent to ${full_name}`);
  } catch (err) {
    console.error('🚨 Auto-receipt error:', err.message);
  }
};
