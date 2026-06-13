const pool = require('../../config/analyticsPool');

exports.getExams = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query;
  try {
    const result = await pool.query(
      `SELECT e.*, t.name as term_name,
        gs.name as scale_name,
        COALESCE(
          json_agg(
            json_build_object(
              'class_id', c.id,
              'class_name', c.class_name,
              'stream_name', c.stream_name
            )
          ) FILTER (WHERE c.id IS NOT NULL), '[]'
        ) as classes
       FROM exams e
       LEFT JOIN academic_terms t ON t.id = e.term_id
       LEFT JOIN grading_scales gs ON gs.id = e.scale_id
       LEFT JOIN exam_classes ec ON ec.exam_id = e.id
       LEFT JOIN classes c ON c.id = ec.class_id
       WHERE e.school_id = $1
       ${level ? 'AND e.level_type = $2' : ''}
       GROUP BY e.id, t.name, gs.name
       ORDER BY e.created_at DESC`,
      level ? [school_id, level] : [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createExam = async (req, res) => {
  const school_id = req.school_id;
  const { name, class_ids, term_id, exam_type,
          exam_date, end_date, max_score,
          scale_id, level_type } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const examResult = await client.query(
      `INSERT INTO exams
        (school_id, name, term_id, exam_type, start_date,
         end_date, max_score, scale_id, level_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [school_id, name, term_id || null, exam_type,
       exam_date || null, end_date || null,
       max_score || 100, scale_id || null,
       level_type || 'primary']
    );
    const exam = examResult.rows[0];
    if (class_ids && class_ids.length > 0) {
      for (const class_id of class_ids) {
        await client.query(
          `INSERT INTO exam_classes (exam_id, class_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [exam.id, class_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json(exam);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.updateExam = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  const { name, class_ids, exam_type, term_id, exam_date, end_date, max_score, scale_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exams
       SET name=$1, exam_type=$2, term_id=$3, start_date=$4, end_date=$5,
           max_score=$6, scale_id=$7
       WHERE id=$8 AND school_id=$9`,
      [name, exam_type, term_id || null, exam_date || null, end_date || null,
       max_score || 100, scale_id || null, id, school_id]
    );
    if (class_ids) {
      await client.query('DELETE FROM exam_classes WHERE exam_id=$1', [id]);
      for (const class_id of class_ids) {
        await client.query(
          'INSERT INTO exam_classes (exam_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, class_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteExam = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM exams WHERE id=$1 AND school_id=$2`,
      [id, school_id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTerms = async (req, res) => {
  const school_id = req.school_id;
  try {
    const result = await pool.query(
      `SELECT * FROM academic_terms
       WHERE school_id = $1
       ORDER BY year ASC, name ASC`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
