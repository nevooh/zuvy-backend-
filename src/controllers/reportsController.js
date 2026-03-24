const { pool } = require('../config/db');

// You must define getFinanceSummary here as well
exports.getFinanceSummary = async (req, res) => {
  // Your existing logic for finance summary
};

exports.getFinanceHistory = async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const query = `
      SELECT t.name AS term_name, t.year, v.* FROM v_class_termly_reports v
      JOIN academic_terms t ON v.term_id = t.id
      WHERE t.school_id = $1 
      ORDER BY t.year DESC, t.name DESC;
    `;
    const result = await pool.query(query, [school_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getActiveFinance = async (req, res) => {
  const school_id = req.user.school_id;
  console.log("DEBUG: Querying active finance for school:", school_id);
  
  try {
    const query = `
      SELECT t.name AS term_name, t.year, v.* FROM v_class_termly_reports v
      JOIN academic_terms t ON v.term_id = t.id
      WHERE t.school_id = $1 AND t.is_active = true;
    `;
    const result = await pool.query(query, [school_id]);
    console.log("DEBUG: Rows found:", result.rows.length);
    res.json(result.rows);
  } catch (err) {
    console.error("DEBUG: Query Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getClassTermlyReports = async (req, res) => {
  const school_id = req.user.school_id;

  try {
    const query = `
      SELECT 
        t.name AS term_name,
        t.year,
        TO_CHAR(t.start_date, 'Mon FMDD YYYY') AS start_date,
        TO_CHAR(t.end_date, 'Mon FMDD YYYY') AS end_date,
        v.*,
        (v.expected_amount - v.paid_amount) AS balance
      FROM v_class_termly_reports v
      JOIN academic_terms t ON v.term_id = t.id
      WHERE t.school_id = $1 
      ORDER BY t.year DESC, t.name DESC;
    `;

    const result = await pool.query(query, [school_id]);
    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getClassStreams = async (req, res) => {
  const { className } = req.params;
  const school_id = req.user.school_id;
  // This query groups by stream for a specific class
  const query = `
    SELECT stream_name, SUM(expected_amount) as expected, SUM(paid_amount) as paid 
    FROM v_class_termly_reports 
    WHERE class_name = $1 AND school_id = $2 
    GROUP BY stream_name;
  `;
  const result = await pool.query(query, [className, school_id]);
  res.json(result.rows);
};
exports.getGeneralFinanceSummary = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const query = `
            SELECT 
                t.id,
                t.year, 
                t.name AS term_name,
                t.is_active,
                SUM(si.total_amount) AS expected,
                COALESCE(p.total_paid, 0) AS paid,
                -- Calculate balance directly in SQL
                (SUM(si.total_amount) - COALESCE(p.total_paid, 0)) AS balance
            FROM academic_terms t
            LEFT JOIN student_invoices si ON t.id = si.term_id
            LEFT JOIN (
                SELECT term_id, SUM(amount_paid) as total_paid 
                FROM payments 
                GROUP BY term_id
            ) p ON t.id = p.term_id
            WHERE t.school_id = $1 
            AND (t.is_locked = true OR t.is_active = true)
            GROUP BY t.id, t.year, t.name, t.start_date, p.total_paid
            ORDER BY t.start_date DESC;
        `;
        const result = await pool.query(query, [school_id]);
        res.json(result.rows);
    } catch (err) {
        console.error("SQL Error Details:", err.message);
        res.status(500).json({ error: "Server error fetching general reports" });
    }
};

// ... existing exports ...

exports.getAllTerms = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const query = `
            SELECT id, name, year, is_active 
            FROM academic_terms 
            WHERE school_id = $1 
            ORDER BY start_date DESC;
        `;
        const result = await pool.query(query, [school_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};