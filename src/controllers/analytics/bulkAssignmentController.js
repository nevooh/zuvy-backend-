const pool = require('../../config/analyticsPool');

exports.getMatrix = async (req, res) => {
  const school_id = req.school_id;
  try {
    const [classesRes, subjectsRes, teachersRes, assignmentsRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.class_name, c.stream_name, c.level_type,
                c.class_teacher_id,
                COALESCE(
                  json_agg(cs.subject_id) FILTER (WHERE cs.subject_id IS NOT NULL), '[]'
                ) as subject_ids
         FROM classes c
         LEFT JOIN class_subjects cs ON cs.class_id = c.id
         WHERE c.school_id = $1
           AND (c.is_archived = false OR c.is_archived IS NULL)
         GROUP BY c.id
         ORDER BY c.level_type, c.class_name, c.stream_name`,
        [school_id]
      ),
      pool.query(
        `SELECT id, name, code, school_level as level_type
         FROM subjects WHERE school_id = $1 ORDER BY school_level, name`,
        [school_id]
      ),
      pool.query(
        `SELECT t.id, t.name,
                COALESCE(
                  json_agg(ts.subject_id) FILTER (WHERE ts.subject_id IS NOT NULL), '[]'
                ) as subject_ids
         FROM teachers t
         LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id AND ts.class_id IS NULL
         WHERE t.school_id = $1
         GROUP BY t.id
         ORDER BY t.name`,
        [school_id]
      ),
      pool.query(
        `SELECT ts.teacher_id, ts.subject_id, ts.class_id
         FROM teacher_subjects ts
         JOIN teachers t ON t.id = ts.teacher_id
         WHERE t.school_id = $1`,
        [school_id]
      ),
    ]);

    res.json({
      classes:     classesRes.rows,
      subjects:    subjectsRes.rows,
      teachers:    teachersRes.rows,
      assignments: assignmentsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveMatrix = async (req, res) => {
  const school_id = req.school_id;
  const { assignments = [], class_teachers = [] } = req.body;

  // reject duplicate class teacher assignments
  const ctTeacherIds = class_teachers
    .filter(ct => ct.teacher_id)
    .map(ct => String(ct.teacher_id));
  if (new Set(ctTeacherIds).size !== ctTeacherIds.length) {
    return res.status(400).json({
      error: 'A teacher can only be class teacher for one class at a time.'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe only class-specific assignments — preserve subject qualifications (class_id IS NULL)
    await client.query(
      `DELETE FROM teacher_subjects
       WHERE class_id IS NOT NULL
       AND teacher_id IN (SELECT id FROM teachers WHERE school_id = $1)`,
      [school_id]
    );

    // Insert new subject assignments
    for (const a of assignments) {
      if (!a.teacher_id || !a.subject_id || !a.class_id) continue;
      await client.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id, class_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [a.teacher_id, a.subject_id, a.class_id]
      );
    }

    // Clear existing class teacher assignments
    await client.query(
      `UPDATE classes SET class_teacher_id = NULL
       WHERE school_id = $1 AND (is_archived = false OR is_archived IS NULL)`,
      [school_id]
    );
    await client.query(
      `UPDATE teachers SET class_id = NULL WHERE school_id = $1`,
      [school_id]
    );

    // Set new class teacher assignments
    for (const ct of class_teachers) {
      if (!ct.teacher_id || !ct.class_id) continue;
      await client.query(
        `UPDATE classes SET class_teacher_id = $1 WHERE id = $2 AND school_id = $3`,
        [ct.teacher_id, ct.class_id, school_id]
      );
      await client.query(
        `UPDATE teachers SET class_id = $1 WHERE id = $2 AND school_id = $3`,
        [ct.class_id, ct.teacher_id, school_id]
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
