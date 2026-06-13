const db          = require('../config/db');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');
const sendOtpSms  = require('../services/otpSmsService');
const MpesaService = require('../services/mpesaService');
const { sendOtpEmail } = require('../services/emailService');

function normalizePhone(raw) {
  let p = raw.replace(/\D/g, '');
  if (p.startsWith('0'))   p = '254' + p.slice(1);
  if (p.startsWith('254')) return p;
  if (p.length === 9)      return '254' + p;
  return p;
}

// ── POST /api/public/request-registration ─────────────────────────────────────
exports.requestRegistration = async (req, res) => {
  const { school_name, admin_name, admin_email, phone, county, student_count } = req.body;

  if (!school_name || !admin_name || !admin_email || !phone) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const normalized = normalizePhone(phone.toString());

  try {
    // Check if phone or email already registered
    const existing = await db.query(
      `SELECT u.id FROM users u
       WHERE (u.phone = $1 OR u.email = $2) AND u.role = 'ADMIN'`,
      [normalized, admin_email.trim().toLowerCase()]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'An account with this phone or email already exists.' });
    }

    await db.query(`
      INSERT INTO pending_registrations
        (phone, school_name, admin_name, admin_email, county, student_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (phone) DO UPDATE SET
        school_name   = EXCLUDED.school_name,
        admin_name    = EXCLUDED.admin_name,
        admin_email   = EXCLUDED.admin_email,
        county        = EXCLUDED.county,
        student_count = EXCLUDED.student_count,
        created_at    = NOW()
    `, [normalized, school_name.trim(), admin_name.trim(), admin_email.trim().toLowerCase(), county?.trim() ?? '', parseInt(student_count) || 0]);

    // Generate and send OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    await db.query('DELETE FROM otp_verifications WHERE phone_number = $1', [normalized]);
    await db.query(
      'INSERT INTO otp_verifications (phone_number, otp_code) VALUES ($1, $2)',
      [normalized, otp]
    );
    console.log(`\n🔐 [DEV] OTP for ${normalized} → ${otp}\n`);
    await sendOtpSms(normalized, otp);

    return res.status(200).json({ success: true, message: 'OTP sent to your phone.' });

  } catch (err) {
    console.error('[requestRegistration]', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// ── POST /api/public/request-admin-otp ───────────────────────────────────────
// Accepts phone OR email — sends OTP to both registered phone and email
exports.requestAdminOtp = async (req, res) => {
  const { phone, email } = req.body;
  if (!phone && !email)
    return res.status(400).json({ success: false, message: 'Phone number or email required.' });

  const ownerPhone = process.env.OWNER_PHONE
    ? normalizePhone(process.env.OWNER_PHONE) : null;

  // Check if owner phone
  const normalized = phone ? normalizePhone(phone.toString()) : null;
  const isOwner    = normalized && ownerPhone && normalized === ownerPhone;

  try {
    let adminPhone = normalized;
    let adminEmail = null;
    let adminName  = null;

    if (!isOwner) {
      // Look up by phone OR email — whichever was provided
      const admin = await db.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.school_id, s.is_active
         FROM users u
         JOIN schools s ON s.id = u.school_id
         WHERE u.role = 'ADMIN'
           AND ($1::text IS NULL OR u.phone = $1)
           AND ($2::text IS NULL OR LOWER(u.email) = LOWER($2))
         LIMIT 1`,
        [normalized, email?.trim().toLowerCase() || null]
      );

      if (admin.rowCount === 0)
        return res.status(404).json({ success: false, message: 'No account found. Check your phone number or email.' });
      if (!admin.rows[0].is_active)
        return res.status(403).json({ success: false, message: 'School account is inactive.' });

      adminPhone = admin.rows[0].phone;
      adminEmail = admin.rows[0].email;
      adminName  = admin.rows[0].full_name;
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    // Use phone as the OTP key; fall back to email if no phone
    const otpKey = adminPhone || adminEmail;
    console.log(`\n🔐 [DEV] Admin OTP for ${otpKey} → ${otp}\n`);

    await db.query('DELETE FROM otp_verifications WHERE phone_number = $1', [otpKey]);
    await db.query('INSERT INTO otp_verifications (phone_number, otp_code) VALUES ($1, $2)', [otpKey, otp]);

    // Fire both channels — whichever arrives first works
    if (adminPhone) sendOtpSms(adminPhone, `Your School OS verification code: ${otp}. Valid for 5 minutes. - Zuvy`);
    if (adminEmail) sendOtpEmail({ adminEmail, adminName, otp });

    return res.status(200).json({ success: true, message: 'OTP sent to your registered number and email.' });
  } catch (err) {
    console.error('[requestAdminOtp]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/public/verify-admin-otp ────────────────────────────────────────
exports.verifyAdminOtp = async (req, res) => {
  const { phone, email, otp } = req.body;
  if (!otp || (!phone && !email))
    return res.status(400).json({ success: false, message: 'OTP and phone or email required.' });

  const ownerPhone = process.env.OWNER_PHONE
    ? normalizePhone(process.env.OWNER_PHONE) : null;
  const normalized = phone ? normalizePhone(phone.toString()) : null;
  const isOwner    = normalized && ownerPhone && normalized === ownerPhone;

  // The OTP key matches what was stored during request-admin-otp
  // Admin with phone → key is phone; admin with only email → key is email
  const otpKey = normalized || email?.trim().toLowerCase();

  try {
    const otpCheck = await db.query(
      `SELECT 1 FROM otp_verifications
       WHERE phone_number = $1 AND otp_code = $2
         AND created_at > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [otpKey, otp]
    );
    if (otpCheck.rowCount === 0)
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP.' });

    await db.query('DELETE FROM otp_verifications WHERE phone_number = $1', [otpKey]);

    // ── Owner login → master admin token ──────────────────────────────────
    if (isOwner) {
      const token = jwt.sign(
        { id: 'owner', role: 'MASTER_ADMIN' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.status(200).json({ success: true, token, role: 'MASTER_ADMIN' });
    }

    // ── School admin login — look up by phone OR email ────────────────────
    const admin = await db.query(
      `SELECT u.id, u.full_name, u.school_id, s.name AS school_name
       FROM users u
       JOIN schools s ON s.id = u.school_id
       WHERE u.role = 'ADMIN'
         AND ($1::text IS NULL OR u.phone = $1)
         AND ($2::text IS NULL OR LOWER(u.email) = $2)
       LIMIT 1`,
      [normalized, email?.trim().toLowerCase() || null]
    );
    if (admin.rowCount === 0)
      return res.status(404).json({ success: false, message: 'No admin account found.' });

    const row   = admin.rows[0];
    const token = jwt.sign(
      { id: row.id, school_id: row.school_id, role: 'ADMIN' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success:     true,
      token,
      role:        'ADMIN',
      school_id:   row.school_id,
      school_name: row.school_name,
      admin_name:  row.full_name,
    });
  } catch (err) {
    console.error('[verifyAdminOtp]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/public/verify-registration ─────────────────────────────────────
exports.verifyRegistration = async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
  }

  const normalized = normalizePhone(phone.toString());

  try {
    // Verify OTP
    const otpCheck = await db.query(
      `SELECT 1 FROM otp_verifications
       WHERE phone_number = $1
         AND otp_code     = $2
         AND created_at   > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [normalized, otp]
    );
    if (otpCheck.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    // Fetch pending registration
    const pending = await db.query(
      'SELECT * FROM pending_registrations WHERE phone = $1',
      [normalized]
    );
    if (pending.rowCount === 0) {
      return res.status(400).json({ success: false, message: 'Registration session expired. Please start again.' });
    }

    const reg = pending.rows[0];

    // Create school + admin in a transaction
    await db.query('BEGIN');

    const schoolResult = await db.query(
      `INSERT INTO schools (name, email, is_active)
       VALUES ($1, $2, true)
       RETURNING id`,
      [reg.school_name, reg.admin_email]
    );
    const schoolId = schoolResult.rows[0].id;

    // Store county + student count in school_profiles if table exists
    try {
      await db.query(
        `INSERT INTO school_profiles (school_id, town_city)
         VALUES ($1, $2)
         ON CONFLICT (school_id) DO UPDATE SET town_city = EXCLUDED.town_city`,
        [schoolId, reg.county]
      );
    } catch (_) { /* school_profiles might not have this column — skip */ }

    // Create admin user with real email + generated password
    const rawPassword    = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. A3F2B1C9
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const userResult = await db.query(
      `INSERT INTO users (school_id, full_name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5, 'ADMIN')
       RETURNING id`,
      [schoolId, reg.admin_name, reg.admin_email, normalized, hashedPassword]
    );
    const userId = userResult.rows[0].id;

    // Clean up OTP and pending data
    await db.query('DELETE FROM otp_verifications WHERE phone_number = $1', [normalized]);
    await db.query('DELETE FROM pending_registrations WHERE phone = $1', [normalized]);

    await db.query('COMMIT');

    // SMS the admin their login credentials
    try {
      await sendOtpSms(
        normalized,
        `SchoolOS: Your school "${reg.school_name}" is ready!\nEmail: ${reg.admin_email}\nPassword: ${rawPassword}\nLogin at your admin dashboard. Change your password after first login.`
      );
    } catch (_) { /* SMS failure should not block registration */ }

    // Issue admin JWT
    const token = jwt.sign(
      { id: userId, school_id: schoolId, role: 'ADMIN' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success:     true,
      token,
      school_id:   schoolId,
      school_name: reg.school_name,
      admin_name:  reg.admin_name,
      admin_email: reg.admin_email,
    });

  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[verifyRegistration]', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// ── GET /api/public/school-dashboard ──────────────────────────────────────────
// Returns school info + billing status for the school dashboard page
exports.getSchoolDashboard = async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) return res.status(400).json({ success: false, message: 'school_id required.' });

  try {
    const result = await db.query(`
      SELECT
        s.id, s.name AS school_name, s.email, s.is_active,
        s.created_at,
        COUNT(DISTINCT st.id) FILTER (WHERE st.status = 'ACTIVE') AS student_count,
        COUNT(DISTINCT t.id)                                        AS teacher_count,
        COALESCE(sb.status, 'TRIAL')           AS billing_status,
        sb.next_billing_date,
        sb.paid_at
      FROM schools s
      LEFT JOIN students st ON st.school_id = s.id
      LEFT JOIN teachers t  ON t.school_id  = s.id
      LEFT JOIN school_billing sb ON sb.school_id = s.id
        AND sb.billing_date = (
          SELECT MAX(b2.billing_date) FROM school_billing b2 WHERE b2.school_id = s.id
        )
      WHERE s.id = $1
      GROUP BY s.id, sb.status, sb.next_billing_date, sb.paid_at
    `, [school_id]);

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: 'School not found.' });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[getSchoolDashboard]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/public/subscription-pay ─────────────────────────────────────────
// Initiates M-Pesa STK push for school subscription
exports.subscriptionPay = async (req, res) => {
  const { school_id, phone, plan } = req.body; // plan: 'annual' | 'termly'
  if (!school_id || !phone || !plan)
    return res.status(400).json({ success: false, message: 'school_id, phone and plan required.' });

  try {
    const students = await db.query(
      `SELECT COUNT(*) AS cnt FROM students WHERE school_id = $1 AND status = 'ACTIVE'`,
      [school_id]
    );
    const count  = parseInt(students.rows[0].cnt) || 0;
    const amount = plan === 'annual' ? count * 100 : count * 45;

    if (amount < 1)
      return res.status(400).json({ success: false, message: 'No active students found. Add students first.' });

    const normalized    = normalizePhone(phone.toString());
    const subscriptionCallbackUrl = `${process.env.BASE_URL}/api/public/subscription-callback`;
    const stkRes     = await MpesaService.initiateSTKPush(amount, normalized, school_id, subscriptionCallbackUrl);
    const checkoutId = stkRes.data?.CheckoutRequestID;

    // Store pending billing record — note holds "checkoutId:plan" for callback lookup
    await db.query(`
      INSERT INTO school_billing (school_id, billing_date, amount_due, status, note)
      VALUES ($1, NOW(), $2, 'PENDING', $3)
    `, [school_id, amount, `${checkoutId}:${plan}`]);

    return res.json({
      success:    true,
      checkoutId,
      amount,
      message:    `STK Push sent for KSH ${amount.toLocaleString()}. Check your phone.`,
    });
  } catch (err) {
    console.error('[subscriptionPay]', err.message);
    return res.status(500).json({ success: false, message: 'Payment failed. Try again.' });
  }
};

// ── POST /api/public/set-pin ───────────────────────────────────────────────────
// School admin sets their 4-digit PIN for the admin dashboard
exports.setPin = async (req, res) => {
  const { school_id, pin } = req.body;
  if (!school_id || !pin || pin.length < 4)
    return res.status(400).json({ success: false, message: 'school_id and 4-digit PIN required.' });

  try {
    const hashed = await bcrypt.hash(pin.toString(), 10);
    await db.query(
      `UPDATE users SET password = $1 WHERE school_id = $2 AND role = 'ADMIN'`,
      [hashed, school_id]
    );
    return res.json({ success: true, message: 'PIN set successfully.' });
  } catch (err) {
    console.error('[setPin]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/public/subscription-callback ────────────────────────────────────
// M-Pesa STK callback for school subscription payments
exports.subscriptionCallback = async (req, res) => {
  // Always ACK M-Pesa immediately
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const { Body } = req.body;
    if (!Body?.stkCallback) return;

    const checkoutId = Body.stkCallback.CheckoutRequestID;
    const resultCode = Body.stkCallback.ResultCode;

    if (resultCode !== 0) {
      // Payment failed / cancelled — mark billing record failed
      await db.query(
        `UPDATE school_billing SET status = 'FAILED' WHERE note LIKE $1 AND status = 'PENDING'`,
        [`${checkoutId}:%`]
      );
      console.log(`[subscriptionCallback] Payment failed for checkout ${checkoutId}`);
      return;
    }

    const meta        = Body.stkCallback.CallbackMetadata.Item;
    const amountPaid  = meta.find(i => i.Name === 'Amount')?.Value;
    const receipt     = meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value;

    // Find the pending billing record by checkout_id stored in note
    const billing = await db.query(
      `SELECT id, school_id, note FROM school_billing WHERE note LIKE $1 AND status = 'PENDING' LIMIT 1`,
      [`${checkoutId}:%`]
    );
    if (billing.rowCount === 0) {
      console.warn(`[subscriptionCallback] No pending billing found for checkout ${checkoutId}`);
      return;
    }

    const { id, school_id, note } = billing.rows[0];
    const plan = note.split(':')[1] || 'annual';

    // Calculate next billing date
    const nextBilling = new Date();
    if (plan === 'annual') {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    } else {
      // Termly: ~4 months per term
      nextBilling.setMonth(nextBilling.getMonth() + 4);
    }

    await db.query(`
      UPDATE school_billing
      SET status = 'PAID', amount_paid = $1, paid_at = NOW(),
          next_billing_date = $2, note = $3
      WHERE id = $4
    `, [amountPaid, nextBilling, receipt, id]);

    console.log(`✅ [subscriptionCallback] School ${school_id} subscription PAID — receipt ${receipt}`);
  } catch (err) {
    console.error('[subscriptionCallback]', err.message);
  }
};
