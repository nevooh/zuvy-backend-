const { pool } = require('../config/db');

exports.admitStudent = async (req, res, next) => {
  const {
    full_name, admission_number, grade_level, class_id,
    date_of_birth, gender, parent_name, parent_phone,
    emergency_contact_name, emergency_contact_phone,
  } = req.body;
  const school_id = req.user.school_id;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ message: 'full_name is required.' });
  }
  if (!admission_number || !admission_number.trim()) {
    return res.status(400).json({ message: 'admission_number is required.' });
  }
  if (!class_id) {
    return res.status(400).json({ message: 'class_id is required.' });
  }

  const sanitizedDOB = date_of_birth === '' || !date_of_birth ? null : date_of_birth;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const studentResult = await client.query(
      `INSERT INTO students (
         school_id, full_name, admission_number, class_id, grade_level,
         date_of_birth, gender, parent_name, parent_phone,
         emergency_contact_name, emergency_contact_phone
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        school_id, full_name.trim(), admission_number.trim(), class_id, grade_level,
        sanitizedDOB, gender, parent_name, parent_phone,
        emergency_contact_name, emergency_contact_phone,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json(studentResult.rows[0]);

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Admission number already exists in this school.' });
    }
    next(err);
  } finally {
    client.release();
  }
};

exports.getAllStudents = async (req, res, next) => {
  const school_id = req.user.school_id;
  const activeTermId = req.query.term_id || null;

  try {
    const result = await pool.query(
      `SELECT
         s.id, s.full_name, s.admission_number, s.grade_level, s.status,
         s.date_of_birth, s.gender, s.parent_name, s.parent_phone,
         s.emergency_contact_name, s.emergency_contact_phone, s.class_id,
         c.class_name,
         c.stream_name,
         COALESCE(inv.total_amount, 0) AS total_liability,
         COALESCE((
           SELECT SUM(amount_paid) FROM payments
           WHERE student_id = s.id AND term_id = inv.term_id
         ), 0) AS total_paid,
         COALESCE(inv.balance, 0) AS balance,
         inv.term_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN LATERAL (
         SELECT i.total_amount, i.balance, i.term_id, t.name AS term_name
         FROM student_invoices i
         JOIN academic_terms t ON i.term_id = t.id
         WHERE i.student_id = s.id
           AND (i.term_id = $1 OR $1 IS NULL)
         ORDER BY t.is_active DESC, t.year DESC, t.start_date DESC
         LIMIT 1
       ) inv ON true
       WHERE s.school_id = $2 AND s.status = 'ACTIVE'
       ORDER BY s.created_at DESC`,
      [activeTermId, school_id]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
};

exports.updateStudent = async (req, res, next) => {
  const { id } = req.params;
  const school_id = req.user.school_id;
  const {
    full_name, admission_number, class_id,
    parent_name = '', parent_phone = '',
    emergency_contact_name = '', emergency_contact_phone = '',
  } = req.body;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ message: 'full_name is required.' });
  }
  if (!class_id) {
    return res.status(400).json({ message: 'class_id is required.' });
  }

  try {
    const classResult = await pool.query(
      'SELECT class_name FROM classes WHERE id = $1 AND school_id = $2',
      [class_id, school_id]
    );
    if (classResult.rows.length === 0) {
      return res.status(400).json({ message: 'Selected class does not exist.' });
    }

    const grade_level = classResult.rows[0].class_name;

    const result = await pool.query(
      `UPDATE students
       SET full_name = $1, admission_number = $2, grade_level = $3, class_id = $4,
           parent_name = $5, parent_phone = $6,
           emergency_contact_name = $7, emergency_contact_phone = $8
       WHERE id = $9 AND school_id = $10
       RETURNING *`,
      [
        full_name.trim(), admission_number, grade_level, class_id,
        parent_name, parent_phone, emergency_contact_name, emergency_contact_phone,
        id, school_id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found or unauthorized' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Admission number already exists.' });
    }
    next(err);
  }
};

// Soft-delete: marks as INACTIVE rather than removing the record.
// Payment history, ledger entries, and audit trails remain intact.
exports.deleteStudent = async (req, res, next) => {
  const { id } = req.params;
  const school_id = req.user.school_id;

  try {
    const result = await pool.query(
      `UPDATE students SET status = 'INACTIVE'
       WHERE id = $1 AND school_id = $2
       RETURNING id`,
      [id, school_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found or unauthorized' });
    }

    res.status(200).json({ message: 'Student deactivated successfully' });
  } catch (err) {
    next(err);
  }
};

exports.updateStudentStatus = async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;
  const school_id = req.user.school_id;

  const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'GRADUATED'];
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `UPDATE students SET status = $1 WHERE id = $2 AND school_id = $3 RETURNING *`,
      [status, id, school_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found or unauthorized' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};
