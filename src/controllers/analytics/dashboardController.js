const pool = require('../../config/analyticsPool');
const { seedDefaultGrading } = require('../../utils/seedDefaultGrading');

const getDashboardSummary = async (req, res) => {
  const school_id = req.school_id;
  const level_type = req.query.level_type || 'primary';

  // Non-blocking: silently seed CBC default grading on first load
  seedDefaultGrading(school_id, pool).catch(() => {});

  try {
    const totalStudents = await pool.query(
      `SELECT COUNT(*) FROM students s
       JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = $1 AND s.status = 'ACTIVE'
       AND c.level_type = $2`,
      [school_id, level_type]
    );

    const totalClasses = await pool.query(
      `SELECT COUNT(*) FROM classes
       WHERE school_id = $1 AND level_type = $2
         AND (is_archived = false OR is_archived IS NULL)`,
      [school_id, level_type]
    );

    const avgScore = await pool.query(
      `SELECT ROUND(AVG(r.score), 1) as average
       FROM results r
       JOIN students s ON s.id = r.student_id
       JOIN classes c ON c.id = s.class_id
       WHERE r.school_id = $1 AND c.level_type = $2`,
      [school_id, level_type]
    );

    // attendance rate scoped to the active term (or latest term if none active)
    const termRes = await pool.query(
      `SELECT start_date, end_date, name FROM academic_terms
       WHERE school_id = $1
       ORDER BY is_active DESC, start_date DESC LIMIT 1`,
      [school_id]
    );
    const term = termRes.rows[0];
    const attendanceRate = term
      ? await pool.query(
          `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present')
                  / NULLIF(COUNT(*), 0), 1) as rate
           FROM attendance a
           JOIN classes c ON c.id = a.class_id
           WHERE a.school_id = $1 AND c.level_type = $2
             AND a.date >= $3 AND a.date <= $4`,
          [school_id, level_type, term.start_date, term.end_date]
        )
      : await pool.query(
          `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present')
                  / NULLIF(COUNT(*), 0), 1) as rate
           FROM attendance a
           JOIN classes c ON c.id = a.class_id
           WHERE a.school_id = $1 AND c.level_type = $2`,
          [school_id, level_type]
        );

    const topClass = await pool.query(
      `SELECT c.class_name, ROUND(AVG(r.score), 1) as avg
       FROM results r
       JOIN students s ON s.id = r.student_id
       JOIN classes c ON c.id = s.class_id
       WHERE r.school_id = $1 AND c.level_type = $2
       GROUP BY c.class_name
       ORDER BY avg DESC
       LIMIT 1`,
      [school_id, level_type]
    );

    res.json({
      total_students: parseInt(totalStudents.rows[0].count),
      total_classes: parseInt(totalClasses.rows[0].count),
      average_score: avgScore.rows[0].average || 0,
      attendance_rate: attendanceRate.rows[0].rate || 0,
      attendance_term: term?.name || null,
      top_class: topClass.rows[0]?.class_name || null,
      level_type,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

const getChartData = async (req, res) => {
  const school_id = req.school_id;
  const level_type = req.query.level_type || 'primary';
  try {
    // class performance bar chart
    const classPerf = await pool.query(
      `SELECT c.class_name, c.stream_name,
              ROUND(AVG(r.score/r.max_score*100),1) as avg_pct,
              COUNT(DISTINCT s.id) as student_count
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id
         AND s.status = 'ACTIVE'
       LEFT JOIN results r ON r.student_id = s.id
         AND r.max_score > 0
       WHERE c.school_id = $1 AND c.level_type = $2
         AND (c.is_archived = false OR c.is_archived IS NULL)
       GROUP BY c.id, c.class_name, c.stream_name
       ORDER BY c.level_order`,
      [school_id, level_type]
    );

    // term trend line chart
    const termTrend = await pool.query(
      `SELECT t.name as term_name, t.year,
              ROUND(AVG(r.score/r.max_score*100),1) as avg_pct
       FROM results r
       JOIN exams e ON e.id = r.exam_id
       JOIN academic_terms t ON t.id = e.term_id
       JOIN students s ON s.id = r.student_id
       JOIN classes c ON c.id = s.class_id
       WHERE r.school_id = $1 AND c.level_type = $2
       AND r.max_score > 0
       GROUP BY t.id, t.name, t.year
       ORDER BY t.year, t.name`,
      [school_id, level_type]
    );

    // attendance donut
    const attData = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE a.status='present') as present,
        COUNT(*) FILTER (WHERE a.status='absent') as absent,
        COUNT(*) FILTER (WHERE a.status='late') as late
       FROM attendance a
       JOIN classes c ON c.id = a.class_id
       WHERE a.school_id = $1 AND c.level_type = $2`,
      [school_id, level_type]
    );

    res.json({
      class_performance: classPerf.rows,
      term_trend: termTrend.rows,
      attendance: attData.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getSubjectPerformanceByYear = async (req, res) => {
  const school_id = req.school_id;
  const level_type = req.query.level_type || 'primary';
  try {
    const result = await pool.query(
      `SELECT
         t.year,
         sub.name  AS subject_name,
         sub.code,
         sub.is_core,
         ROUND(AVG(r.score / r.max_score * 100), 1) AS avg_pct,
         COUNT(DISTINCT r.student_id) AS student_count
       FROM results r
       JOIN exams e       ON e.id  = r.exam_id
       JOIN academic_terms t ON t.id = e.term_id
       JOIN subjects sub  ON sub.id = r.subject_id
       JOIN students s    ON s.id  = r.student_id
       JOIN classes c     ON c.id  = s.class_id
       WHERE r.school_id = $1
         AND c.level_type = $2
         AND r.grade <> 'ABS'
         AND r.score IS NOT NULL
         AND r.max_score > 0
       GROUP BY t.year, sub.id, sub.name, sub.code, sub.is_core
       ORDER BY t.year ASC, avg_pct DESC`,
      [school_id, level_type]
    );
    // group by year: { 2025: [...], 2026: [...] }
    const byYear = {};
    for (const row of result.rows) {
      const yr = row.year.toString();
      byYear[yr] ??= [];
      byYear[yr].push({
        subject: row.subject_name,
        code:    row.code,
        is_core: row.is_core,
        avg_pct: parseFloat(row.avg_pct),
        count:   parseInt(row.student_count),
      });
    }
    res.json(byYear);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getEnhancedDashboard = async (req, res) => {
  const school_id = req.school_id;
  const level_type = req.query.level_type || 'primary';
  try {
    // Active term
    const termRes = await pool.query(
      `SELECT id, name, year, start_date, end_date
       FROM academic_terms
       WHERE school_id = $1 AND is_active = true
       LIMIT 1`,
      [school_id]
    );
    const term = termRes.rows[0] || null;

    const [gradeDistRes, recentExamsRes, attAlertsRes, progressRes] = await Promise.all([

      // Grade band distribution (current term)
      term ? pool.query(
        `SELECT r.grade, COUNT(DISTINCT r.student_id)::int AS count
         FROM results r
         JOIN exams e ON e.id = r.exam_id
         JOIN students s ON s.id = r.student_id
         JOIN classes c ON c.id = s.class_id
         WHERE r.school_id = $1 AND e.term_id = $2
           AND c.level_type = $3
           AND r.grade IS NOT NULL AND r.grade <> 'ABS'
         GROUP BY r.grade
         ORDER BY
           CASE r.grade
             WHEN 'EE' THEN 1 WHEN 'ME' THEN 2
             WHEN 'AE' THEN 3 WHEN 'BE' THEN 4
             ELSE 5 END`,
        [school_id, term.id, level_type]
      ) : { rows: [] },

      // Last 4 exams with result count
      pool.query(
        `SELECT e.id, e.name, e.exam_type, e.start_date,
                COUNT(DISTINCT ec.class_id)::int AS class_count,
                COUNT(DISTINCT r.student_id)::int AS results_count
         FROM exams e
         LEFT JOIN exam_classes ec ON ec.exam_id = e.id
         LEFT JOIN results r ON r.exam_id = e.id
         WHERE e.school_id = $1 AND e.level_type = $2
         GROUP BY e.id, e.name, e.exam_type, e.start_date
         ORDER BY e.created_at DESC
         LIMIT 4`,
        [school_id, level_type]
      ),

      // Attendance alerts: classes < 75% this term
      term ? pool.query(
        `SELECT c.class_name, c.stream_name,
                ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present')
                      / NULLIF(COUNT(*), 0), 1)::float AS rate
         FROM attendance a
         JOIN classes c ON c.id = a.class_id
         WHERE a.school_id = $1 AND c.level_type = $2
           AND a.date >= $3 AND a.date <= $4
         GROUP BY c.id, c.class_name, c.stream_name
         HAVING ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present')
                / NULLIF(COUNT(*), 0), 1) < 75
         ORDER BY rate ASC
         LIMIT 6`,
        [school_id, level_type, term.start_date, term.end_date]
      ) : { rows: [] },

      // Results entry progress: classes with exams vs classes with results (current term)
      term ? pool.query(
        `WITH term_classes AS (
           SELECT DISTINCT ec.class_id
           FROM exam_classes ec
           JOIN exams e ON e.id = ec.exam_id
           WHERE e.school_id = $1 AND e.term_id = $2 AND e.level_type = $3
         ),
         done_classes AS (
           SELECT DISTINCT ec.class_id
           FROM exam_classes ec
           JOIN exams e ON e.id = ec.exam_id
           JOIN results r ON r.exam_id = e.id
           WHERE e.school_id = $1 AND e.term_id = $2 AND e.level_type = $3
         )
         SELECT
           (SELECT COUNT(*)::int FROM term_classes) AS total,
           (SELECT COUNT(*)::int FROM done_classes)  AS done`,
        [school_id, term.id, level_type]
      ) : { rows: [{ total: 0, done: 0 }] },
    ]);

    const daysLeft = term?.end_date
      ? Math.max(0, Math.ceil((new Date(term.end_date) - new Date()) / 86400000))
      : null;

    res.json({
      active_term:        term ? { ...term, days_left: daysLeft } : null,
      grade_distribution: gradeDistRes.rows,
      recent_exams:       recentExamsRes.rows,
      attendance_alerts:  attAlertsRes.rows,
      results_progress:   progressRes.rows[0] || { total: 0, done: 0 },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getDashboardSummary, getChartData, getSubjectPerformanceByYear, getEnhancedDashboard };
