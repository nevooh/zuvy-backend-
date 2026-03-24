const { pool } = require('../config/db');

/**
 * Create fee type
 */
exports.createFeeType = async (req, res) => {
  const { name, is_optional } = req.body;
  const school_id = req.user.school_id;

  try {
    const result = await pool.query(
      `INSERT INTO fee_types (school_id, name, is_optional)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [school_id, name, is_optional]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get fee types
 */
exports.getFeeTypes = async (req, res) => {
  const school_id = req.user.school_id;

  try {
    const result = await pool.query(
      `SELECT * FROM fee_types
       WHERE school_id=$1
       ORDER BY name ASC`,
      [school_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
