const { pool } = require('../config/db');

/**
 * Set fees for a class in a term
 */
exports.setClassFees = async (req, res) => {
  const { class_id, term_id, fees } = req.body;
  const school_id = req.user.school_id;

  try {
    // Check term status
    const term = await pool.query(
      `SELECT status FROM academic_terms
       WHERE id=$1 AND school_id=$2`,
      [term_id, school_id]
    );

    if (!term.rows.length || term.rows[0].status !== 'UPCOMING') {
      return res.status(400).json({
        message: 'Fees can only be set for UPCOMING terms'
      });
    }

    await pool.query('BEGIN');

    for (const fee of fees) {
      await pool.query(
        `INSERT INTO class_fee_structure
         (school_id, class_id, term_id, fee_type_id, amount)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (class_id, term_id, fee_type_id)
         DO UPDATE SET amount = EXCLUDED.amount`,
        [school_id, class_id, term_id, fee.fee_type_id, fee.amount]
      );
    }

    await pool.query('COMMIT');

    res.json({ message: 'Class fees saved successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get fees for a class in a term
 */
exports.getClassFees = async (req, res) => {
  const { class_id, term_id } = req.params;
  const school_id = req.user.school_id;

  try {
    const result = await pool.query(
      `SELECT cfs.*, ft.name AS fee_name
       FROM class_fee_structure cfs
       JOIN fee_types ft ON ft.id = cfs.fee_type_id
       WHERE cfs.school_id=$1
         AND cfs.class_id=$2
         AND cfs.term_id=$3`,
      [school_id, class_id, term_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
