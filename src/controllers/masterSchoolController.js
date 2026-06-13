const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendSchoolDeletedEmail, sendPasswordResetEmail, sendNewSchoolEmail } = require('../services/emailService');

exports.createSchoolWithAdmin = async (req, res) => {
  const { school_name, school_email, admin_name, admin_email, admin_phone, county, plan } = req.body;
  try {
    await db.pool.query('BEGIN');

    const schoolResult = await db.query(
      `INSERT INTO schools (name, email, county, plan)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [school_name, school_email, county || '', plan || 'trial']
    );
    const schoolId = schoolResult.rows[0].id;

    const rawPassword    = crypto.randomBytes(4).toString('hex');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    await db.query(
      `INSERT INTO users (school_id, full_name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5, 'ADMIN')`,
      [schoolId, admin_name, admin_email, admin_phone?.trim() || null, hashedPassword]
    );

    await db.pool.query('COMMIT');

    // Fire-and-forget — send credentials to admin email
    sendNewSchoolEmail({
      adminName:  admin_name,
      adminEmail: admin_email,
      schoolName: school_name,
      password:   rawPassword,
    });

    res.status(201).json({ message: 'School created. Login credentials emailed to admin.' });
  } catch (err) {
    await db.pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
};

exports.getAllSchools = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        s.id, s.name, s.email, s.is_active, s.created_at,
        s.county, s.plan,
        s.last_login_at AS last_login,
        COALESCE(st.cnt, 0)::int AS student_count,
        COALESCE(cl.cnt, 0)::int AS class_count,
        COALESCE(sm.cnt, 0)::int AS sms_this_month
      FROM schools s
      LEFT JOIN (
        SELECT school_id, COUNT(*) AS cnt FROM students
        WHERE status = 'ACTIVE' GROUP BY school_id
      ) st ON st.school_id = s.id
      LEFT JOIN (
        SELECT school_id, COUNT(*) AS cnt FROM classes
        WHERE is_archived = false OR is_archived IS NULL GROUP BY school_id
      ) cl ON cl.school_id = s.id
      LEFT JOIN (
        SELECT school_id, COUNT(*) AS cnt FROM sent_sms
        WHERE sent_at >= date_trunc('month', NOW()) GROUP BY school_id
      ) sm ON sm.school_id = s.id
      WHERE s.deleted_at IS NULL
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTrash = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, email, county, plan, deleted_at,
             deleted_at + INTERVAL '90 days' AS expires_at
      FROM schools
      WHERE deleted_at IS NOT NULL
        AND deleted_at > NOW() - INTERVAL '90 days'
      ORDER BY deleted_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.restoreSchool = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE schools SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id, name`,
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'School not in trash' });
    res.json({ message: 'School restored', name: result.rows[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.toggleSchoolStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'UPDATE schools SET is_active = NOT is_active WHERE id = $1 AND deleted_at IS NULL RETURNING is_active',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'School not found' });
    res.json({ is_active: result.rows[0].is_active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSchoolDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const [school, admin, students, gender, sms, classes, recentStudents, monthlySms, billing] =
      await Promise.all([
        db.query(`
          SELECT id, name, email, county, plan, is_active, created_at,
                 last_login_at, settlement_paybill, settlement_account
          FROM schools WHERE id = $1 AND deleted_at IS NULL
        `, [id]),

        db.query(`
          SELECT full_name, email, phone FROM users
          WHERE school_id = $1 AND role = 'ADMIN' AND is_active = true LIMIT 1
        `, [id]),

        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active,
            COUNT(*) AS total
          FROM students WHERE school_id = $1
        `, [id]),

        db.query(`
          SELECT gender, COUNT(*)::int AS count FROM students
          WHERE school_id = $1 AND status = 'ACTIVE' GROUP BY gender
        `, [id]),

        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW()))::int AS month,
            COUNT(*)::int AS all_time
          FROM sent_sms WHERE school_id = $1
        `, [id]),

        db.query(`
          SELECT c.id, c.class_name, c.stream_name, c.teacher_name, c.level_order,
                 COUNT(s.id) FILTER (WHERE s.status = 'ACTIVE')::int AS student_count
          FROM classes c
          LEFT JOIN students s ON s.class_id = c.id
          WHERE c.school_id = $1 AND (c.is_archived = false OR c.is_archived IS NULL)
          GROUP BY c.id, c.class_name, c.stream_name, c.teacher_name, c.level_order
          ORDER BY c.level_order NULLS LAST, c.class_name
        `, [id]),

        db.query(`
          SELECT full_name, admission_number, gender, created_at
          FROM students WHERE school_id = $1 ORDER BY created_at DESC LIMIT 5
        `, [id]),

        db.query(`
          SELECT TO_CHAR(month, 'Mon YY') AS label, COALESCE(cnt, 0)::int AS count
          FROM generate_series(
            date_trunc('month', COALESCE(
              (SELECT MIN(sent_at) FROM sent_sms WHERE school_id = $1), NOW()
            ))::date,
            date_trunc('month', NOW())::date, '1 month'
          ) AS month
          LEFT JOIN (
            SELECT date_trunc('month', sent_at)::date AS m, COUNT(*) AS cnt
            FROM sent_sms WHERE school_id = $1 GROUP BY m
          ) counts ON counts.m = month
          ORDER BY month
        `, [id]),

        db.query(`
          SELECT billing_date, amount_due, amount_paid, status, paid_at, next_billing_date
          FROM school_billing WHERE school_id = $1 ORDER BY billing_date DESC LIMIT 10
        `, [id]),
      ]);

    if (!school.rows[0]) return res.status(404).json({ error: 'School not found' });

    const sm = sms.rows[0];
    res.json({
      school:          school.rows[0],
      admin:           admin.rows[0] || null,
      stats: {
        active_students: parseInt(students.rows[0].active),
        total_students:  parseInt(students.rows[0].total),
        class_count:     classes.rowCount,
        sms_month:       parseInt(sm.month),
        sms_all_time:    parseInt(sm.all_time),
      },
      gender:          gender.rows,
      classes:         classes.rows,
      recent_students: recentStudents.rows,
      monthly_sms:     monthlySms.rows,
      billing:         billing.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resetAdminPassword = async (req, res) => {
  const { id } = req.params;
  try {
    const rawPassword    = crypto.randomBytes(4).toString('hex');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const result = await db.query(
      `UPDATE users SET password = $1
       WHERE school_id = $2 AND role = 'ADMIN'
       RETURNING id, full_name, email`,
      [hashedPassword, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'No admin found' });

    const school = await db.query('SELECT name FROM schools WHERE id = $1', [id]);
    const { full_name, email } = result.rows[0];
    const schoolName = school.rows[0]?.name || 'your school';

    // Fire-and-forget — send new password to admin email
    sendPasswordResetEmail({
      adminName:   full_name,
      adminEmail:  email,
      schoolName,
      newPassword: rawPassword,
    });

    res.json({ message: 'Password reset. New password emailed to admin.', new_password: rawPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePlan = async (req, res) => {
  const { id }   = req.params;
  const { plan } = req.body;
  const valid    = ['trial', 'starter', 'growth', 'pro'];
  if (!valid.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  try {
    await db.query('UPDATE schools SET plan = $1 WHERE id = $2', [plan, id]);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Soft delete — moves to trash for 90 days then can be hard-deleted
exports.deleteSchool = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE schools SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, email`,
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'School not found' });

    const { name, email } = result.rows[0];
    const deletedAt       = new Date();
    const restoreDeadline = new Date(deletedAt.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Fire-and-forget audit email
    sendSchoolDeletedEmail({ schoolName: name, schoolEmail: email, deletedAt, restoreDeadline });

    res.json({ message: 'School moved to trash', expires_at: restoreDeadline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
