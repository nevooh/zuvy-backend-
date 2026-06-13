const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendOtpSms = require('../services/otpSmsService');
const { normalizePhone } = require('../utils/phone');

exports.requestAccess = async (req, res, next) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'Phone number required' });
  }

  const normalized = normalizePhone(phoneNumber);

  try {
    const teacherQ = await pool.query(
      `SELECT t.school_id, sch.name AS school_name, 'teacher' AS role
       FROM teachers t
       JOIN schools sch ON t.school_id = sch.id
       WHERE REGEXP_REPLACE(REPLACE(REPLACE(t.phone, '+', ''), ' ', ''), '^0', '254') = $1
       LIMIT 1`,
      [normalized]
    );

    let user = teacherQ.rows[0];
    let role = 'teacher';

    if (!user) {
      const parentQ = await pool.query(
        `SELECT s.school_id, sch.name AS school_name, 'parent' AS role
         FROM students s
         JOIN schools sch ON s.school_id = sch.id
         WHERE REGEXP_REPLACE(REPLACE(REPLACE(s.parent_phone, '+', ''), ' ', ''), '^0', '254') = $1
           AND s.status = 'ACTIVE'
         LIMIT 1`,
        [normalized]
      );
      user = parentQ.rows[0];
      role = 'parent';
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'Number not registered or inactive.' });
    }

    const otp = crypto.randomInt(1000, 10000).toString();
    if (process.env.NODE_ENV !== 'production') {
      console.log(`OTP for ${normalized}: ${otp}`);
    }

    await pool.query('DELETE FROM otp_verifications WHERE phone_number = $1', [normalized]);
    await pool.query(
      'INSERT INTO otp_verifications (phone_number, otp_code) VALUES ($1, $2)',
      [normalized, otp]
    );

    await sendOtpSms(normalized, otp);

    return res.status(200).json({
      success:     true,
      role,
      school_id:   user.school_id,
      school_name: user.school_name,
      message:     'Verification code sent.',
    });

  } catch (err) {
    next(err);
  }
};

exports.verifyOtp = async (req, res, next) => {
  const { phoneNumber: rawPhone, otp } = req.body;

  if (!rawPhone || !otp) {
    return res.status(400).json({ success: false, message: 'Missing credentials' });
  }

  const phoneNumber = normalizePhone(rawPhone);

  try {
    const otpCheck = await pool.query(
      `SELECT 1 FROM otp_verifications
       WHERE phone_number = $1
         AND otp_code = $2
         AND created_at > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [phoneNumber, otp]
    );

    if (otpCheck.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await pool.query('DELETE FROM otp_verifications WHERE phone_number = $1', [phoneNumber]);

    // Run both queries in parallel — someone can be both teacher and parent
    const [teacherQ, kidsQ] = await Promise.all([
      pool.query(
        `SELECT t.id, t.name, t.school_id, t.subject, t.level_type, s.name AS school_name
         FROM teachers t
         JOIN schools s ON t.school_id = s.id
         WHERE REGEXP_REPLACE(REPLACE(REPLACE(t.phone, '+', ''), ' ', ''), '^0', '254') = $1
         LIMIT 1`,
        [phoneNumber]
      ),
      pool.query(
        `SELECT s.id, s.full_name, s.school_id, s.parent_phone,
                c.class_name, c.stream_name, sch.name AS school_name
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         LEFT JOIN schools sch ON sch.id = s.school_id
         WHERE REGEXP_REPLACE(REPLACE(REPLACE(s.parent_phone, '+', ''), ' ', ''), '^0', '254') = $1
           AND s.status = 'ACTIVE'`,
        [phoneNumber]
      ),
    ]);

    const isTeacher = teacherQ.rowCount > 0;
    const isParent  = kidsQ.rowCount > 0;

    if (!isTeacher && !isParent) {
      return res.status(403).json({ success: false, message: 'No active students found for this number' });
    }

    // ── Dual role: teacher who also has kids at the school ────────────────────
    if (isTeacher && isParent) {
      const teacher = teacherQ.rows[0];
      const teacher_token = jwt.sign(
        { phoneNumber, role: 'teacher', teacher_id: teacher.id, school_id: teacher.school_id },
        process.env.JWT_SECRET, { expiresIn: '30d' }
      );
      const parent_token = jwt.sign(
        { phoneNumber, role: 'parent', school_id: kidsQ.rows[0].school_id },
        process.env.JWT_SECRET, { expiresIn: '30d' }
      );
      return res.status(200).json({
        success:       true,
        role:          'dual',
        teacher_token,
        parent_token,
        school_id:     teacher.school_id,
        school_name:   teacher.school_name,
        user:          teacher,
        students:      kidsQ.rows,
      });
    }

    // ── Teacher only ──────────────────────────────────────────────────────────
    if (isTeacher) {
      const teacher = teacherQ.rows[0];
      const token = jwt.sign(
        { phoneNumber, role: 'teacher', teacher_id: teacher.id, school_id: teacher.school_id },
        process.env.JWT_SECRET, { expiresIn: '30d' }
      );
      return res.status(200).json({
        success:     true,
        role:        'teacher',
        token,
        school_id:   teacher.school_id,
        school_name: teacher.school_name,
        user:        teacher,
      });
    }

    // ── Parent only ───────────────────────────────────────────────────────────
    const token = jwt.sign(
      { phoneNumber, role: 'parent', school_id: kidsQ.rows[0].school_id },
      process.env.JWT_SECRET, { expiresIn: '30d' }
    );
    return res.status(200).json({
      success:     true,
      role:        'parent',
      token,
      school_id:   kidsQ.rows[0].school_id,
      school_name: kidsQ.rows[0].school_name,
      students:    kidsQ.rows,
    });

  } catch (err) {
    next(err);
  }
};
