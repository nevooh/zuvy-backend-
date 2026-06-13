const pool = require('../../config/analyticsPool');

exports.getTeachers = async (req, res) => {
  const school_id = req.school_id;
  const { search } = req.query;
  try {
    let query = `
      SELECT t.*,
        c.class_name, c.stream_name,
        COALESCE(
          json_agg(
            json_build_object('id', s.id, 'name', s.name, 'code', s.code)
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) as subjects
      FROM teachers t
      LEFT JOIN classes c ON c.id = t.class_id
      LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id AND ts.class_id IS NULL
      LEFT JOIN subjects s ON s.id = ts.subject_id
      WHERE t.school_id = $1
    `;
    const params = [school_id];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (t.name ILIKE $${params.length}
                 OR t.email ILIKE $${params.length}
                 OR t.phone ILIKE $${params.length})`;
    }
    query += ` GROUP BY t.id, c.class_name, c.stream_name
               ORDER BY t.name`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTeacher = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    const teacher = await pool.query(
      `SELECT t.*, c.class_name, c.stream_name, c.level_type,
        COALESCE(
          json_agg(
            json_build_object('id', s.id, 'name', s.name, 'code', s.code)
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) as subjects
       FROM teachers t
       LEFT JOIN classes c ON c.id = t.class_id
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id AND ts.class_id IS NULL
       LEFT JOIN subjects s ON s.id = ts.subject_id
       WHERE t.id = $1 AND t.school_id = $2
       GROUP BY t.id, c.class_name, c.stream_name, c.level_type`,
      [id, school_id]
    );
    if (!teacher.rows[0]) {
      return res.status(404).json({ error: 'Not found' });
    }
    const t = teacher.rows[0];

    // subject averages — always: based on teacher_subjects across all assigned classes
    const subjectPerExamRes = await pool.query(
      `SELECT e.id as exam_id, e.name as exam_name,
              e.start_date,
              sub.name as subject_name,
              c.id as class_id,
              c.class_name, c.stream_name,
              ROUND(AVG(r.score::numeric / r.max_score * 100), 1) as avg_pct
       FROM teacher_subjects ts
       JOIN subjects sub ON sub.id = ts.subject_id
       JOIN classes c ON c.id = ts.class_id
       JOIN students s ON s.class_id = ts.class_id AND s.status = 'ACTIVE'
       JOIN results r ON r.student_id = s.id AND r.subject_id = ts.subject_id
       JOIN exams e ON e.id = r.exam_id
       JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ts.class_id
       WHERE ts.teacher_id = $1 AND r.max_score > 0 AND c.school_id = $2
       GROUP BY e.id, e.name, e.start_date, sub.name, c.id, c.class_name, c.stream_name
       ORDER BY sub.name, c.class_name, c.stream_name,
                e.start_date DESC NULLS LAST, e.id DESC`,
      [id, school_id]
    );

    // teacher has no homeroom class — skip class-specific queries
    if (!t.class_id) {
      return res.json({
        teacher: t,
        exams: [],
        subject_per_exam: subjectPerExamRes.rows,
        attendance: null,
      });
    }

    // get all exams for this class
    const exams = await pool.query(
      `SELECT e.id, e.name, e.exam_type, e.start_date,
              e.max_score, term.name as term_name
       FROM exams e
       JOIN exam_classes ec ON ec.exam_id = e.id
       LEFT JOIN academic_terms term ON term.id = e.term_id
       WHERE ec.class_id = $1
       ORDER BY e.start_date DESC NULLS LAST, e.id DESC`,
      [t.class_id]
    );

    // subject count for this class — used as the denominator for max possible
    const classSubjectRes = await pool.query(
      `SELECT COUNT(*) as total FROM class_subjects WHERE class_id = $1`,
      [t.class_id]
    );
    const classSubjectCount = parseInt(classSubjectRes.rows[0]?.total || 0);

    // per exam: class avg + student rankings
    const examData = [];
    for (const exam of exams.rows) {
      const maxPerExam = parseFloat(exam.max_score || 100) * classSubjectCount;

      const [classAvgRes, studentsRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(DISTINCT r.student_id) as count,
                  SUM(r.score) as total_score
           FROM results r
           JOIN students s ON s.id = r.student_id
           WHERE s.class_id = $1 AND r.exam_id = $2
           AND r.score IS NOT NULL`,
          [t.class_id, exam.id]
        ),
        pool.query(
          `SELECT s.full_name, s.admission_number,
                  SUM(r.score) as total_marks,
                  SUM(r.max_score) as total_max
           FROM results r
           JOIN students s ON s.id = r.student_id
           WHERE s.class_id = $1 AND r.exam_id = $2
           AND s.status = 'ACTIVE'
           GROUP BY s.id, s.full_name, s.admission_number`,
          [t.class_id, exam.id]
        ),
      ]);

      const totalScore = parseFloat(classAvgRes.rows[0]?.total_score || 0);
      const studentCount = parseInt(classAvgRes.rows[0]?.count || 0);
      const avgPct = (maxPerExam > 0 && studentCount > 0)
        ? parseFloat((totalScore / (maxPerExam * studentCount) * 100).toFixed(1))
        : 0;

      const students = studentsRes.rows
        .map(s => ({
          ...s,
          pct: maxPerExam > 0
            ? parseFloat((parseFloat(s.total_marks || 0) / maxPerExam * 100).toFixed(1))
            : 0,
        }))
        .sort((a, b) => b.pct - a.pct)
        .map((s, i) => ({ ...s, position: i + 1 }));

      examData.push({
        exam,
        class_avg: { avg_pct: avgPct, count: studentCount },
        students,
      });
    }

    // all subjects in homeroom class, per exam
    const classSubjectAvgRes = await pool.query(
      `SELECT sub.id as subject_id,
              sub.name as subject_name,
              sub.code as subject_code,
              e.id as exam_id,
              e.name as exam_name,
              e.start_date,
              ROUND(AVG(r.score::numeric / r.max_score * 100), 1) as avg_pct
       FROM class_subjects cs
       JOIN subjects sub ON sub.id = cs.subject_id
       JOIN students s ON s.class_id = cs.class_id AND s.status = 'ACTIVE'
       JOIN results r ON r.student_id = s.id AND r.subject_id = cs.subject_id
       JOIN exams e ON e.id = r.exam_id
       JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = cs.class_id
       WHERE cs.class_id = $1 AND r.max_score > 0
       GROUP BY sub.id, sub.name, sub.code, e.id, e.name, e.start_date
       ORDER BY sub.name, e.start_date DESC NULLS LAST, e.id DESC`,
      [t.class_id]
    );

    // attendance for homeroom class
    const attRes = await pool.query(
      `SELECT
        ROUND(100.0 * COUNT(*) FILTER (WHERE status='present')
          / NULLIF(COUNT(*),0),1) as rate,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status='present') as present,
        COUNT(*) FILTER (WHERE status='absent') as absent
       FROM attendance WHERE class_id = $1`,
      [t.class_id]
    );

    res.json({
      teacher: t,
      exams: examData,
      subject_per_exam: subjectPerExamRes.rows,
      class_subject_averages: classSubjectAvgRes.rows,
      attendance: attRes.rows[0] ?? null,
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.createTeacher = async (req, res) => {
  const school_id = req.school_id;
  const { name, phone, email, subject_ids = [] } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO teachers (school_id, name, phone, email)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [school_id, name, phone || null, email || null]
    );
    const teacher = result.rows[0];
    for (const subjectId of subject_ids) {
      await pool.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id, class_id)
         VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
        [teacher.id, subjectId]
      );
    }
    res.json(teacher);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTeacher = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  const { name, phone, email, class_id, subject_ids } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (class_id) {
      await client.query(
        `UPDATE classes SET class_teacher_id = NULL
         WHERE class_teacher_id = $1 AND school_id = $2`,
        [id, school_id]
      );
      await client.query(
        `UPDATE classes SET class_teacher_id = $1
         WHERE id = $2 AND school_id = $3`,
        [id, class_id, school_id]
      );
    }
    const result = await client.query(
      `UPDATE teachers
       SET name=$1, phone=$2, email=$3, class_id=$4
       WHERE id=$5 AND school_id=$6 RETURNING *`,
      [name, phone || null, email || null, class_id || null, id, school_id]
    );
    // update subject qualifications if provided
    if (Array.isArray(subject_ids)) {
      await client.query(
        `DELETE FROM teacher_subjects
         WHERE teacher_id = $1 AND class_id IS NULL`,
        [id]
      );
      for (const subjectId of subject_ids) {
        await client.query(
          `INSERT INTO teacher_subjects (teacher_id, subject_id, class_id)
           VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
          [id, subjectId]
        );
      }
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteTeacher = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM teachers WHERE id=$1 AND school_id=$2`,
      [id, school_id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.assignSubjects = async (req, res) => {
  const { id } = req.params;
  // assignments = [{ subject_id, class_id }]
  const { assignments } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // check: does any new assignment conflict with another teacher already teaching
    // that subject in the same class?
    for (const a of assignments) {
      if (!a.class_id) continue;
      const conflict = await client.query(
        `SELECT t.name AS teacher_name, s.name AS subject_name,
                c.class_name, c.stream_name
         FROM teacher_subjects ts
         JOIN teachers t ON t.id = ts.teacher_id
         JOIN subjects s ON s.id = ts.subject_id
         JOIN classes c ON c.id = ts.class_id
         WHERE ts.subject_id = $1 AND ts.class_id = $2
         AND ts.teacher_id != $3`,
        [a.subject_id, a.class_id, id]
      );
      if (conflict.rows[0]) {
        await client.query('ROLLBACK');
        const r = conflict.rows[0];
        const cls = `${r.class_name}${r.stream_name ? ' ' + r.stream_name : ''}`;
        return res.status(409).json({
          error: `${cls} already has ${r.teacher_name} teaching ${r.subject_name}`
        });
      }
    }
    await client.query(
      `DELETE FROM teacher_subjects WHERE teacher_id = $1`,
      [id]
    );
    for (const a of assignments) {
      await client.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id, class_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, a.subject_id, a.class_id || null]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Assignments saved' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// set class teacher - only one per class
exports.setClassTeacher = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  const { class_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (class_id) {
      // remove this teacher from being class teacher anywhere
      await client.query(
        `UPDATE classes SET class_teacher_id = NULL
         WHERE class_teacher_id = $1
         AND school_id = $2`,
        [id, school_id]
      );
      // assign as class teacher to this class
      // but first check if class already has a class teacher
      const existing = await client.query(
        `SELECT class_teacher_id, t.name as teacher_name
         FROM classes c
         LEFT JOIN teachers t ON t.id = c.class_teacher_id
         WHERE c.id = $1 AND c.school_id = $2`,
        [class_id, school_id]
      );
      if (existing.rows[0]?.class_teacher_id &&
          existing.rows[0].class_teacher_id != parseInt(id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `This class already has ${existing.rows[0].teacher_name} as class teacher`,
        });
      }
      await client.query(
        `UPDATE classes SET class_teacher_id = $1
         WHERE id = $2 AND school_id = $3`,
        [id, class_id, school_id]
      );
      // update teacher record
      await client.query(
        `UPDATE teachers SET class_id = $1
         WHERE id = $2 AND school_id = $3`,
        [class_id, id, school_id]
      );
    } else {
      // remove class teacher role
      await client.query(
        `UPDATE classes SET class_teacher_id = NULL
         WHERE class_teacher_id = $1 AND school_id = $2`,
        [id, school_id]
      );
      await client.query(
        `UPDATE teachers SET class_id = NULL
         WHERE id = $1 AND school_id = $2`,
        [id, school_id]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Class teacher updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getTeacherClasses = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT c.id, c.class_name, c.stream_name,
              c.level_type,
              CASE WHEN c.class_teacher_id = $1::integer
                   THEN true ELSE false
              END as is_class_teacher,
              json_agg(
                json_build_object(
                  'subject_id', s.id,
                  'subject_name', s.name,
                  'subject_code', s.code
                )
              ) FILTER (WHERE s.id IS NOT NULL) as subjects
       FROM teacher_subjects ts
       JOIN classes c ON c.id = ts.class_id
       JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1::integer AND c.school_id = $2
       GROUP BY c.id, c.class_name, c.stream_name,
                c.level_type, c.class_teacher_id`,
      [id, school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getTeacherClasses error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
