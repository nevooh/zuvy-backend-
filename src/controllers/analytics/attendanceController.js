const pool = require('../../config/analyticsPool');

exports.getAttendanceSummary = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, date_from, date_to, level } = req.query;
  try {
    let query = `
      SELECT a.date,
        a.class_id,
        c.class_name,
        c.stream_name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE a.status='present') as present,
        COUNT(*) FILTER (WHERE a.status='absent') as absent,
        COUNT(*) FILTER (WHERE a.status='late') as late,
        ROUND(100.0 * COUNT(*) FILTER (WHERE a.status='present')
          / NULLIF(COUNT(*),0),1) as rate
      FROM attendance a
      JOIN classes c ON c.id = a.class_id
      WHERE a.school_id = $1
    `;
    const params = [school_id];
    if (level) {
      params.push(level);
      query += ` AND c.level_type = $${params.length}`;
    }
    if (class_id) {
      params.push(class_id);
      query += ` AND a.class_id = $${params.length}`;
    }
    if (date_from) {
      params.push(date_from);
      query += ` AND a.date >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      query += ` AND a.date <= $${params.length}`;
    }
    query += ` GROUP BY a.date, a.class_id,
               c.class_name, c.stream_name
               ORDER BY a.date DESC`;
    const result = await pool.query(query, params);
    console.log(`[attendance/classes] returning ${result.rows.length} classes:`, result.rows.map(r => `${r.class_name} ${r.stream_name||''}`));
    res.json(result.rows);
  } catch (err) {
    console.error(`[attendance/classes] ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getClassAttendance = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, date } = req.query;
  try {
    // Current students in this class UNION students who already have a record on this date
    const students = await pool.query(
      `SELECT DISTINCT s.id, s.full_name, s.admission_number
       FROM students s
       WHERE s.class_id = $1 AND s.school_id = $2 AND s.status = 'ACTIVE'
       UNION
       SELECT DISTINCT s.id, s.full_name, s.admission_number
       FROM students s
       JOIN attendance a ON a.student_id = s.id
       WHERE a.class_id = $1 AND a.date = $3 AND a.school_id = $2
       ORDER BY full_name`,
      [class_id, school_id, date]
    );
    const existing = await pool.query(
      `SELECT student_id, status, notes
       FROM attendance
       WHERE class_id = $1 AND date = $2
       AND school_id = $3`,
      [class_id, date, school_id]
    );
    const attMap = {};
    for (const a of existing.rows) {
      attMap[a.student_id] = {
        status: a.status,
        notes: a.notes,
      };
    }
    res.json({
      students: students.rows,
      attendance: attMap,
      date,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getActiveTerm = async (req, res) => {
  const school_id = req.school_id;
  try {
    const result = await pool.query(
      `SELECT id, name, start_date, end_date
       FROM academic_terms
       WHERE school_id = $1 AND is_active = true
       LIMIT 1`,
      [school_id]
    );
    res.json(result.rows.length > 0 ? result.rows[0] : null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTermsList = async (req, res) => {
  const school_id = req.school_id;
  console.log(`[attendance/terms] school_id=${school_id}`);
  try {
    const result = await pool.query(
      `SELECT id, name, year, start_date, end_date, is_active
       FROM academic_terms
       WHERE school_id = $1
       ORDER BY start_date DESC`,
      [school_id]
    );
    console.log(`[attendance/terms] returning ${result.rows.length} terms:`, result.rows.map(r => r.name));
    res.json(result.rows);
  } catch (err) {
    console.error(`[attendance/terms] ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.saveAttendance = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, date, entries, term_id } = req.body;

  // Guard: date must fall within the selected (or active) term
  const termQuery = term_id
    ? `SELECT start_date, end_date FROM academic_terms WHERE school_id = $1 AND id = $2 LIMIT 1`
    : `SELECT start_date, end_date FROM academic_terms WHERE school_id = $1 AND is_active = true LIMIT 1`;
  const termResult = await pool.query(termQuery, term_id ? [school_id, term_id] : [school_id]);
  if (termResult.rows.length === 0) {
    return res.status(403).json({ error: term_id ? 'Term not found' : 'No active term' });
  }
  const { start_date, end_date } = termResult.rows[0];
  const saveDate = new Date(date);
  if (saveDate < new Date(start_date) || saveDate > new Date(end_date)) {
    return res.status(403).json({ error: 'Date is outside the active term' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      await client.query(
        `INSERT INTO attendance
          (school_id, student_id, class_id, date, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (student_id, date)
         DO UPDATE SET status=$5, notes=$6`,
        [school_id, e.student_id, class_id,
         date, e.status, e.notes || null]
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

exports.getChronicAbsentees = async (req, res) => {
  const school_id = req.school_id;
  const { level, threshold = 70, date_from, date_to } = req.query;
  try {
    const params = [school_id];
    let where = `WHERE a.school_id = $1`;
    if (level)     { params.push(level);     where += ` AND c.level_type = $${params.length}`; }
    if (date_from) { params.push(date_from); where += ` AND a.date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   where += ` AND a.date <= $${params.length}`; }
    params.push(threshold);
    const result = await pool.query(
      `SELECT s.id, s.full_name, s.admission_number,
              c.class_name, c.stream_name,
              COUNT(*) as total_days,
              COUNT(*) FILTER (WHERE a.status='present') as present,
              COUNT(*) FILTER (WHERE a.status='absent') as absent,
              ROUND(100.0 * COUNT(*) FILTER (WHERE a.status='present')
                / NULLIF(COUNT(*),0),1) as rate
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       JOIN classes c ON c.id = a.class_id
       ${where}
       GROUP BY s.id, s.full_name, s.admission_number, c.class_name, c.stream_name
       HAVING ROUND(100.0 * COUNT(*) FILTER (WHERE a.status='present')
                / NULLIF(COUNT(*),0),1) < $${params.length}
       ORDER BY rate ASC LIMIT 20`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStudentAttendance = async (req, res) => {
  const school_id = req.school_id;
  const { student_id } = req.params;
  try {
    const records = await pool.query(
      `SELECT date, status, notes
       FROM attendance
       WHERE student_id=$1 AND school_id=$2
       ORDER BY date DESC LIMIT 90`,
      [student_id, school_id]
    );
    const summary = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status='present') as present,
        COUNT(*) FILTER (WHERE status='absent') as absent,
        COUNT(*) FILTER (WHERE status='late') as late
       FROM attendance
       WHERE student_id=$1 AND school_id=$2`,
      [student_id, school_id]
    );
    res.json({
      records: records.rows,
      summary: summary.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMarkedDays = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, date_from, date_to } = req.query;
  if (!class_id || !date_from || !date_to) {
    return res.status(400).json({ error: 'class_id, date_from and date_to required' });
  }
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT date)::int AS marked_days
       FROM attendance
       WHERE class_id = $1 AND school_id = $2
         AND date >= $3 AND date <= $4`,
      [class_id, school_id, date_from, date_to]
    );
    res.json({ marked_days: result.rows[0].marked_days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCalendar = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, month } = req.query; // month = "2025-05"
  if (!class_id || !month) return res.status(400).json({ error: 'class_id and month required' });
  try {
    const [year, mo] = month.split('-').map(Number);
    const dateFrom = `${month}-01`;
    const lastDay  = new Date(year, mo, 0).getDate();
    const dateTo   = `${month}-${String(lastDay).padStart(2, '0')}`;
    const result   = await pool.query(
      `SELECT a.date::text,
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE a.status='present') as present,
              COUNT(*) FILTER (WHERE a.status='absent')  as absent,
              COUNT(*) FILTER (WHERE a.status='late')    as late,
              ROUND(100.0 * COUNT(*) FILTER (WHERE a.status='present')
                / NULLIF(COUNT(*),0), 1) as rate
       FROM attendance a
       WHERE a.class_id=$1 AND a.school_id=$2
         AND a.date >= $3 AND a.date <= $4
       GROUP BY a.date ORDER BY a.date`,
      [class_id, school_id, dateFrom, dateTo]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSpreadsheet = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, date_from, date_to } = req.query;
  if (!class_id) return res.status(400).json({ error: 'class_id required' });
  try {
    const students = await pool.query(
      `SELECT id, full_name, admission_number FROM students
       WHERE class_id = $1 AND school_id = $2 AND status = 'ACTIVE'
       ORDER BY full_name`,
      [class_id, school_id]
    );
    let q = `SELECT student_id, date::text, status FROM attendance
             WHERE class_id = $1 AND school_id = $2`;
    const p = [class_id, school_id];
    if (date_from) { p.push(date_from); q += ` AND date >= $${p.length}`; }
    if (date_to)   { p.push(date_to);   q += ` AND date <= $${p.length}`; }
    q += ` ORDER BY date`;
    const att = await pool.query(q, p);
    const dateSet = new Set(att.rows.map(r => r.date));
    const dates = Array.from(dateSet).sort();
    const records = {};
    for (const r of att.rows) {
      if (!records[r.student_id]) records[r.student_id] = {};
      records[r.student_id][r.date] = r.status;
    }
    res.json({ students: students.rows, dates, records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClassesForLevel = async (req, res) => {
  const school_id = req.school_id;
  const { level, date_from, date_to } = req.query;
  console.log(`[attendance/classes] school_id=${school_id} level=${level} date_from=${date_from} date_to=${date_to}`);
  try {
    // Always show:
    //   1. Currently active classes (so you can mark attendance for the current term)
    //   2. Any archived class that already has attendance records in the term's date range
    //      (so old terms show the right historical classes after records exist)
    // When no date range is passed, or no records exist yet — only active classes show.
    const query = `
      SELECT DISTINCT c.id, c.class_name, c.stream_name, c.is_archived, c.level_order
      FROM classes c
      WHERE c.school_id = $1 AND c.level_type = $2
        AND (
          (c.is_archived = false OR c.is_archived IS NULL)
          ${date_from && date_to ? `
          OR EXISTS (
            SELECT 1 FROM attendance a
            WHERE a.class_id = c.id AND a.school_id = c.school_id
              AND a.date >= $3 AND a.date <= $4
          )` : ''}
        )
      ORDER BY c.is_archived ASC NULLS FIRST, c.level_order`;
    const params = date_from && date_to
      ? [school_id, level || 'primary', date_from, date_to]
      : [school_id, level || 'primary'];
    const result = await pool.query(query, params);
    console.log(`[attendance/classes] returning ${result.rows.length} classes:`,
      result.rows.map(r => `${r.class_name} ${r.stream_name||''} (${r.is_archived ? 'archived' : 'active'})`));
    res.json(result.rows);
  } catch (err) {
    console.error(`[attendance/classes] ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
};
