const pool = require('../../config/analyticsPool');

exports.getStudents = async (req, res) => {
  const school_id = req.school_id;
  const { search, class_id, level_type = 'primary' } = req.query;

  try {
    let query = `
      SELECT s.id, s.full_name, s.admission_number, s.gender,
             s.status, c.class_name, c.stream_name, c.level_type
      FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.school_id = $1 AND c.level_type = $2
    `;
    const params = [school_id, level_type];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (s.full_name ILIKE $${params.length}
                 OR s.admission_number ILIKE $${params.length})`;
    }

    if (class_id) {
      params.push(class_id);
      query += ` AND s.class_id = $${params.length}`;
    }

    query += ` ORDER BY c.level_order, s.full_name`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClasses = async (req, res) => {
  const school_id = req.school_id;
  const { level_type = 'primary' } = req.query;
  try {
    const result = await pool.query(
      `SELECT id, class_name, stream_name, level_type
       FROM classes WHERE school_id = $1 AND level_type = $2
         AND (is_archived = false OR is_archived IS NULL)
       ORDER BY level_order`,
      [school_id, level_type]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
