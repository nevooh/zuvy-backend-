const pool = require('../../config/analyticsPool');
const { seedDefaultGrading } = require('../../utils/seedDefaultGrading');

exports.getScales = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query;
  // Silently seed defaults on first load (no-op if already seeded)
  seedDefaultGrading(school_id, pool).catch(() => {});
  try {
    const result = await pool.query(
      `SELECT id, name, is_default, school_level, subjects_to_count, created_at
       FROM grading_scales
       WHERE school_id = $1 ${level ? 'AND school_level = $2' : ''}
       ORDER BY is_default DESC, created_at ASC`,
      level ? [school_id, level] : [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createScale = async (req, res) => {
  const school_id = req.school_id;
  const { name, is_default, school_level, subjects_to_count } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_default) {
      await client.query(
        `UPDATE grading_scales SET is_default = false 
         WHERE school_id = $1 AND school_level = $2`,
        [school_id, school_level || 'primary']
      );
    }
    const result = await client.query(
      `INSERT INTO grading_scales 
        (school_id, name, is_default, school_level, subjects_to_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [school_id, name, is_default || false,
       school_level || 'primary', subjects_to_count || 7]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteScale = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    const check = await pool.query(
      `SELECT is_default FROM grading_scales WHERE id = $1 AND school_id = $2`,
      [id, school_id]
    );
    if (check.rows[0]?.is_default) {
      return res.status(403).json({ error: 'Cannot delete the default grading scale' });
    }
    await pool.query(
      `DELETE FROM grading_scales WHERE id = $1 AND school_id = $2`,
      [id, school_id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setDefault = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scaleRes = await client.query(
      `SELECT school_level FROM grading_scales WHERE id = $1`,
      [id]
    );
    const level = scaleRes.rows[0]?.school_level || 'primary';
    await client.query(
      `UPDATE grading_scales SET is_default = false 
       WHERE school_id = $1 AND school_level = $2`,
      [school_id, level]
    );
    await client.query(
      `UPDATE grading_scales SET is_default = true 
       WHERE id = $1 AND school_id = $2`,
      [id, school_id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Default set' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getScaleSubjects = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    const scaleRes = await pool.query(
      `SELECT school_level FROM grading_scales WHERE id = $1`,
      [id]
    );
    const level = scaleRes.rows[0]?.school_level || 'primary';
    const result = await pool.query(
      `SELECT id, name, code, is_core
       FROM subjects
       WHERE school_id = $1 AND school_level = $2
       ORDER BY is_core DESC, name ASC`,
      [school_id, level]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSubjectClasses = async (req, res) => {
  const school_id = req.school_id;
  const { id, subject_id } = req.params;
  try {
    const scaleRes = await pool.query(
      `SELECT school_level FROM grading_scales WHERE id = $1`,
      [id]
    );
    const level = scaleRes.rows[0]?.school_level || 'primary';
    const allClasses = await pool.query(
      `SELECT id, class_name, stream_name FROM classes
       WHERE school_id = $1 AND level_type = $2
         AND (is_archived = false OR is_archived IS NULL)
       ORDER BY level_order`,
      [school_id, level]
    );
    const configured = await pool.query(
      `SELECT DISTINCT class_id FROM grade_bands
       WHERE scale_id = $1 AND subject_id = $2`,
      [id, subject_id]
    );
    const configuredIds = configured.rows.map(r => r.class_id?.toString());
    const classes = allClasses.rows.map(c => ({
      ...c,
      has_bands: configuredIds.includes(c.id.toString()),
    }));
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBands = async (req, res) => {
  const { id, subject_id, class_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM grade_bands
       WHERE scale_id = $1 AND subject_id = $2 AND class_id = $3
       ORDER BY min_score DESC`,
      [id, subject_id, class_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveBands = async (req, res) => {
  const { id, subject_id, class_id } = req.params;
  const { bands } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM grade_bands
       WHERE scale_id = $1 AND subject_id = $2 AND class_id = $3`,
      [id, subject_id, class_id]
    );
    for (const b of bands) {
      await client.query(
        `INSERT INTO grade_bands
          (scale_id, subject_id, class_id, min_score, max_score,
           label, description, points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, subject_id, class_id,
         parseFloat(b.min_score), parseFloat(b.max_score),
         b.label || null, b.description || null,
         b.points ? parseFloat(b.points) : null]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Saved' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getScaleClasses = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    const scaleRes = await pool.query(
      `SELECT school_level FROM grading_scales WHERE id = $1`,
      [id]
    );
    const level = scaleRes.rows[0]?.school_level || 'primary';
    const result = await pool.query(
      `SELECT id, class_name, stream_name FROM classes
       WHERE school_id = $1 AND level_type = $2
         AND (is_archived = false OR is_archived IS NULL)
       ORDER BY level_order`,
      [school_id, level]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.bulkSaveBands = async (req, res) => {
  const { id } = req.params;
  const { subject_ids, class_ids, bands } = req.body;
  if (!Array.isArray(subject_ids) || !Array.isArray(class_ids) || !Array.isArray(bands)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const subject_id of subject_ids) {
      for (const class_id of class_ids) {
        await client.query(
          `DELETE FROM grade_bands WHERE scale_id = $1 AND subject_id = $2 AND class_id = $3`,
          [id, subject_id, class_id]
        );
        for (const b of bands) {
          await client.query(
            `INSERT INTO grade_bands
              (scale_id, subject_id, class_id, min_score, max_score, label, description, points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, subject_id, class_id,
             parseFloat(b.min_score), parseFloat(b.max_score),
             b.label || null, b.description || null,
             b.points ? parseFloat(b.points) : null]
          );
        }
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Saved', combinations: subject_ids.length * class_ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getScaleOverview = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         s.id   AS subject_id,   s.name AS subject_name,
         c.id   AS class_id,     c.class_name,
         gb.label, gb.min_score, gb.max_score, gb.points, gb.description
       FROM grade_bands gb
       JOIN subjects s ON s.id = gb.subject_id
       JOIN classes  c ON c.id = gb.class_id
       WHERE gb.scale_id = $1
       ORDER BY s.name, c.class_name, gb.min_score DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.copyBands = async (req, res) => {
  const { id } = req.params;
  const {
    from_subject_id, from_class_id,
    to_subject_id, to_class_id
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const source = await client.query(
      `SELECT min_score, max_score, label, description, points
       FROM grade_bands
       WHERE scale_id=$1 AND subject_id=$2 AND class_id=$3`,
      [id, from_subject_id, from_class_id]
    );
    if (source.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No bands found to copy from'
      });
    }
    await client.query(
      `DELETE FROM grade_bands
       WHERE scale_id=$1 AND subject_id=$2 AND class_id=$3`,
      [id, to_subject_id, to_class_id]
    );
    for (const b of source.rows) {
      await client.query(
        `INSERT INTO grade_bands
          (scale_id, subject_id, class_id, min_score,
           max_score, label, description, points)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, to_subject_id, to_class_id,
         b.min_score, b.max_score,
         b.label, b.description, b.points]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Bands copied' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
