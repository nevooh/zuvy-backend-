const pool = require('../../config/analyticsPool');
const sendSMS = require('../../services/smsService');

function formatPhone(phone) {
  let p = (phone || '').trim();
  if (p.startsWith('0'))        p = '+254' + p.slice(1);
  else if (p.startsWith('254')) p = '+' + p;
  else if (!p.startsWith('+'))  p = '+254' + p;
  return p;
}

// â”€â”€ build results message per student â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function buildResultsMessage(studentId, examId, format, schoolPhone) {
  const examRes = await pool.query(
    `SELECT e.name, e.max_score FROM exams e WHERE e.id=$1`,
    [examId]
  );
  const exam = examRes.rows[0];

  const studentRes = await pool.query(
    `SELECT s.full_name, s.parent_name, s.admission_number,
            c.class_name
     FROM students s JOIN classes c ON c.id=s.class_id
     WHERE s.id=$1`,
    [studentId]
  );
  const student = studentRes.rows[0];

  const resultsRes = await pool.query(
    `SELECT sub.name, sub.code, r.score, r.max_score, r.grade, r.points
     FROM results r
     JOIN subjects sub ON sub.id=r.subject_id
     WHERE r.student_id=$1 AND r.exam_id=$2
     ORDER BY sub.is_core DESC, sub.name`,
    [studentId, examId]
  );
  const subjects = resultsRes.rows;

  if (subjects.length === 0) return null;

  const totalScore = subjects.reduce((s, r) => s + parseFloat(r.score||0), 0);
  const totalMax   = subjects.reduce((s, r) => s + parseFloat(r.max_score||0), 0);
  const pct        = totalMax > 0 ? (totalScore/totalMax*100).toFixed(1) : 0;

  // get position
  const posRes = await pool.query(
    `SELECT COUNT(*)+1 as pos FROM (
       SELECT r2.student_id,
         SUM(r2.score)/NULLIF(SUM(r2.max_score),0)*100 as p
       FROM results r2
       JOIN students s2 ON s2.id=r2.student_id
       WHERE s2.class_id=(SELECT class_id FROM students WHERE id=$1)
       AND r2.exam_id=$2 AND r2.max_score>0
       GROUP BY r2.student_id
       HAVING SUM(r2.score)/NULLIF(SUM(r2.max_score),0)*100>$3
     ) better`,
    [studentId, examId, pct]
  );
  const totalStudentsRes = await pool.query(
    `SELECT COUNT(DISTINCT r.student_id) as total
     FROM results r JOIN students s ON s.id=r.student_id
     WHERE s.class_id=(SELECT class_id FROM students WHERE id=$1)
     AND r.exam_id=$2`,
    [studentId, examId]
  );
  const position     = posRes.rows[0]?.pos || 1;
  const totalStudents = totalStudentsRes.rows[0]?.total || 1;

  if (format === 'short') {
    // SHORT: fits in ~160 chars
    const subLine = subjects
      .map(s => `${(s.code||s.name).substring(0,3).toUpperCase()}:${parseFloat(s.score||0).toFixed(0)}${s.grade ? `(${s.grade})` : ''}`)
      .join(' ');
    return `${exam.name}|${student.full_name.split(' ')[0]}:${student.class_name}\n${subLine}\nTot:${parseFloat(totalScore).toFixed(0)}/${parseFloat(totalMax).toFixed(0)}(${pct}%) Pos:${position}/${totalStudents}`;
  } else {
    // FULL: detailed, may be 2-3 SMS
    const subLines = subjects
      .map(s => `${s.name}: ${parseFloat(s.score||0).toFixed(0)}/${parseFloat(s.max_score||0).toFixed(0)}${s.grade ? ` - ${s.grade}` : ''}`)
      .join('\n');
    return `Dear ${student.parent_name||'Parent'}, ${student.full_name} - ${exam.name}:\n${subLines}\nTotal: ${parseFloat(totalScore).toFixed(0)}/${parseFloat(totalMax).toFixed(0)} (${pct}%)\nPosition: ${position}/${totalStudents}\n${schoolPhone ? `Call: ${schoolPhone}` : ''}`.trim();
  }
}

// â”€â”€ build attendance message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildAttendanceMessage(student, date, schoolPhone, template, termInfo) {
  const d = date || new Date().toLocaleDateString('en-KE');
  const termName  = termInfo?.name  || '';
  const termDates = termInfo?.dates || '';
  const termPct   = termInfo?.pct   != null ? `${termInfo.pct}%` : '';
  if (template) {
    return template
      .replace(/{student_name}/g, student.full_name)
      .replace(/{parent_name}/g, student.parent_name||'Parent')
      .replace(/{class}/g, `${student.class_name} ${student.stream_name||''}`.trim())
      .replace(/{date}/g, d)
      .replace(/{term_name}/g, termName)
      .replace(/{term_dates}/g, termDates)
      .replace(/{term_attendance_pct}/g, termPct)
      .replace(/{school_phone}/g, schoolPhone||'');
  }
  const termClause = termName ? ` this ${termName}${termDates ? ` (${termDates})` : ''}` : '';
  const pctClause  = termPct  ? ` Attendance${termClause}: ${termPct}.` : '';
  return `Dear ${student.parent_name||'Parent'}, ${student.full_name} was ABSENT on ${d}.${pctClause} Please call ${schoolPhone||'the school'} for follow-up.`;
}

// â”€â”€ build fee message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildFeeMessage(student, balance, dueDate, schoolPhone, template) {
  const bal = `KES ${parseFloat(balance||0).toLocaleString('en-KE', {minimumFractionDigits: 2})}`;
  if (template) {
    return template
      .replace(/{student_name}/g, student.full_name)
      .replace(/{parent_name}/g, student.parent_name||'Parent')
      .replace(/{class}/g, `${student.class_name} ${student.stream_name||''}`.trim())
      .replace(/{balance}/g, bal)
      .replace(/{due_date}/g, dueDate||'')
      .replace(/{school_phone}/g, schoolPhone||'');
  }
  return `Dear ${student.parent_name||'Parent'}, ${student.full_name} (${student.class_name}) has an outstanding balance of ${bal}. Please pay by ${dueDate||'end of term'}. Call: ${schoolPhone||'school'}.`;
}

// â”€â”€ GET /sms/templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getTemplates = async (req, res) => {
  const school_id = req.school_id;
  try {
    const result = await pool.query(
      `SELECT * FROM sms_templates
       WHERE school_id=(SELECT id FROM school_profiles WHERE school_id=$1)
       AND active=true ORDER BY created_at DESC`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.createTemplate = async (req, res) => {
  const school_id = req.school_id;
  const { template_name, template_text } = req.body;
  try {
    const profileRes = await pool.query(
      `SELECT id FROM school_profiles WHERE school_id=$1`, [school_id]);
    const profile_id = profileRes.rows[0]?.id;
    if (!profile_id) return res.status(404).json({ error: 'Profile not found' });
    const reg = /{(\w+)}/g;
    const vars = [];
    let m;
    while ((m = reg.exec(template_text)) !== null) {
      if (!vars.includes(m[1])) vars.push(m[1]);
    }
    const result = await pool.query(
      `INSERT INTO sms_templates(school_id,template_name,template_text,variables)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [profile_id, template_name, template_text, vars]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteTemplate = async (req, res) => {
  try {
    await pool.query(`UPDATE sms_templates SET active=false WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// â”€â”€ GET /sms/exams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getExams = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query;
  try {
    const result = await pool.query(
      `SELECT id, name, exam_type, level_type, start_date FROM exams
       WHERE school_id=$1 ${level ? 'AND level_type=$2' : ''}
       ORDER BY created_at DESC`,
      level ? [school_id, level] : [school_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// â”€â”€ GET /sms/students/search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.searchStudents = async (req, res) => {
  const school_id = req.school_id;
  const { q, level } = req.query;
  try {
    const result = await pool.query(
      `SELECT s.id, s.full_name, s.admission_number,
              s.parent_name, s.parent_phone,
              c.class_name, c.stream_name
       FROM students s JOIN classes c ON c.id=s.class_id
       WHERE s.school_id=$1 AND s.status='ACTIVE'
       AND s.parent_phone IS NOT NULL
       ${level ? 'AND c.level_type=$3' : ''}
       AND (s.full_name ILIKE $2 OR s.admission_number ILIKE $2)
       ORDER BY s.full_name LIMIT 20`,
      level ? [school_id, `%${q}%`, level] : [school_id, `%${q}%`]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// â”€â”€ GET /sms/recipients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getRecipients = async (req, res) => {
  const school_id = req.school_id;
  const { target, class_id, level, exam_id } = req.query;
  try {
    let query = `
      SELECT s.id, s.full_name, s.parent_name,
             s.parent_phone, s.admission_number,
             c.class_name, c.stream_name, c.level_type
      FROM students s JOIN classes c ON c.id=s.class_id
      WHERE s.school_id=$1 AND s.status='ACTIVE'
      AND s.parent_phone IS NOT NULL AND s.parent_phone!=''
    `;
    const params = [school_id];

    if (target === 'class' && class_id) {
      params.push(class_id);
      query += ` AND s.class_id=$${params.length}`;
    } else if (target === 'level' && level) {
      params.push(level);
      query += ` AND c.level_type=$${params.length}`;
    } else if (target === 'absentees') {
      const today = new Date().toISOString().split('T')[0];
      params.push(today);
      query += ` AND EXISTS(SELECT 1 FROM attendance a
        WHERE a.student_id=s.id AND a.date=$${params.length} AND a.status='absent')`;
    } else if (target === 'below_average') {
      query += ` AND s.id IN(
        SELECT r.student_id FROM results r WHERE r.school_id=$1
        GROUP BY r.student_id
        HAVING AVG(r.score/NULLIF(r.max_score,0)*100)<50)`;
    } else if (target === 'exam_results' && exam_id) {
      params.push(exam_id);
      query += ` AND EXISTS(SELECT 1 FROM results r
        WHERE r.student_id=s.id AND r.exam_id=$${params.length})`;
    }
    query += ` ORDER BY c.level_order, s.full_name`;
    const result = await pool.query(query, params);

    // enrich with balance
    const rows = result.rows;
    for (const s of rows) {
      try {
        const b = await pool.query(
          `SELECT COALESCE(SUM(credit-debit),0) as balance
           FROM student_ledger WHERE student_id=$1`, [s.id]);
        s.balance = b.rows[0]?.balance || 0;
      } catch (_) { s.balance = 0; }
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// â”€â”€ POST /sms/preview-results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// preview what one student's results SMS will look like
exports.previewResults = async (req, res) => {
  const { student_id, exam_id, format } = req.body;
  const school_id = req.school_id;
  try {
    const schoolRes = await pool.query(
      `SELECT sp.phone_primary FROM school_profiles sp WHERE sp.school_id=$1`,
      [school_id]
    );
    const schoolPhone = schoolRes.rows[0]?.phone_primary || '';
    const msg = await buildResultsMessage(student_id, exam_id, format||'short', schoolPhone);
    if (!msg) return res.json({ message: null, chars: 0, sms_count: 0 });
    res.json({
      message:   msg,
      chars:     msg.length,
      sms_count: Math.ceil(msg.length / 160),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// â”€â”€ POST /sms/send â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.sendSms = async (req, res) => {
  const school_id = req.school_id;
  const {
    sms_type,
    recipients,
    template_text,
    exam_id,
    results_format,
    scheduled_at,
    due_date,
    template_id,
  } = req.body;

  try {
    const schoolRes = await pool.query(
      `SELECT s.name as school_name, sp.phone_primary, sp.id as profile_id
       FROM schools s LEFT JOIN school_profiles sp ON sp.school_id=s.id
       WHERE s.id=$1`, [school_id]
    );
    const school      = schoolRes.rows[0] || {};
    const profile_id  = school.profile_id;
    const schoolPhone = school.phone_primary || '';
    const today       = new Date().toLocaleDateString('en-KE');

    // get recipient list
    let recList = recipients || [];

    // for results â€” get all students who have results in this exam
    if (sms_type === 'results' && exam_id && recList.length === 0) {
      const studRes = await pool.query(
        `SELECT DISTINCT s.id, s.full_name, s.parent_name,
                s.parent_phone, s.admission_number,
                c.class_name, c.stream_name
         FROM results r JOIN students s ON s.id=r.student_id
         JOIN classes c ON c.id=s.class_id
         WHERE r.exam_id=$1 AND r.school_id=$2
         AND s.parent_phone IS NOT NULL`,
        [exam_id, school_id]
      );
      recList = studRes.rows;
    }

    if (recList.length === 0) {
      return res.status(400).json({ error: 'No recipients' });
    }

    // â”€â”€ BALANCE CHECK BEFORE SENDING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const walletRes = await pool.query(
      `SELECT balance FROM sms_wallets WHERE school_id=$1`,
      [school_id]
    );
    const walletBalance = parseFloat(walletRes.rows[0]?.balance || 0);
    const SMS_RATE = 2;
    const estimatedSms = recList.length;
    const estimatedCost = estimatedSms * SMS_RATE;

    if (walletBalance < estimatedCost) {
      const canAfford = Math.floor(walletBalance / SMS_RATE);
      return res.status(402).json({
        error: `Insufficient SMS balance. You need KES ${estimatedCost.toFixed(2)} but have KES ${walletBalance.toFixed(2)}. You can send to ${canAfford} recipient${canAfford === 1 ? '' : 's'}.`,
        balance: walletBalance,
        required: estimatedCost,
        can_afford: canAfford,
      });
    }

    const out = { sent: 0, failed: 0, scheduled: 0, errors: [] };

    for (const r of recList) {
      let msg = '';

      if (sms_type === 'results') {
        msg = await buildResultsMessage(
          r.id, exam_id, results_format || 'short', schoolPhone);
        if (!msg) continue;
      } else if (sms_type === 'fee') {
        msg = buildFeeMessage(r, r.balance || 0, due_date, schoolPhone, template_text);
      } else if (sms_type === 'attendance') {
        msg = buildAttendanceMessage(r, today, schoolPhone, template_text);
      } else {
        msg = (template_text || '')
          .replace(/{student_name}/g, r.full_name || '')
          .replace(/{parent_name}/g, r.parent_name || 'Parent')
          .replace(/{class}/g, `${r.class_name || ''} ${r.stream_name || ''}`.trim())
          .replace(/{admission_no}/g, r.admission_number || '')
          .replace(/{school_name}/g, school.school_name || '')
          .replace(/{school_phone}/g, schoolPhone)
          .replace(/{date}/g, today)
          .replace(/{balance}/g, r.balance != null ? `KES ${parseFloat(r.balance).toLocaleString()}` : '0');
      }

      if (!msg) continue;

      const phone = formatPhone(r.parent_phone);

     if (scheduled_at) {
  await pool.query(
    `INSERT INTO sent_sms(school_id,student_id,phone,message,
     template_id,status,sms_type,scheduled_at,recipient_count)
     VALUES($1,$2,$3,$4,$5,'scheduled',$6,$7,1)`,
    [profile_id, r.id, r.parent_phone, msg,
     template_id || null, sms_type, scheduled_at]
  );
  out.scheduled++;
} else {
  try {
    const response = await sendSMS(school_id, phone, msg);
    const celcomMessageId = response?.responses?.[0]?.messageid ?? null;
    await pool.query(
      `INSERT INTO sent_sms(school_id,student_id,phone,message,
       template_id,status,sms_type,recipient_count,celcom_message_id)
       VALUES($1,$2,$3,$4,$5,'sent',$6,1,$7)
       ON CONFLICT DO NOTHING`,
      [profile_id, r.id, r.parent_phone, msg,
       template_id || null, sms_type, celcomMessageId]
    );
    out.sent++;
  } catch (smsErr) {
    await pool.query(
      `INSERT INTO sent_sms(school_id,student_id,phone,message,
       template_id,status,sms_type,recipient_count)
       VALUES($1,$2,$3,$4,$5,'failed',$6,1)`,
      [profile_id, r.id, r.parent_phone, msg,
       template_id || null, sms_type]
    );
    out.failed++;
    out.errors.push({ student: r.full_name, error: smsErr.message });
  }
}
    }

  

    res.json({
      ...out,
      message: scheduled_at
        ? `Scheduled ${out.scheduled} SMS`
        : `Sent ${out.sent}${out.failed > 0 ? `, Failed ${out.failed}` : ''}`,
    });

  } catch (err) {
    console.error('[sendSms]', err.message);
    res.status(500).json({ error: err.message });
  }
};

// â”€â”€ GET /sms/history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getHistory = async (req, res) => {
  const school_id = req.school_id;
  const { page = 1 } = req.query;
  const offset = (parseInt(page)-1)*30;
  try {
    const profileRes = await pool.query(
      `SELECT id FROM school_profiles WHERE school_id=$1`, [school_id]);
    const profile_id = profileRes.rows[0]?.id;
    if (!profile_id) return res.json([]);
    const result = await pool.query(
      `SELECT ss.*, s.full_name, c.class_name
       FROM sent_sms ss
       LEFT JOIN students s ON s.id=ss.student_id
       LEFT JOIN classes c ON c.id=s.class_id
       WHERE ss.school_id=$1
       ORDER BY ss.sent_at DESC LIMIT 30 OFFSET $2`,
      [profile_id, offset]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── POST /sms/delivery-report  (Africa's Talking webhook — no auth) ────────────
// AT calls this URL with delivery status for each message.
// Register this URL in your AT dashboard under SMS > Delivery Reports.
exports.deliveryReport = async (req, res) => {
  try {
    // AT sends form-encoded body: id, status, phoneNumber, networkCode, failureReason
    const { id: messageId, status } = req.body;
    if (!messageId) return res.sendStatus(200);

    // Map AT status strings to our statuses
    const mapped =
      status === 'Success'  ? 'delivered' :
      status === 'Failed'   ? 'undelivered' :
      status === 'Rejected' ? 'rejected' : null;

    if (mapped) {
      await pool.query(
        `UPDATE sent_sms SET status = $1 WHERE message_id = $2`,
        [mapped, messageId]
      );
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[deliveryReport]', err.message);
    res.sendStatus(200); // always 200 so AT doesn't retry
  }
};

// ── Startup migration: add message_id column if missing ────────────────────────
pool.query(`
  ALTER TABLE sent_sms ADD COLUMN IF NOT EXISTS message_id TEXT
`).catch(() => {}); // silent if table doesn't exist yet

// ── GET /sms/stats ─────────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  const school_id = req.school_id;
  try {
    const profileRes = await pool.query(
      `SELECT id FROM school_profiles WHERE school_id=$1`, [school_id]);
    const profile_id = profileRes.rows[0]?.id;
    if (!profile_id) return res.json({});
    const r = await pool.query(
      `SELECT COUNT(*) as total,
        COUNT(*) FILTER(WHERE status IN ('sent','delivered')) as sent,
        COUNT(*) FILTER(WHERE status='delivered')   as delivered,
        COUNT(*) FILTER(WHERE status='undelivered') as undelivered,
        COUNT(*) FILTER(WHERE status='failed')      as failed,
        COUNT(*) FILTER(WHERE status='scheduled')   as scheduled,
        COUNT(*) FILTER(WHERE sent_at>=NOW()-INTERVAL '7 days') as this_week
       FROM sent_sms WHERE school_id=$1`, [profile_id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};
