const pool = require('../../config/analyticsPool');

exports.getStudentFullHistory = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    // ── Round 1: student + school in parallel ─────────────────────────────────
    const [studentRes, schoolRes] = await Promise.all([
      pool.query(
        `SELECT s.*, c.class_name, c.stream_name, c.level_type, c.academic_year
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
         WHERE s.id = $1 AND s.school_id = $2`,
        [id, school_id]
      ),
      pool.query(
        `SELECT s.name as school_name, sp.logo_url, sp.motto, sp.phone_primary, sp.town_city
         FROM schools s LEFT JOIN school_profiles sp ON sp.school_id = s.id
         WHERE s.id = $1`,
        [school_id]
      ),
    ]);

    if (!studentRes.rows[0]) return res.status(404).json({ error: 'Not found' });
    const student = studentRes.rows[0];
    const admDate = student.admission_date || student.created_at;
    const daysInSchool = admDate
      ? Math.floor((Date.now() - new Date(admDate).getTime()) / 86400000) : null;

    // ── Round 2: relevant terms ───────────────────────────────────────────────
    const termsRes = await pool.query(
      `SELECT DISTINCT at.id, at.name, at.year, at.start_date, at.end_date, at.is_active
       FROM academic_terms at
       LEFT JOIN exams e2   ON e2.term_id = at.id AND e2.school_id = at.school_id
       LEFT JOIN results r2 ON r2.exam_id = e2.id AND r2.student_id = $2
       WHERE at.school_id = $1
         AND (at.is_active = true OR r2.id IS NOT NULL)
       ORDER BY at.is_active DESC NULLS LAST, at.year DESC NULLS LAST,
                at.start_date DESC NULLS LAST`,
      [school_id, id]
    );

    const terms   = termsRes.rows;
    const termIds = terms.map(t => t.id);

    // ── Round 3: all per-term data in PARALLEL (replaces N×3 sequential) ─────
    const [classRows, attRows, examRows, subjectAvgsRes] = await Promise.all([

      // most-attended class per term (one row per term)
      pool.query(
        `SELECT DISTINCT ON (sq.term_id) sq.*
         FROM (
           SELECT t.id AS term_id,
                  c.class_name, c.stream_name, c.academic_year,
                  COUNT(a.id)::int AS days_count
           FROM academic_terms t
           JOIN attendance a ON a.student_id = $1
             AND a.date >= t.start_date AND a.date <= t.end_date
           JOIN classes c ON c.id = a.class_id
           WHERE t.id = ANY($2::uuid[])
           GROUP BY t.id, c.class_name, c.stream_name, c.academic_year
         ) sq
         ORDER BY sq.term_id, sq.days_count DESC`,
        [id, termIds]
      ),

      // attendance totals per term
      pool.query(
        `SELECT t.id AS term_id,
                COUNT(a.id)::int                                        AS total,
                COUNT(a.id) FILTER (WHERE a.status='present')::int     AS present,
                COUNT(a.id) FILTER (WHERE a.status='absent')::int      AS absent,
                COUNT(a.id) FILTER (WHERE a.status='late')::int        AS late
         FROM academic_terms t
         LEFT JOIN attendance a ON a.student_id = $1
           AND a.date >= t.start_date AND a.date <= t.end_date
         WHERE t.id = ANY($2::uuid[])
         GROUP BY t.id`,
        [id, termIds]
      ),

      // all exams + ALL class subjects (LEFT JOIN so not-taken appear with nulls)
      pool.query(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (e.id, sub.id)
                  e.id, e.name, e.exam_type, e.max_score, e.start_date, e.term_id,
                  r.score, r.grade, r.points, r.max_score AS r_max,
                  sub.name AS subject_name, sub.code, sub.is_core
           FROM exams e
           JOIN exam_classes ec  ON ec.exam_id  = e.id
           JOIN class_subjects cs ON cs.class_id = ec.class_id
           JOIN subjects sub     ON sub.id       = cs.subject_id
           LEFT JOIN results r   ON r.exam_id    = e.id
                                AND r.student_id = $1
                                AND r.subject_id = sub.id
           WHERE e.term_id = ANY($2::uuid[]) AND e.school_id = $3
           ORDER BY e.id, sub.id, r.score DESC NULLS LAST
         ) deduped
         ORDER BY term_id, start_date DESC, is_core DESC, subject_name`,
        [id, termIds, school_id]
      ),

      // all-time subject averages
      pool.query(
        `SELECT sub.name AS subject_name,
                ROUND(AVG(r.score), 1) AS avg_score,
                MIN(r.score)::numeric  AS min_score,
                MAX(r.score)::numeric  AS max_score,
                COUNT(r.id)::int       AS exam_count
         FROM results r JOIN subjects sub ON sub.id = r.subject_id
         WHERE r.student_id = $1
         GROUP BY sub.name ORDER BY avg_score DESC`,
        [id]
      ),
    ]);

    // ── Build lookup maps ─────────────────────────────────────────────────────
    const classMap = {};
    for (const row of classRows.rows) classMap[row.term_id] = row;

    const attMap = {};
    for (const row of attRows.rows) attMap[row.term_id] = row;

    const examsByTerm = {};
    for (const row of examRows.rows) {
      const tid = row.term_id;
      if (!examsByTerm[tid]) examsByTerm[tid] = {};
      if (!examsByTerm[tid][row.id]) {
        examsByTerm[tid][row.id] = {
          id: row.id, name: row.name, exam_type: row.exam_type,
          start_date: row.start_date, subjects: [],
        };
      }
      if (row.subject_name) {
        const notTaken = row.score === null && row.grade === null;
        examsByTerm[tid][row.id].subjects.push({
          subject_name: row.subject_name,
          code:         row.code,
          is_core:      row.is_core,
          score:        notTaken ? null : parseFloat(row.score),
          max_score:    parseFloat(row.r_max || row.max_score || 100),
          grade:        row.grade,
          not_taken:    notTaken,
        });
      }
    }

    // ── Assemble term history ─────────────────────────────────────────────────
    const termHistory = terms.map(term => {
      const att  = attMap[term.id] || { total: 0, present: 0, absent: 0, late: 0 };
      const exams = Object.values(examsByTerm[term.id] || {}).map(e => {
        const ts = e.subjects.reduce((s, r) => s + (r.score !== null ? r.score : 0), 0);
        const tm = e.subjects.reduce((s, r) => s + r.max_score, 0);
        return { ...e, total_score: +ts.toFixed(1), total_max: +tm.toFixed(1),
                 percentage: tm > 0 ? +(ts / tm * 100).toFixed(1) : 0 };
      });
      return {
        term: {
          id: term.id, name: term.name, year: term.year,
          start_date: term.start_date, end_date: term.end_date,
          is_active: term.is_active,
        },
        class_info: classMap[term.id] || null,
        attendance: {
          total: att.total, present: att.present,
          absent: att.absent, late: att.late,
          rate: att.total > 0 ? Math.round(att.present / att.total * 100) : 0,
        },
        exams,
      };
    });

    res.json({
      profile:          student,
      school:           schoolRes.rows[0] || {},
      days_in_school:   daysInSchool,
      term_history:     termHistory,
      subject_averages: subjectAvgsRes.rows,
    });
  } catch (err) {
    console.error('getStudentFullHistory error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getStudentProfile = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;

  try {
    // basic info
    const student = await pool.query(
      `SELECT s.*, c.class_name, c.stream_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [id, school_id]
    );

    if (!student.rows[0]) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // results
   // Fix the results query
const results = await pool.query(
  `SELECT r.score, r.max_score, r.grade, r.remarks,
          e.name as exam_name, e.exam_type, e.start_date as exam_date, -- Alias it here
          sub.name as subject_name
   FROM results r
   JOIN exams e ON e.id = r.exam_id
   JOIN subjects sub ON sub.id = r.subject_id
   WHERE r.student_id = $1
   ORDER BY e.start_date DESC`, // Change ordering column
  [id]
);
    // active/latest term for scoping attendance
    const termRes = await pool.query(
      `SELECT id, name, year, start_date, end_date FROM academic_terms
       WHERE school_id = $1
       ORDER BY is_active DESC, start_date DESC LIMIT 1`,
      [school_id]
    );
    const term = termRes.rows[0];

    // attendance summary — scoped to active/latest term
    const attendance = term
      ? await pool.query(
          `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status='present') as present,
            COUNT(*) FILTER (WHERE status='absent') as absent,
            COUNT(*) FILTER (WHERE status='late') as late
           FROM attendance
           WHERE student_id=$1 AND school_id=$2
             AND date >= $3 AND date <= $4`,
          [id, school_id, term.start_date, term.end_date]
        )
      : await pool.query(
          `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status='present') as present,
            COUNT(*) FILTER (WHERE status='absent') as absent,
            COUNT(*) FILTER (WHERE status='late') as late
           FROM attendance WHERE student_id=$1 AND school_id=$2`,
          [id, school_id]
        );

    // attendance records — last 60 days within term
    const attendanceRecords = term
      ? await pool.query(
          `SELECT date, status FROM attendance
           WHERE student_id=$1 AND school_id=$2
             AND date >= $3 AND date <= $4
           ORDER BY date DESC LIMIT 60`,
          [id, school_id, term.start_date, term.end_date]
        )
      : await pool.query(
          `SELECT date, status FROM attendance
           WHERE student_id=$1 AND school_id=$2
           ORDER BY date DESC LIMIT 60`,
          [id, school_id]
        );

    // rank in class
    const rank = await pool.query(
      `SELECT COUNT(*) + 1 as rank
       FROM (
         SELECT r.student_id, AVG(r.score) as avg
         FROM results r
         JOIN students s ON s.id = r.student_id
         WHERE s.class_id = (
           SELECT class_id FROM students WHERE id = $1
         )
         GROUP BY r.student_id
         HAVING AVG(r.score) > (
           SELECT AVG(score) FROM results WHERE student_id = $1
         )
       ) better`,
      [id]
    );

    // subject averages
    const subjectAvgs = await pool.query(
      `SELECT sub.name as subject_name, ROUND(AVG(r.score), 1) as avg
       FROM results r
       JOIN subjects sub ON sub.id = r.subject_id
       WHERE r.student_id = $1
       GROUP BY sub.name
       ORDER BY avg DESC`,
      [id]
    );

    const att = attendance.rows[0];
    const attRate = att.total > 0
      ? Math.round((parseInt(att.present) / parseInt(att.total)) * 100)
      : 0;

    res.json({
      profile: student.rows[0],
      results: results.rows,
      attendance: {
        total: parseInt(att.total),
        present: parseInt(att.present),
        absent: parseInt(att.absent),
        late: parseInt(att.late),
        rate: attRate,
        term_name: term ? `${term.name} ${term.year || ''}`.trim() : null,
      },
      attendance_records: attendanceRecords.rows,
      rank: parseInt(rank.rows[0]?.rank) || null,
      best_subject: subjectAvgs.rows[0]?.subject_name || null,
      worst_subject: subjectAvgs.rows[subjectAvgs.rows.length - 1]?.subject_name || null,
      subject_averages: subjectAvgs.rows,
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};
