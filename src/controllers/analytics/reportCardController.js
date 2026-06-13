const pool = require('../../config/analyticsPool');

// ── shared: fetch total subject count for a class ─────────────────────────────
async function getClassMaxPossible(classId, examMaxScore) {
  const res = await pool.query(
    `SELECT COUNT(*) as total FROM class_subjects WHERE class_id = $1`,
    [classId]
  );
  const count = parseInt(res.rows[0]?.total || 0);
  return count * parseFloat(examMaxScore || 100);
}

exports.getReportCard = async (req, res) => {
  const school_id = req.school_id;
  const { student_id, exam_id } = req.params;
  try {
    // school info + logo
    const schoolRes = await pool.query(
      `SELECT s.name as school_name, s.email,
              sp.logo_url, sp.motto, sp.phone_primary,
              sp.town_city, sp.p_o_box
       FROM schools s
       LEFT JOIN school_profiles sp ON sp.school_id = s.id
       WHERE s.id = $1`,
      [school_id]
    );

    // student info
    const studentRes = await pool.query(
      `SELECT s.*, c.class_name, c.stream_name, c.level_type
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [student_id, school_id]
    );
    if (!studentRes.rows[0]) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // exam info — include term dates for term-based attendance
    const examRes = await pool.query(
      `SELECT e.*, t.name as term_name, t.year, t.start_date as term_start, t.end_date as term_end,
              gs.name as scale_name, gs.subjects_to_count
       FROM exams e
       LEFT JOIN academic_terms t ON t.id = e.term_id
       LEFT JOIN grading_scales gs ON gs.id = e.scale_id
       WHERE e.id = $1 AND e.school_id = $2`,
      [exam_id, school_id]
    );

    // Determine the class the student was in when they took this exam.
    // After year-end promotion students.class_id changes, so we look up
    // which exam_class has subjects matching this student's results.
    let classId = studentRes.rows[0].class_id;
    const historicalClassRes = await pool.query(
      `SELECT ec.class_id, c.class_name, c.stream_name, c.level_type
       FROM exam_classes ec
       JOIN classes c ON c.id = ec.class_id
       JOIN class_subjects cs ON cs.class_id = ec.class_id
       JOIN results r ON r.subject_id = cs.subject_id
         AND r.student_id = $1 AND r.exam_id = $2
       WHERE ec.exam_id = $2
       GROUP BY ec.class_id, c.class_name, c.stream_name, c.level_type
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [student_id, exam_id]
    );
    if (historicalClassRes.rows[0]) {
      classId = historicalClassRes.rows[0].class_id;
      studentRes.rows[0].class_name  = historicalClassRes.rows[0].class_name;
      studentRes.rows[0].stream_name = historicalClassRes.rows[0].stream_name;
      studentRes.rows[0].level_type  = historicalClassRes.rows[0].level_type;
    }
    const levelType = studentRes.rows[0].level_type || 'primary';

    // all class subjects — LEFT JOIN so subjects with no result still appear
    const resultsRes = await pool.query(
      `SELECT r.score, r.max_score, r.grade, r.points,
              sub.name as subject_name, sub.code,
              sub.is_core
       FROM class_subjects cs
       JOIN subjects sub ON sub.id = cs.subject_id
       LEFT JOIN results r ON r.subject_id = cs.subject_id
           AND r.student_id = $1 AND r.exam_id = $2
       WHERE cs.class_id = $3
       ORDER BY sub.is_core DESC, sub.name`,
      [student_id, exam_id, classId]
    );

    const results = resultsRes.rows;
    const examMaxScore = parseFloat(examRes.rows[0]?.max_score || 100);
    const subjectsToCount = parseInt(examRes.rows[0]?.subjects_to_count || 7);

    // use full class subject count as denominator — same logic as leaderboard
    const classMaxPossible = await getClassMaxPossible(classId, examMaxScore);

    const totalScore = results.reduce(
      (s, r) => s + parseFloat(r.score || 0), 0);
    const percentage = classMaxPossible > 0
      ? parseFloat((totalScore / classMaxPossible * 100).toFixed(1))
      : 0;

    // overall performance grade from grading scale
    let performanceLevel = null;
    const scaleId = examRes.rows[0]?.scale_id;
    if (percentage > 0 && scaleId) {
      const lvlRes = await pool.query(
        `SELECT label, min_score, max_score FROM grade_bands
         WHERE scale_id = $1
         ORDER BY min_score DESC LIMIT 20`,
        [scaleId]
      );
      for (const b of lvlRes.rows) {
        if (percentage >= parseFloat(b.min_score) && percentage <= parseFloat(b.max_score)) {
          performanceLevel = b.label;
          break;
        }
      }
    }

    // JSS aggregate points (best N subjects)
    let finalPoints = null;
    let avgPoints   = null;
    if (levelType === 'jss') {
      const withPts = results
        .filter(r => r.points !== null && r.grade !== 'ABS')
        .map(r => parseFloat(r.points))
        .sort((a, b) => b - a);
      const best = withPts.slice(0, subjectsToCount);
      if (best.length > 0) {
        finalPoints = parseFloat(best.reduce((s, p) => s + p, 0).toFixed(2));
        avgPoints   = parseFloat((finalPoints / best.length).toFixed(2));
      }
    }

    // position in class — use class_subjects join (works after promotion)
    const posRes = await pool.query(
      levelType === 'jss'
        ? `SELECT COUNT(*) + 1 as position
           FROM (
             SELECT r2.student_id,
               SUM(CASE WHEN r2.grade <> 'ABS' THEN r2.points ELSE 0 END) as pts
             FROM results r2
             JOIN class_subjects cs2 ON cs2.subject_id = r2.subject_id AND cs2.class_id = $1
             WHERE r2.exam_id = $2
             GROUP BY r2.student_id
             HAVING SUM(CASE WHEN r2.grade <> 'ABS' THEN r2.points ELSE 0 END) > $3
           ) better`
        : `SELECT COUNT(*) + 1 as position
           FROM (
             SELECT r2.student_id,
               SUM(r2.score) / $4 * 100 as pct
             FROM results r2
             JOIN class_subjects cs2 ON cs2.subject_id = r2.subject_id AND cs2.class_id = $1
             WHERE r2.exam_id = $2
             GROUP BY r2.student_id
             HAVING SUM(r2.score) / $4 * 100 > $3
           ) better`,
      levelType === 'jss'
        ? [classId, exam_id, finalPoints || 0]
        : [classId, exam_id, percentage, classMaxPossible]
    );

    // total students in class (via class_subjects — works after promotion)
    const totalStudentsRes = await pool.query(
      `SELECT COUNT(DISTINCT r.student_id) as total
       FROM results r
       JOIN class_subjects cs ON cs.subject_id = r.subject_id AND cs.class_id = $1
       WHERE r.exam_id = $2`,
      [classId, exam_id]
    );

    // attendance — scoped to the exam's term dates when available
    const termStart = examRes.rows[0]?.term_start;
    const termEnd   = examRes.rows[0]?.term_end;
    const attRes = termStart && termEnd
      ? await pool.query(
          `SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status='present') as present,
            COUNT(*) FILTER (WHERE status='absent') as absent,
            COUNT(*) FILTER (WHERE status='late') as late
           FROM attendance
           WHERE student_id=$1 AND school_id=$2
             AND date >= $3 AND date <= $4`,
          [student_id, school_id, termStart, termEnd]
        )
      : await pool.query(
          `SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status='present') as present,
            COUNT(*) FILTER (WHERE status='absent') as absent,
            COUNT(*) FILTER (WHERE status='late') as late
           FROM attendance
           WHERE student_id=$1 AND school_id=$2`,
          [student_id, school_id]
        );

    // comment
    const commentRes = await pool.query(
      `SELECT comment FROM report_card_comments
       WHERE student_id = $1 AND exam_id = $2`,
      [student_id, exam_id]
    );

    // class average (via class_subjects — works after promotion)
    const classAvgRes = await pool.query(
      `SELECT ROUND(AVG(pct), 1) as class_avg FROM (
         SELECT SUM(r.score) / $3 * 100 as pct
         FROM results r
         JOIN class_subjects cs ON cs.subject_id = r.subject_id AND cs.class_id = $1
         WHERE r.exam_id = $2
         GROUP BY r.student_id
       ) t`,
      [classId, exam_id, classMaxPossible]
    );

    const att = attRes.rows[0];
    const attRate = parseInt(att.total) > 0
      ? Math.round(parseInt(att.present) / parseInt(att.total) * 100)
      : 0;

    res.json({
      school:  schoolRes.rows[0],
      student: studentRes.rows[0],
      exam:    examRes.rows[0],
      results,
      summary: {
        total_score:       parseFloat(totalScore.toFixed(2)),
        total_max:         classMaxPossible,
        percentage,
        performance_level: performanceLevel,
        position:          parseInt(posRes.rows[0]?.position || 1),
        total_students:    parseInt(totalStudentsRes.rows[0]?.total || 1),
        class_avg:         parseFloat(classAvgRes.rows[0]?.class_avg || 0),
        final_points:      finalPoints,
        avg_points:        avgPoints,
        level_type:        levelType,
        subjects_counted:  subjectsToCount,
      },
      attendance: {
        total:   parseInt(att.total),
        present: parseInt(att.present),
        absent:  parseInt(att.absent),
        late:    parseInt(att.late),
        rate:    attRate,
      },
      comment: commentRes.rows[0]?.comment || null,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.saveComment = async (req, res) => {
  const school_id = req.school_id;
  const { student_id, exam_id } = req.params;
  const { comment } = req.body;
  try {
    await pool.query(
      `INSERT INTO report_card_comments
        (school_id, student_id, exam_id, comment)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (student_id, exam_id)
       DO UPDATE SET comment = $4`,
      [school_id, student_id, exam_id, comment]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClassReportCards = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, exam_id } = req.params;
  try {
    // Find students who sat this exam in this class (works after promotion)
    const students = await pool.query(
      `SELECT DISTINCT s.id, s.full_name, s.admission_number
       FROM students s
       JOIN results r ON r.student_id = s.id
       JOIN class_subjects cs ON cs.subject_id = r.subject_id AND cs.class_id = $1
       WHERE s.school_id = $2 AND r.exam_id = $3
       ORDER BY s.full_name`,
      [class_id, school_id, exam_id]
    );

    // fetch school + exam once — same for every card
    const schoolRes = await pool.query(
      `SELECT s.name as school_name, s.email,
              sp.logo_url, sp.motto, sp.phone_primary,
              sp.town_city, sp.p_o_box
       FROM schools s
       LEFT JOIN school_profiles sp ON sp.school_id = s.id
       WHERE s.id = $1`,
      [school_id]
    );
    const examRes = await pool.query(
      `SELECT e.*, t.name as term_name, t.year,
              gs.subjects_to_count
       FROM exams e
       LEFT JOIN academic_terms t ON t.id = e.term_id
       LEFT JOIN grading_scales gs ON gs.id = e.scale_id
       WHERE e.id = $1`,
      [exam_id]
    );

    const examMaxScore    = parseFloat(examRes.rows[0]?.max_score || 100);
    const subjectsToCount = parseInt(examRes.rows[0]?.subjects_to_count || 7);
    const scaleId         = examRes.rows[0]?.scale_id || null;

    // classMaxPossible is the same for every student in this class
    const classMaxPossible = await getClassMaxPossible(class_id, examMaxScore);

    // class average (via class_subjects — works after promotion)
    const classAvgRes = await pool.query(
      `SELECT ROUND(AVG(pct), 1) as class_avg FROM (
         SELECT SUM(r.score) / $3 * 100 as pct
         FROM results r
         JOIN class_subjects cs ON cs.subject_id = r.subject_id AND cs.class_id = $1
         WHERE r.exam_id = $2
         GROUP BY r.student_id
       ) t`,
      [class_id, exam_id, classMaxPossible]
    );
    const classAvg = parseFloat(classAvgRes.rows[0]?.class_avg || 0);

    // Fetch class info once for report card headers
    const classInfoRes = await pool.query(
      `SELECT class_name, stream_name, level_type FROM classes WHERE id = $1`,
      [class_id]
    );
    const classInfo = classInfoRes.rows[0] || {};

    const totalStudentsRes = await pool.query(
      `SELECT COUNT(DISTINCT r.student_id) as total
       FROM results r
       JOIN class_subjects cs ON cs.subject_id = r.subject_id AND cs.class_id = $1
       WHERE r.exam_id = $2`,
      [class_id, exam_id]
    );
    const totalStudents = parseInt(totalStudentsRes.rows[0]?.total || 1);

    const cards = [];
    for (const student of students.rows) {
      const studentRes = await pool.query(
        `SELECT s.* FROM students s WHERE s.id = $1`,
        [student.id]
      );
      // Use the historical class info (not the student's current class after promotion)
      studentRes.rows[0].class_name  = classInfo.class_name;
      studentRes.rows[0].stream_name = classInfo.stream_name;
      studentRes.rows[0].level_type  = classInfo.level_type;

      // all class subjects — LEFT JOIN so subjects with no result still appear
      const resultsRes = await pool.query(
        `SELECT r.score, r.max_score, r.grade, r.points,
                sub.name as subject_name, sub.code,
                sub.is_core
         FROM class_subjects cs
         JOIN subjects sub ON sub.id = cs.subject_id
         LEFT JOIN results r ON r.subject_id = cs.subject_id
             AND r.student_id = $1 AND r.exam_id = $2
         WHERE cs.class_id = $3
         ORDER BY sub.is_core DESC, sub.name`,
        [student.id, exam_id, class_id]
      );

      const results   = resultsRes.rows;
      const levelType = studentRes.rows[0]?.level_type || 'primary';

      const totalScore = results.reduce(
        (s, r) => s + parseFloat(r.score || 0), 0);
      const percentage = classMaxPossible > 0
        ? parseFloat((totalScore / classMaxPossible * 100).toFixed(1))
        : 0;

      let performanceLevel = null;
      if (percentage > 0 && scaleId) {
        const lvlRes = await pool.query(
          `SELECT label, min_score, max_score FROM grade_bands
           WHERE scale_id = $1
           ORDER BY min_score DESC LIMIT 20`,
          [scaleId]
        );
        for (const b of lvlRes.rows) {
          if (percentage >= parseFloat(b.min_score) && percentage <= parseFloat(b.max_score)) {
            performanceLevel = b.label;
            break;
          }
        }
      }

      let finalPoints = null;
      let avgPoints   = null;
      if (levelType === 'jss') {
        const withPts = results
          .filter(r => r.points !== null && r.grade !== 'ABS')
          .map(r => parseFloat(r.points))
          .sort((a, b) => b - a);
        const best = withPts.slice(0, subjectsToCount);
        if (best.length > 0) {
          finalPoints = parseFloat(best.reduce((s, p) => s + p, 0).toFixed(2));
          avgPoints   = parseFloat((finalPoints / best.length).toFixed(2));
        }
      }

      const posRes = await pool.query(
        levelType === 'jss'
          ? `SELECT COUNT(*) + 1 as position FROM (
               SELECT r2.student_id,
                 SUM(CASE WHEN r2.grade <> 'ABS' THEN r2.points ELSE 0 END) as pts
               FROM results r2
               JOIN class_subjects cs2 ON cs2.subject_id = r2.subject_id AND cs2.class_id = $1
               WHERE r2.exam_id = $2
               GROUP BY r2.student_id
               HAVING SUM(CASE WHEN r2.grade <> 'ABS' THEN r2.points ELSE 0 END) > $3
             ) better`
          : `SELECT COUNT(*) + 1 as position FROM (
               SELECT r2.student_id,
                 SUM(r2.score) / $4 * 100 as pct
               FROM results r2
               JOIN class_subjects cs2 ON cs2.subject_id = r2.subject_id AND cs2.class_id = $1
               WHERE r2.exam_id = $2
               GROUP BY r2.student_id
               HAVING SUM(r2.score) / $4 * 100 > $3
             ) better`,
        levelType === 'jss'
          ? [class_id, exam_id, finalPoints || 0]
          : [class_id, exam_id, percentage, classMaxPossible]
      );

      const attRes = await pool.query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status='present') as present,
          COUNT(*) FILTER (WHERE status='absent') as absent,
          COUNT(*) FILTER (WHERE status='late') as late
         FROM attendance
         WHERE student_id = $1 AND school_id = $2`,
        [student.id, school_id]
      );

      const commentRes = await pool.query(
        `SELECT comment FROM report_card_comments
         WHERE student_id = $1 AND exam_id = $2`,
        [student.id, exam_id]
      );

      const att = attRes.rows[0];
      const attRate = parseInt(att.total) > 0
        ? Math.round(parseInt(att.present) / parseInt(att.total) * 100)
        : 0;

      cards.push({
        school:  schoolRes.rows[0],
        student: studentRes.rows[0],
        exam:    examRes.rows[0],
        results,
        summary: {
          total_score:       parseFloat(totalScore.toFixed(2)),
          total_max:         classMaxPossible,
          percentage,
          performance_level: performanceLevel,
          position:          parseInt(posRes.rows[0]?.position || 1),
          total_students:    totalStudents,
          class_avg:         classAvg,
          final_points:      finalPoints,
          avg_points:        avgPoints,
          level_type:        levelType,
          subjects_counted:  subjectsToCount,
        },
        attendance: {
          total:   parseInt(att.total),
          present: parseInt(att.present),
          absent:  parseInt(att.absent),
          late:    parseInt(att.late),
          rate:    attRate,
        },
        comment: commentRes.rows[0]?.comment || null,
      });
    }
    res.json(cards);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};
