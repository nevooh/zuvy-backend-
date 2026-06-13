const pool = require('../../config/analyticsPool');

// 1. Get Subjects - Now filtered by level (query param)
exports.getSubjects = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query; // e.g., 'jss', 'primary'

  try {
    let query = `SELECT * FROM subjects WHERE school_id = $1`;
    const params = [school_id];
    if (level) {
      query += ` AND school_level = $2`;
      params.push(level);
    }
    query += ` ORDER BY school_level, is_core DESC, name ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Create Subject - Now includes school_level in the INSERT
exports.createSubject = async (req, res) => {
  const school_id = req.school_id;
  const { name, code, short_form, is_core, school_level } = req.body;
  const level = school_level || 'primary';
  try {
    // Pre-check: surface a clear error if this school already has this subject
    const dup = await pool.query(
      `SELECT id FROM subjects
       WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND school_level = $3`,
      [school_id, name, level]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: `"${name}" already exists in your school for this level.` });
    }

    const result = await pool.query(
      `INSERT INTO subjects (school_id, name, code, short_form, is_core, school_level)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [school_id, name, code || null, short_form || null, is_core ?? true, level]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // Check if this school already owns the conflicting subject
      try {
        const own = await pool.query(
          `SELECT id FROM subjects WHERE school_id = $1 AND LOWER(name) = LOWER($2)`,
          [school_id, name]
        );
        if (own.rows.length > 0) {
          return res.status(400).json({ error: `"${name}" already exists in your school.` });
        }
      } catch (_) { /* ignore */ }
      // Cross-school uniqueness conflict — will be resolved after migration 007
      return res.status(400).json({ error: `Could not save "${name}". Please restart the server to apply the latest database fix, then try again.` });
    }
    res.status(500).json({ error: err.message });
  }
};

// 3. Update Subject - Standardized with school_level
exports.updateSubject = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  const { name, code, short_form, is_core, school_level } = req.body;
  try {
    const result = await pool.query(
      `UPDATE subjects
       SET name=$1, code=$2, short_form=$3, is_core=$4, school_level=$5
       WHERE id=$6 AND school_id=$7
       RETURNING *`,
      [name, code, short_form || null, is_core, school_level, id, school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 4. Delete Subject - (No changes needed, uses unique ID)
exports.deleteSubject = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM subjects WHERE id=$1 AND school_id=$2`,
      [id, school_id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 5. Get Subjects Assigned to a Specific Class
exports.getClassSubjects = async (req, res) => {
  const school_id = req.school_id;
  const { class_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT s.* FROM subjects s
       JOIN class_subjects cs ON cs.subject_id = s.id
       WHERE cs.class_id = $1 AND s.school_id = $2
       ORDER BY s.is_core DESC, s.name ASC`,
      [class_id, school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 6. Assign Subject to Class
exports.assignSubjectToClass = async (req, res) => {
  const { class_id, subject_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO class_subjects (class_id, subject_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [class_id, subject_id]
    );
    res.json({ message: 'Assigned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 7. Remove Subject from Class
exports.removeSubjectFromClass = async (req, res) => {
  const { class_id, subject_id } = req.params;
  try {
    await pool.query(
      `DELETE FROM class_subjects 
       WHERE class_id=$1 AND subject_id=$2`,
      [class_id, subject_id]
    );
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
