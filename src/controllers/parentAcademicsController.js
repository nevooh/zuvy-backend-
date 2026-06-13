const pool = require('../config/db');

// ── ownership guard ────────────────────────────────────────────────────────────
// Normalize to 254xxxxxxxxx for comparison
function _norm(p) {
  let s = String(p || '').replace(/[\s+\-()]/g, '');
  if (s.startsWith('0')) s = '254' + s.substring(1);
  if (/^[71]/.test(s))   s = '254' + s;
  return s;
}

async function assertOwnership(phoneNumber, studentId) {
  const normalized = _norm(phoneNumber);
  console.log(`[Academics] assertOwnership studentId=${studentId} phone=${normalized}`);
  const r = await pool.query(
    `SELECT id,
            REGEXP_REPLACE(REPLACE(REPLACE(parent_phone,'+',''),' ',''), '^0', '254') AS norm_phone
     FROM students WHERE id = $1`,
    [studentId]
  );
  if (r.rowCount === 0) {
    console.log(`[Academics] ❌ Student ${studentId} not found`);
    return false;
  }
  const dbPhone = r.rows[0].norm_phone;
  const match = dbPhone === normalized;
  console.log(`[Academics] DB phone=${dbPhone} | JWT phone=${normalized} | match=${match}`);
  return match;
}

// ── GET /api/parent/academics/:studentId/history ───────────────────────────────
exports.getAcademicHistory = async (req, res) => {
  const phone      = req.user?.phoneNumber;
  const school_id  = req.user?.schoolId;
  const studentId  = req.params.studentId;

  console.log(`[Academics] getAcademicHistory phone=${phone} school=${school_id} student=${studentId}`);
  if (!phone || !school_id) return res.status(401).json({ error: 'Unauthorized' });

  const owned = await assertOwnership(phone, studentId).catch(() => false);
  if (!owned) return res.status(403).json({ error: 'Access denied' });

  try {
    // ── student + school ──────────────────────────────────────────────────────
    const [studentRes, schoolRes] = await Promise.all([
      pool.query(
        `SELECT s.*, c.class_name, c.stream_name, c.level_type, c.academic_year
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
         WHERE s.id = $1 AND s.school_id = $2`,
        [studentId, school_id]
      ),
      pool.query(
        `SELECT s.name AS school_name, sp.logo_url, sp.motto
         FROM schools s LEFT JOIN school_profiles sp ON sp.school_id = s.id
         WHERE s.id = $1`,
        [school_id]
      ),
    ]);

    if (!studentRes.rows[0]) return res.status(404).json({ error: 'Student not found' });

    // ── relevant terms ────────────────────────────────────────────────────────
    const termsRes = await pool.query(
      `SELECT DISTINCT at.id, at.name, at.year, at.start_date, at.end_date, at.is_active
       FROM academic_terms at
       LEFT JOIN exams e2   ON e2.term_id = at.id AND e2.school_id = at.school_id
       LEFT JOIN results r2 ON r2.exam_id = e2.id AND r2.student_id = $2
       WHERE at.school_id = $1
         AND (at.is_active = true OR r2.id IS NOT NULL)
       ORDER BY at.is_active DESC NULLS LAST, at.year DESC NULLS LAST,
                at.start_date DESC NULLS LAST`,
      [school_id, studentId]
    );

    const terms   = termsRes.rows;
    const termIds = terms.map(t => t.id);

    if (termIds.length === 0) {
      return res.json({
        profile:          studentRes.rows[0],
        school:           schoolRes.rows[0] || {},
        term_history:     [],
        subject_averages: [],
      });
    }

    // ── all per-term data in parallel ─────────────────────────────────────────
    const [attRows, examRows, subjectAvgsRes] = await Promise.all([

      pool.query(
        `SELECT t.id AS term_id,
                COUNT(a.id)::int                                     AS total,
                COUNT(a.id) FILTER (WHERE a.status='present')::int  AS present,
                COUNT(a.id) FILTER (WHERE a.status='absent')::int   AS absent,
                COUNT(a.id) FILTER (WHERE a.status='late')::int     AS late
         FROM academic_terms t
         LEFT JOIN attendance a ON a.student_id = $1
           AND a.date >= t.start_date AND a.date <= t.end_date
         WHERE t.id = ANY($2::uuid[])
         GROUP BY t.id`,
        [studentId, termIds]
      ),

      // ALL class subjects — not-taken appear with null scores
      pool.query(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (e.id, sub.id)
                  e.id, e.name, e.exam_type, e.max_score, e.start_date, e.term_id,
                  r.score, r.grade, r.max_score AS r_max,
                  sub.name AS subject_name, sub.code, sub.is_core
           FROM exams e
           JOIN exam_classes  ec  ON ec.exam_id   = e.id
           JOIN class_subjects cs ON cs.class_id  = ec.class_id
           JOIN subjects sub      ON sub.id        = cs.subject_id
           LEFT JOIN results r    ON r.exam_id     = e.id
                                 AND r.student_id  = $1
                                 AND r.subject_id  = sub.id
           WHERE e.term_id = ANY($2::uuid[]) AND e.school_id = $3
           ORDER BY e.id, sub.id, r.score DESC NULLS LAST
         ) deduped
         ORDER BY term_id, start_date DESC, is_core DESC, subject_name`,
        [studentId, termIds, school_id]
      ),

      pool.query(
        `SELECT sub.name AS subject_name,
                ROUND(AVG(r.score), 1) AS avg_score,
                MIN(r.score)::numeric  AS min_score,
                MAX(r.score)::numeric  AS max_score,
                COUNT(r.id)::int       AS exam_count
         FROM results r JOIN subjects sub ON sub.id = r.subject_id
         WHERE r.student_id = $1
         GROUP BY sub.name ORDER BY avg_score DESC`,
        [studentId]
      ),
    ]);

    // ── build maps ────────────────────────────────────────────────────────────
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

    const termHistory = terms.map(term => {
      const att  = attMap[term.id] || { total: 0, present: 0, absent: 0, late: 0 };
      const exams = Object.values(examsByTerm[term.id] || {}).map(e => {
        const ts = e.subjects.reduce((s, r) => s + (r.score !== null ? r.score : 0), 0);
        const tm = e.subjects.reduce((s, r) => s + r.max_score, 0);
        return {
          ...e,
          total_score: +ts.toFixed(1),
          total_max:   +tm.toFixed(1),
          percentage:  tm > 0 ? +(ts / tm * 100).toFixed(1) : 0,
        };
      });
      return {
        term: {
          id: term.id, name: term.name, year: term.year,
          start_date: term.start_date, end_date: term.end_date,
          is_active:  term.is_active,
        },
        attendance: {
          total:   att.total,   present: att.present,
          absent:  att.absent,  late:    att.late,
          rate: att.total > 0 ? Math.round(att.present / att.total * 100) : 0,
        },
        exams,
      };
    });

    res.json({
      profile:          studentRes.rows[0],
      school:           schoolRes.rows[0] || {},
      term_history:     termHistory,
      subject_averages: subjectAvgsRes.rows,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/parent/academics/:studentId/attendance ───────────────────────────
exports.getAttendanceDetail = async (req, res) => {
  const phone     = req.user?.phoneNumber;
  const school_id = req.user?.schoolId;
  const studentId = req.params.studentId;

  console.log(`[Academics] getAttendanceDetail phone=${phone} school=${school_id} student=${studentId}`);
  if (!phone || !school_id) return res.status(401).json({ error: 'Unauthorized' });

  const owned = await assertOwnership(phone, studentId).catch(() => false);
  if (!owned) return res.status(403).json({ error: 'Access denied' });

  try {
    const [records, summary, byTerm] = await Promise.all([
      pool.query(
        `SELECT date, status, notes
         FROM attendance
         WHERE student_id = $1 AND school_id = $2
         ORDER BY date DESC LIMIT 180`,
        [studentId, school_id]
      ),
      pool.query(
        `SELECT
           COUNT(*)                                   AS total,
           COUNT(*) FILTER (WHERE status='present')  AS present,
           COUNT(*) FILTER (WHERE status='absent')   AS absent,
           COUNT(*) FILTER (WHERE status='late')     AS late
         FROM attendance
         WHERE student_id = $1 AND school_id = $2`,
        [studentId, school_id]
      ),
      pool.query(
        `SELECT t.name, t.year, t.is_active, t.start_date, t.end_date,
                COUNT(a.id)::int                                     AS total,
                COUNT(a.id) FILTER (WHERE a.status='present')::int  AS present,
                COUNT(a.id) FILTER (WHERE a.status='absent')::int   AS absent,
                COUNT(a.id) FILTER (WHERE a.status='late')::int     AS late
         FROM academic_terms t
         LEFT JOIN attendance a ON a.student_id = $1
           AND a.date >= t.start_date AND a.date <= t.end_date
         WHERE t.school_id = $2
         GROUP BY t.id, t.name, t.year, t.is_active, t.start_date, t.end_date
         ORDER BY t.is_active DESC NULLS LAST, t.start_date DESC
         LIMIT 9`,
        [studentId, school_id]
      ),
    ]);

    res.json({
      records:  records.rows,
      summary:  summary.rows[0],
      by_term:  byTerm.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
