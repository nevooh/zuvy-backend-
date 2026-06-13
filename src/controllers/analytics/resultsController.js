const pool = require('../../config/analyticsPool');

function calcGradeAndPoints(score, maxScore, bands) {
  if (!bands || bands.length === 0) return { grade: null, points: null };
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  for (const b of bands) {
    if (pct >= parseFloat(b.min_score) &&
        pct <= parseFloat(b.max_score)) {
      return {
        grade: b.label || null,
        points: b.points ? parseFloat(b.points) : null,
      };
    }
  }
  return { grade: null, points: null };
}

exports.getResultsGrid = async (req, res) => {
  const school_id = req.school_id;
  const { exam_id, class_id } = req.query;
  try {
    const examRes = await pool.query(
      `SELECT e.*, t.name as term_name, gs.school_level,
              gs.subjects_to_count
       FROM exams e
       LEFT JOIN academic_terms t ON t.id = e.term_id
       LEFT JOIN grading_scales gs ON gs.id = e.scale_id
       WHERE e.id = $1 AND e.school_id = $2`,
      [exam_id, school_id]
    );
    if (!examRes.rows[0]) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    const exam = examRes.rows[0];

    // Students with recorded results for this exam (includes promoted students)
    // UNION currently enrolled students who have no results yet (blank rows for new entry)
    const studentsRes = await pool.query(
      `SELECT DISTINCT s.id, s.full_name, s.admission_number
       FROM students s
       JOIN results r ON r.student_id = s.id
       WHERE r.exam_id = $3 AND s.school_id = $2
       UNION
       SELECT id, full_name, admission_number
       FROM students
       WHERE class_id = $1 AND school_id = $2 AND status = 'ACTIVE'
         AND id NOT IN (SELECT student_id FROM results WHERE exam_id = $3)
       ORDER BY full_name`,
      [class_id, school_id, exam_id]
    );

    const subjectsRes = await pool.query(
      `SELECT s.id, s.name, s.code
       FROM subjects s
       JOIN class_subjects cs ON cs.subject_id = s.id
       WHERE cs.class_id = $1 AND s.school_id = $2
       ORDER BY s.is_core DESC, s.name ASC`,
      [class_id, school_id]
    );

    const resultsRes = await pool.query(
      `SELECT student_id, subject_id, score, grade, points
       FROM results
       WHERE exam_id = $1 AND school_id = $2`,
      [exam_id, school_id]
    );

    const resultsMap = {};
    for (const r of resultsRes.rows) {
      const key = `${r.student_id}_${r.subject_id}`;
      resultsMap[key] = {
        score: r.score,
        grade: r.grade,
        points: r.points,
      };
    }

    // fetch grade bands for this class + exam's scale so the client
    // can show live grade previews as the user types scores
    const bandsRes = await pool.query(
      `SELECT subject_id, min_score, max_score, label, points
       FROM grade_bands
       WHERE class_id = $1 AND scale_id = $2
       ORDER BY subject_id, min_score DESC`,
      [class_id, exam.scale_id]
    );

    // group by subject_id  →  { "subjectId": [ { min_score, max_score, label, points }, … ] }
    const gradeBands = {};
    for (const b of bandsRes.rows) {
      const sid = b.subject_id.toString();
      gradeBands[sid] ??= [];
      gradeBands[sid].push({
        min_score: parseFloat(b.min_score),
        max_score: parseFloat(b.max_score),
        label:     b.label,
        points:    b.points != null ? parseFloat(b.points) : null,
      });
    }

    res.json({
      exam,
      students:    studentsRes.rows,
      subjects:    subjectsRes.rows,
      results:     resultsMap,
      grade_bands: gradeBands,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.saveResults = async (req, res) => {
  const school_id = req.school_id;
  const { exam_id, class_id, entries } = req.body;
  try {
    const examRes = await pool.query(
      `SELECT max_score, scale_id FROM exams WHERE id = $1`,
      [exam_id]
    );
    const exam = examRes.rows[0];
    const max_score = exam?.max_score || 100;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of entries) {
        if (e.absent) {
          await client.query(
            `INSERT INTO results
              (school_id, student_id, exam_id, subject_id,
               score, max_score, grade, points)
             VALUES ($1,$2,$3,$4,null,$5,'ABS',null)
             ON CONFLICT (student_id, exam_id, subject_id)
             DO UPDATE SET score=null, max_score=$5,
                           grade='ABS', points=null`,
            [school_id, e.student_id, exam_id,
             e.subject_id, max_score]
          );
          continue;
        }
        if (e.score === null || e.score === undefined ||
            e.score === '') continue;
        const score = parseFloat(e.score);
        if (isNaN(score)) continue;

        let grade = null;
        let points = null;

        if (exam.scale_id) {
          const bandsRes = await client.query(
            `SELECT label, min_score, max_score, points
             FROM grade_bands
             WHERE scale_id = $1
             AND subject_id = $2
             AND class_id = $3
             ORDER BY min_score DESC`,
            [exam.scale_id, e.subject_id, class_id]
          );
          const gp = calcGradeAndPoints(
            score, max_score, bandsRes.rows);
          grade = gp.grade;
          points = gp.points;
        }

        await client.query(
          `INSERT INTO results
            (school_id, student_id, exam_id, subject_id,
             score, max_score, grade, points)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (student_id, exam_id, subject_id)
           DO UPDATE SET score=$5, max_score=$6,
                         grade=$7, points=$8`,
          [school_id, e.student_id, exam_id,
           e.subject_id, score, max_score, grade, points]
        );
      }
      await client.query('COMMIT');
      res.json({ message: 'Results saved' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getExamStudents = async (req, res) => {
  const school_id = req.school_id;
  const { exam_id, class_id } = req.query;
  try {
    // Students who sat this exam — correct after promotion
    const result = await pool.query(
      `SELECT DISTINCT s.id, s.full_name, s.admission_number
       FROM students s
       JOIN results r ON r.student_id = s.id
       WHERE r.exam_id = $1 AND s.school_id = $2
       ORDER BY s.full_name`,
      [exam_id, school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getExamClasses = async (req, res) => {
  const school_id = req.school_id;
  const { exam_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT c.id, c.class_name, c.stream_name
       FROM exam_classes ec
       JOIN classes c ON c.id = ec.class_id
       WHERE ec.exam_id = $1 AND c.school_id = $2
       ORDER BY c.level_order`,
      [exam_id, school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getLeaderboard = async (req, res) => {
  const school_id = req.school_id;
  const { exam_id, class_id } = req.query;
  try {
    const examRes = await pool.query(
      `SELECT e.*, gs.subjects_to_count,
              gs.school_level, e.level_type
       FROM exams e
       LEFT JOIN grading_scales gs ON gs.id = e.scale_id
       WHERE e.id=$1 AND e.school_id=$2`,
      [exam_id, school_id]
    );
    const exam = examRes.rows[0];
    const level = exam?.level_type || 'primary';
    const subjectsToCount = exam?.subjects_to_count || 7;

    // total subjects assigned to this class → used as the denominator for max_possible
    const classSubjectsRes = await pool.query(
      `SELECT COUNT(*) as total FROM class_subjects WHERE class_id = $1`,
      [class_id]
    );
    const classSubjectCount = parseInt(classSubjectsRes.rows[0]?.total || 0);
    const classMaxPossible  = classSubjectCount * parseFloat(exam?.max_score || 100);

    // Only students who actually sat this exam (works after promotion)
    const studentsRes = await pool.query(
      `SELECT DISTINCT s.id, s.full_name, s.admission_number
       FROM students s
       JOIN results r ON r.student_id = s.id
       JOIN class_subjects cs ON cs.subject_id = r.subject_id
         AND cs.class_id = $1
       WHERE s.school_id = $2 AND r.exam_id = $3
       ORDER BY s.full_name`,
      [class_id, school_id, exam_id]
    );

    // Fetch ALL results for this exam in one query (no N+1)
    const allResultsRes = await pool.query(
      `SELECT r.student_id, r.score, r.max_score, r.grade, r.points,
              s.name as subject_name
       FROM results r
       JOIN subjects s ON s.id = r.subject_id
       WHERE r.exam_id = $1 AND r.school_id = $2`,
      [exam_id, school_id]
    );
    const resultsByStudent = {};
    for (const r of allResultsRes.rows) {
      resultsByStudent[r.student_id] ??= [];
      resultsByStudent[r.student_id].push(r);
    }

    const leaderboard = [];
    for (const student of studentsRes.rows) {
      const results = resultsByStudent[student.id] || [];
      const totalMarks = results.reduce(
        (sum, r) => sum + parseFloat(r.score || 0), 0);
      const pct = classMaxPossible > 0
        ? parseFloat((totalMarks / classMaxPossible * 100).toFixed(1))
        : 0;

      // grade distribution
      const gradeCounts = {};
      for (const r of results) {
        if (r.grade) {
          gradeCounts[r.grade] =
            (gradeCounts[r.grade] || 0) + 1;
        }
      }

      // points for JSS
      let finalPoints = null;
      let avgPoints = null;
      let performanceLevel = null;

      if (level === 'jss') {
        const withPoints = results
          .filter(r => r.points !== null)
          .sort((a, b) =>
            parseFloat(b.points) - parseFloat(a.points));
        const best = withPoints.slice(0, subjectsToCount);
        finalPoints = parseFloat(best
          .reduce((s, r) => s + parseFloat(r.points || 0), 0)
          .toFixed(2));
        avgPoints = best.length > 0
          ? parseFloat((finalPoints / best.length).toFixed(2))
          : null;
      } else {
        // for primary/preschool use percentage
        // calculate avg points from grade_bands
        const pointsArr = results
          .map(r => parseFloat(r.points || 0))
          .filter(p => p > 0);
        if (pointsArr.length > 0) {
          avgPoints = parseFloat(
            (pointsArr.reduce((s, p) => s + p, 0) /
             pointsArr.length).toFixed(2)
          );
        }
      }

      // determine performance level from percentage
      if (pct > 0 && exam.scale_id) {
        const levelBands = await pool.query(
          `SELECT label, min_score, max_score
           FROM grade_bands gb
           WHERE gb.scale_id = $1
           ORDER BY min_score DESC
           LIMIT 20`,
          [exam.scale_id]
        );
        for (const b of levelBands.rows) {
          if (pct >= parseFloat(b.min_score) &&
              pct <= parseFloat(b.max_score)) {
            performanceLevel = b.label;
            break;
          }
        }
      }

      leaderboard.push({
        student_id: student.id,
        full_name: student.full_name,
        admission_number: student.admission_number,
        total_marks: parseFloat(totalMarks.toFixed(2)),
        max_possible: classMaxPossible,
        percentage: pct,
        final_points: finalPoints,
        avg_points: avgPoints,
        performance_level: performanceLevel,
        grade_counts: gradeCounts,
        subjects_entered: results.length,
        results,
      });
    }

    if (level === 'jss') {
      leaderboard.sort((a, b) =>
        (b.final_points || 0) - (a.final_points || 0));
    } else {
      leaderboard.sort((a, b) =>
        b.percentage - a.percentage);
    }
    leaderboard.forEach((s, i) => { s.position = i + 1; });

    res.json({ exam, level, leaderboard });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getStudentProfile = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    const studentRes = await pool.query(
      `SELECT s.*, c.class_name, c.stream_name, c.level_type
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [id, school_id]
    );
    if (!studentRes.rows[0]) {
      return res.status(404).json({ error: 'Not found' });
    }

    // get all exams this student has results in
    const examsRes = await pool.query(
      `SELECT DISTINCT e.id, e.name, e.exam_type,
              e.start_date, e.max_score, t.name as term_name
       FROM results r
       JOIN exams e ON e.id = r.exam_id
       LEFT JOIN academic_terms t ON t.id = e.term_id
       WHERE r.student_id = $1 AND r.school_id = $2
       ORDER BY e.start_date DESC`,
      [id, school_id]
    );

    // get results per exam
    const examResults = {};
    for (const exam of examsRes.rows) {
      const res2 = await pool.query(
        `SELECT r.score, r.max_score, r.grade, r.points,
                s.name as subject_name, s.code
         FROM results r
         JOIN subjects s ON s.id = r.subject_id
         WHERE r.student_id = $1 AND r.exam_id = $2`,
        [id, exam.id]
      );
      examResults[exam.id] = res2.rows;
    }

    // subject averages from last 3 exams only
    const last3ExamIds = examsRes.rows.slice(0, 3).map(e => e.id);
    let subjectAverages = [];
    if (last3ExamIds.length > 0) {
      const avgRes = await pool.query(
        `SELECT s.name as subject_name,
                ROUND(AVG(r.score), 1) as avg_score,
                MIN(r.score) as min_score,
                MAX(r.score) as max_score
         FROM results r
         JOIN subjects s ON s.id = r.subject_id
         WHERE r.student_id = $1
         AND r.exam_id = ANY($2)
         GROUP BY s.name
         ORDER BY avg_score DESC`,
        [id, last3ExamIds]
      );
      subjectAverages = avgRes.rows;
    }

    // attendance
    const attRes = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'present') as present,
        COUNT(*) FILTER (WHERE status = 'absent') as absent,
        COUNT(*) FILTER (WHERE status = 'late') as late
       FROM attendance
       WHERE student_id = $1 AND school_id = $2`,
      [id, school_id]
    );

    const att = attRes.rows[0];
    const attRate = parseInt(att.total) > 0
      ? Math.round(parseInt(att.present) /
          parseInt(att.total) * 100)
      : 0;

    res.json({
      profile: studentRes.rows[0],
      exams: examsRes.rows,
      exam_results: examResults,
      subject_averages: subjectAverages,
      attendance: {
        total: parseInt(att.total),
        present: parseInt(att.present),
        absent: parseInt(att.absent),
        late: parseInt(att.late),
        rate: attRate,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};
