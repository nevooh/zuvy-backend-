const pool = require('../../config/analyticsPool');

// â”€â”€ helper: compute band + points â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const computeBand = (perc, gradeLevel) => {
  gradeLevel = Number(gradeLevel); 
  if (gradeLevel === 7) { // JSS
    if (perc >= 90) return { band: 'EE1', points: 8 };
    if (perc >= 75) return { band: 'EE2', points: 7 };
    if (perc >= 58) return { band: 'ME1', points: 6 };
    if (perc >= 41) return { band: 'ME2', points: 5 };
    if (perc >= 31) return { band: 'AE1', points: 4 };
    if (perc >= 21) return { band: 'AE2', points: 3 };
    if (perc >= 11) return { band: 'BE1', points: 2 };
    return { band: 'BE2', points: 1 };
  } else { // Primary
    if (perc >= 75) return { band: 'EE',  points: null };
    if (perc >= 50) return { band: 'ME',  points: null };
    if (perc >= 30) return { band: 'AE',  points: null };
    return { band: 'BE', points: null };
  }
};

// â”€â”€ GET /sba/active â€” active or most recent term â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getActiveTerm = async (req, res) => {
  const schoolId = req.school_id;

  try {
    let result = await pool.query(
      `SELECT * FROM academic_terms
       WHERE school_id = $1 AND is_active = true
       LIMIT 1`,
      [schoolId]
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT * FROM academic_terms
         WHERE school_id = $1
         ORDER BY end_date DESC
         LIMIT 1`,
        [schoolId]
      );
    }

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'No term found.' });

    return res.status(200).json({ success: true, term: result.rows[0] });

  } catch (err) {
    console.error('[getActiveTerm]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// getProjects â€” filter by level
// â”€â”€ GET /sba/projects â€” filter by level, return assessment_type + class_ids â”€â”€
exports.getProjects = async (req, res) => {
  const schoolId = req.school_id;
  const { level } = req.query;

  try {
    const result = await pool.query(
      `SELECT
         id, name, type, assessment_type, created_at,
         COALESCE(class_ids, '{}') AS class_ids
       FROM sba_projects
       WHERE school_id = $1
         AND level     = $2
       ORDER BY created_at DESC`,
      [schoolId, level || 'primary']
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('[getProjects]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ POST /sba/projects â€” store assessment_type + class_ids â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.createProject = async (req, res) => {
  const schoolId = req.school_id;
  const userId   = req.user_id;
  const { name, type, assessment_type, level, class_ids } = req.body;

  if (!name || !type || !assessment_type || !level)
    return res.status(400).json({
      success: false,
      message: 'name, type, assessment_type and level are required.',
    });

  try {
    const result = await pool.query(
      `INSERT INTO sba_projects
         (school_id, name, type, assessment_type, level, class_ids, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, type, assessment_type, created_at,
                 COALESCE(class_ids, '{}') AS class_ids`,
      [
        schoolId,
        name.trim(),
        type.trim(),
        assessment_type.trim(),
        level.trim(),
        class_ids && class_ids.length > 0 ? class_ids : null,
        userId,
      ]
    );
    return res.status(201).json({ success: true, project: result.rows[0] });
  } catch (err) {
    console.error('[createProject]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ GET /sba/classes â€” classes for level â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getClasses = async (req, res) => {
  const schoolId = req.school_id;
  const { level } = req.query;

  try {
    const result = await pool.query(
      `SELECT id, class_name, stream_name, level_type, level_order
       FROM classes
       WHERE school_id  = $1
         AND level_type = $2
         AND (is_archived = false OR is_archived IS NULL)
       ORDER BY level_order ASC, class_name ASC`,
      [schoolId, level]
    );
    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('[getClasses]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ GET /sba/students â€” students by class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getStudents = async (req, res) => {
  const schoolId = req.school_id;
  const { class_id, project_id } = req.query;

  if (!class_id)
    return res.status(400).json({ success: false, message: 'class_id required.' });

  try {
    let result;
    if (project_id) {
      // Union current students + students who have records in this project
      // so old SBA data remains accessible after year-end promotion
      result = await pool.query(
        `SELECT DISTINCT s.id, s.full_name, s.admission_number, s.gender
         FROM students s
         WHERE s.school_id = $1
           AND (
             (s.class_id = $2 AND s.status = 'ACTIVE')
             OR s.id IN (
               SELECT learner_id FROM sba_assessments
               WHERE class_id = $2 AND project_id = $3
             )
           )
         ORDER BY s.full_name ASC`,
        [schoolId, class_id, project_id]
      );
    } else {
      result = await pool.query(
        `SELECT id, full_name, admission_number, gender
         FROM students
         WHERE class_id  = $1
           AND school_id = $2
           AND status    = 'ACTIVE'
         ORDER BY full_name ASC`,
        [class_id, schoolId]
      );
    }
    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('[getStudents]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ GET /sba/class_subjects â€” subjects for a class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getClassSubjects = async (req, res) => {
  const schoolId = req.school_id;
  const { class_id } = req.query;

  if (!class_id)
    return res.status(400).json({ success: false, message: 'class_id required.' });

  try {
    const result = await pool.query(
      `SELECT s.id, s.name
       FROM class_subjects cs
       JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.class_id = $1
       ORDER BY s.name ASC`,
      [class_id]
    );
    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('[getClassSubjects]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ GET /sba/list â€” all SBA records â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getSbaList = async (req, res) => {
  const schoolId = req.school_id;
  const { grade_level, class_id, subject_id, project_id } = req.query;

  try {
    const conditions = ['sa.school_id = $1'];
    const params     = [schoolId];
    let   idx        = 2;

    if (grade_level) {
      conditions.push(`sa.grade_level = $${idx++}`);
      params.push(parseInt(grade_level));
    }
    if (class_id) {
      conditions.push(`sa.class_id = $${idx++}`);
      params.push(class_id);
    }
    if (subject_id) {
      conditions.push(`sa.subject_id = $${idx++}`);
      params.push(subject_id);
    }
    if (project_id) {
      conditions.push(`sa.project_id = $${idx++}`);
      params.push(project_id);
    }

    const result = await pool.query(
      `SELECT
         sa.id,
         sa.learner_id,
         st.full_name          AS learner_name,
         sa.subject_id,
         sub.name              AS subject_name,
         sa.assessment_type,
         sa.raw_obtained,
         sa.raw_total,
         sa.calculated_percentage,
         sa.performance_band,
         sa.points,
         sa.assessment_date,
         sa.evidence_note,
         sa.term,
         sa.project_id
       FROM sba_assessments sa
       JOIN students st  ON st.id  = sa.learner_id
       JOIN subjects sub ON sub.id = sa.subject_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY sa.created_at DESC`,
      params
    );

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('[getSbaList]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ POST /sba/record â€” save an SBA record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.recordSba = async (req, res) => {
  const schoolId = req.school_id;
  const {
    learner_id,
    subject_id,
    class_id,
    grade_level,
    term_id,
    assessment_type,
    raw_obtained,
    raw_total,
    evidence_note,
    media_urls,
    project_id,     // â† new
  } = req.body;

  if (!learner_id || !subject_id || !class_id ||
      !grade_level || !term_id || !assessment_type ||
      raw_obtained == null || raw_total == null)
    return res.status(400).json({ success: false, message: 'Missing required fields.' });

  if (raw_total <= 0)
    return res.status(400).json({ success: false, message: 'Total marks must be greater than 0.' });

  try {
    // Resolve term number from academic_terms
    const termResult = await pool.query(
  `SELECT name FROM academic_terms WHERE id = $1`,
  [term_id]
);
let termNumber = 1;
if (termResult.rows.length > 0) {
  const termName = termResult.rows[0].name || '';
  const match    = termName.match(/\d+/);
  if (match) termNumber = parseInt(match[0]);
}

    // Compute band + points
    const perc = (raw_obtained / raw_total) * 100;
    const { band, points } = computeBand(perc, parseInt(grade_level));

    const result = await pool.query(
      `INSERT INTO sba_assessments
         (school_id, learner_id, subject_id, class_id,
          grade_level, term, assessment_type,
          raw_obtained, raw_total,
          performance_band, points,
          evidence_note, media_urls,
          project_id)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        schoolId, learner_id, subject_id, class_id,
        parseInt(grade_level), termNumber, assessment_type,
        raw_obtained, raw_total,
        band, points,
        evidence_note || null,
        media_urls    || null,
        project_id    || null,
      ]
    );

    return res.status(201).json({
      success: true,
      id: result.rows[0]?.id,
    });

  } catch (err) {
    console.error('[recordSba]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ GET /sba/assessment-types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getAssessmentTypes = async (req, res) => {
  return res.status(200).json([
    'Project', 'Practical', 'Written Test',
    'Observation', 'Oral Assessment',
    'Portfolio', 'Performance Task', 'Other',
  ]);
};
// â”€â”€ PUT /sba/record/:id â€” edit an SBA record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.updateSba = async (req, res) => {
  const schoolId = req.school_id;
  const { id }   = req.params;
  const {
    subject_id,
    assessment_type,
    raw_obtained,
    raw_total,
    evidence_note,
    grade_level,
  } = req.body;

  if (raw_total <= 0)
    return res.status(400).json({ success: false, message: 'Total marks must be greater than 0.' });

  if (raw_obtained > raw_total)
    return res.status(400).json({ success: false, message: 'Obtained cannot exceed total.' });

  try {
    // Make sure this record belongs to this school
    const check = await pool.query(
      `SELECT id FROM sba_assessments WHERE id = $1 AND school_id = $2`,
      [id, schoolId]
    );
    if (check.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Record not found.' });

    // Recompute band
    const perc = (raw_obtained / raw_total) * 100;
    const { band, points } = computeBand(perc, parseInt(grade_level));

    const result = await pool.query(
      `UPDATE sba_assessments
       SET
         subject_id             = COALESCE($1, subject_id),
         assessment_type        = COALESCE($2, assessment_type),
         raw_obtained           = $3,
         raw_total              = $4,
         calculated_percentage  = $5,
         performance_band       = $6,
         points                 = $7,
         evidence_note          = $8
       WHERE id = $9 AND school_id = $10
       RETURNING id, raw_obtained, raw_total, calculated_percentage,
                 performance_band, points, assessment_type, subject_id`,
      [
        subject_id    || null,
        assessment_type || null,
        raw_obtained,
        raw_total,
        perc,
        band,
        points,
        evidence_note || null,
        id,
        schoolId,
      ]
    );

    return res.status(200).json({ success: true, record: result.rows[0] });

  } catch (err) {
    console.error('[updateSba]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// â”€â”€ DELETE /sba/record/:id â€” delete an SBA record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.deleteSba = async (req, res) => {
  const schoolId = req.school_id;
  const { id }   = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM sba_assessments
       WHERE id = $1 AND school_id = $2
       RETURNING id`,
      [id, schoolId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Record not found.' });

    return res.status(200).json({ success: true, deleted: id });

  } catch (err) {
    console.error('[deleteSba]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
