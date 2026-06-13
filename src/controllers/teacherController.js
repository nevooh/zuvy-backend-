const { pool } = require('../config/db');

// ── GET /teacher/home ──────────────────────────────────────────────────────────
// Returns everything the home screen needs in one request
exports.getHomeData = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;

  try {
    const dayOfWeek = new Date().getDay();

    // Run all queries independently — one failing doesn't kill the whole response
    const [statsResult, todayResult, noticesResult, myClassResult, classesResult] = await Promise.all([

      // ── Stat cards — counts from classes/students, no teacher_subjects ────
      pool.query(
        `SELECT
           (SELECT COUNT(DISTINCT c.id)
            FROM (
              SELECT class_id FROM timetable WHERE teacher_id = $1 AND school_id = $2
              UNION
              SELECT DISTINCT tt.class_id FROM timetable tt
              JOIN teacher_subjects ts2
                ON ts2.teacher_id = $1
                AND ts2.subject_id = tt.subject_id
                AND (ts2.class_id = tt.class_id OR ts2.class_id IS NULL)
              WHERE tt.school_id = $2
              UNION
              SELECT id FROM classes
              WHERE class_teacher_id = $1 AND school_id = $2
                AND (is_archived = false OR is_archived IS NULL)
            ) rc
            JOIN classes c ON c.id = rc.class_id
           ) AS total_classes,

           (SELECT COUNT(DISTINCT s.id)
            FROM students s
            WHERE s.school_id = $2
              AND s.status    = 'ACTIVE'
              AND s.class_id IN (
                SELECT class_id FROM timetable WHERE teacher_id = $1 AND school_id = $2
                UNION
                SELECT DISTINCT tt.class_id FROM timetable tt
                JOIN teacher_subjects ts2
                  ON ts2.teacher_id = $1
                  AND ts2.subject_id = tt.subject_id
                  AND (ts2.class_id = tt.class_id OR ts2.class_id IS NULL)
                WHERE tt.school_id = $2
                UNION
                SELECT id FROM classes
                WHERE class_teacher_id = $1 AND school_id = $2
                  AND (is_archived = false OR is_archived IS NULL)
              )
           ) AS total_students,

           (SELECT COUNT(DISTINCT tt.subject_id)
            FROM timetable tt
            WHERE tt.school_id = $2
              AND (
                tt.teacher_id = $1
                OR EXISTS (
                  SELECT 1 FROM teacher_subjects ts2
                  WHERE ts2.teacher_id = $1
                    AND ts2.subject_id = tt.subject_id
                    AND (ts2.class_id = tt.class_id OR ts2.class_id IS NULL)
                )
              )
           ) AS total_subjects`,
        [teacherId, schoolId]
      ),

      // ── Today's timetable ──────────────────────────────────────────────────
      pool.query(
        `SELECT
           tt.id,
           c.id         AS class_id,
           c.class_name,
           c.stream_name,
           sub.name     AS subject_name,
           sl.name      AS slot_name,
           sl.start_time,
           sl.end_time
         FROM timetable tt
         JOIN classes    c   ON c.id   = tt.class_id
         JOIN subjects   sub ON sub.id = tt.subject_id
         LEFT JOIN time_slots sl ON sl.id = tt.slot_id
         WHERE tt.school_id   = $2
           AND tt.day_of_week = $3
           AND (sl.is_break IS NULL OR sl.is_break = false)
           AND (c.is_archived = false OR c.is_archived IS NULL)
           AND (
             tt.teacher_id = $1
             OR EXISTS (
               SELECT 1 FROM teacher_subjects ts
               WHERE ts.teacher_id = $1
                 AND ts.subject_id = tt.subject_id
                 AND (ts.class_id = tt.class_id OR ts.class_id IS NULL)
             )
           )
         ORDER BY COALESCE(sl.sort_order, 9999), sl.start_time ASC NULLS LAST`,
        [teacherId, schoolId, dayOfWeek]
      ).catch(() => ({ rows: [] })),

      // ── Notices — safe fallback if announcements table missing ─────────────
      pool.query(
        `SELECT id, title, body, created_at
         FROM announcements
         WHERE school_id = $1
           AND (target_role = 'teacher' OR target_role = 'all')
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 5`,
        [schoolId]
      ).catch(() => ({ rows: [] })),

      // ── Class teacher's own class ─────────────────────────────────────────
      pool.query(
        `SELECT c.id, c.class_name, c.stream_name, c.level_type,
                COUNT(DISTINCT s.id) AS student_count
         FROM classes c
         LEFT JOIN students s ON s.class_id = c.id AND s.status = 'ACTIVE'
         WHERE c.class_teacher_id = $1 AND c.school_id = $2
           AND (c.is_archived = false OR c.is_archived IS NULL)
         GROUP BY c.id, c.class_name, c.stream_name, c.level_type
         LIMIT 1`,
        [teacherId, schoolId]
      ).catch(() => ({ rows: [] })),

      // ── All teacher's classes (fallback when timetable not set up) ──────────
      pool.query(
        `SELECT DISTINCT
           c.id,
           c.class_name,
           c.stream_name,
           c.level_type,
           COUNT(DISTINCT s.id) AS student_count
         FROM (
           SELECT class_id FROM timetable
           WHERE teacher_id = $1 AND school_id = $2
           UNION
           SELECT id AS class_id FROM classes
           WHERE class_teacher_id = $1 AND school_id = $2
             AND (is_archived = false OR is_archived IS NULL)
         ) rc
         JOIN classes c ON c.id = rc.class_id
         LEFT JOIN students s ON s.class_id = c.id AND s.status = 'ACTIVE'
         WHERE c.school_id = $2
           AND (c.is_archived = false OR c.is_archived IS NULL)
         GROUP BY c.id, c.class_name, c.stream_name, c.level_type
         ORDER BY c.class_name ASC`,
        [teacherId, schoolId]
      ).catch(() => ({ rows: [] })),
    ]);

    const stats = statsResult.rows[0];
    const now   = new Date();

    // Tag each slot as NOW / NEXT / DONE
    // start_time / end_time can be null if no time_slot is assigned yet
    const todayClasses = todayResult.rows.map((row, idx) => {
      if (!row.start_time || !row.end_time) {
        return { ...row, status: 'upcoming' };
      }
      const [sh, sm] = row.start_time.split(':').map(Number);
      const [eh, em] = row.end_time.split(':').map(Number);
      const start = new Date(); start.setHours(sh, sm, 0, 0);
      const end   = new Date(); end.setHours(eh, em, 0, 0);

      let status = 'upcoming';
      if (now >= start && now <= end) status = 'now';
      else if (now > end)             status = 'done';
      else if (idx > 0 && todayResult.rows
          .slice(0, idx)
          .every(r => {
            if (!r.end_time) return false;
            const [reh, rem] = r.end_time.split(':').map(Number);
            const re = new Date(); re.setHours(reh, rem, 0, 0);
            return now > re;
          }))                         status = 'next';

      return { ...row, status };
    });

    // Mark first upcoming as 'next' if nothing is 'now'
    const hasNow = todayClasses.some(c => c.status === 'now');
    if (!hasNow) {
      const firstUpcoming = todayClasses.find(c => c.status === 'upcoming');
      if (firstUpcoming) firstUpcoming.status = 'next';
    }

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          totalClasses:  parseInt(stats.total_classes)  || 0,
          totalStudents: parseInt(stats.total_students) || 0,
          totalSubjects: parseInt(stats.total_subjects) || 0,
        },
        todayClasses,
        myClass:    myClassResult.rows[0] || null,
        myClasses:  classesResult.rows,
        notices:    noticesResult.rows,
      },
    });

  } catch (err) {
    console.error('[getHomeData]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/timetable ─────────────────────────────────────────────────────
exports.getWeeklyTimetable = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;

  try {
    const result = await pool.query(
      `SELECT
         tt.day_of_week,
         c.id         AS class_id,
         c.class_name,
         c.stream_name,
         sub.name     AS subject_name,
         sl.name      AS slot_name,
         sl.start_time,
         sl.end_time,
         COALESCE(sl.sort_order, 9999) AS sort_order
       FROM timetable tt
       JOIN classes    c   ON c.id   = tt.class_id
       JOIN subjects   sub ON sub.id = tt.subject_id
       LEFT JOIN time_slots sl ON sl.id = tt.slot_id
       WHERE tt.school_id = $2
         AND (sl.is_break IS NULL OR sl.is_break = false)
         AND (
           tt.teacher_id = $1
           OR EXISTS (
             SELECT 1 FROM teacher_subjects ts
             WHERE ts.teacher_id = $1
               AND ts.subject_id = tt.subject_id
               AND (ts.class_id = tt.class_id OR ts.class_id IS NULL)
           )
         )
       ORDER BY tt.day_of_week, COALESCE(sl.sort_order, 9999), sl.start_time ASC NULLS LAST`,
      [teacherId, schoolId]
    );

    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const buckets  = {};
    for (const row of result.rows) {
      const d = row.day_of_week;
      if (!buckets[d]) buckets[d] = [];
      buckets[d].push(row);
    }

    const weekly = Object.keys(buckets)
      .sort((a, b) => Number(a) - Number(b))
      .map(d => ({ day: Number(d), name: dayNames[Number(d)], classes: buckets[d] }));

    return res.status(200).json({ success: true, data: weekly });
  } catch (err) {
    console.error('[getWeeklyTimetable]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/classes ───────────────────────────────────────────────────────
exports.getClasses = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;

  try {
    const result = await pool.query(
      `SELECT DISTINCT
         c.id,
         c.class_name,
         c.stream_name,
         c.level_type,
         COUNT(DISTINCT s.id)           AS student_count,
         COUNT(DISTINCT ts.subject_id)  AS subject_count
       FROM (
         SELECT class_id FROM timetable
         WHERE teacher_id = $1 AND school_id = $2
         UNION
         SELECT DISTINCT tt.class_id FROM timetable tt
         JOIN teacher_subjects ts2
           ON ts2.teacher_id = $1
           AND ts2.subject_id = tt.subject_id
           AND (ts2.class_id = tt.class_id OR ts2.class_id IS NULL)
         WHERE tt.school_id = $2
         UNION
         SELECT id AS class_id FROM classes
         WHERE class_teacher_id = $1 AND school_id = $2
           AND (is_archived = false OR is_archived IS NULL)
       ) relevant_classes
       JOIN classes c ON c.id = relevant_classes.class_id
       LEFT JOIN students s  ON s.class_id = c.id AND s.status = 'ACTIVE'
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = $1
         AND (ts.class_id = c.id OR ts.class_id IS NULL)
       WHERE c.school_id = $2
       GROUP BY c.id, c.class_name, c.stream_name, c.level_type
       ORDER BY c.class_name ASC`,
      [teacherId, schoolId]
    );

    return res.status(200).json({ success: true, data: result.rows });

  } catch (err) {
    console.error('[getClasses]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/classes/:classId/students ────────────────────────────────────
exports.getClassStudents = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;
  const { classId } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         s.id,
         s.full_name,
         s.admission_number,
         s.gender,
         -- today's attendance if already marked
         a.status AS attendance_today
       FROM students s
       LEFT JOIN attendance a
         ON a.student_id = s.id
        AND a.date = CURRENT_DATE
       WHERE s.class_id  = $1
         AND s.school_id = $2
         AND s.status    = 'ACTIVE'
       ORDER BY s.full_name ASC`,
      [classId, schoolId]
    );

    return res.status(200).json({ success: true, data: result.rows });

  } catch (err) {
    console.error('[getClassStudents]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /teacher/attendance ───────────────────────────────────────────────────
exports.submitAttendance = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;
  const { classId, records } = req.body;
  // records = [{ studentId, status }] status = 'present' | 'absent' | 'late'

  if (!classId || !records || !Array.isArray(records) || records.length === 0)
    return res.status(400).json({ success: false, message: 'classId and records required.' });

  try {
    // Upsert each record — if already marked today, update it
    const promises = records.map(({ studentId, status }) =>
      pool.query(
        `INSERT INTO attendance
           (school_id, student_id, class_id, date, status)
         VALUES ($1, $2, $3, CURRENT_DATE, $4)
         ON CONFLICT (student_id, date)
         DO UPDATE SET status = $4`,
        [schoolId, studentId, classId, status]
      )
    );

    await Promise.all(promises);

    return res.status(200).json({
      success: true,
      message: `Attendance saved for ${records.length} students.`,
    });

  } catch (err) {
    console.error('[submitAttendance]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/classes/:classId/subjects ────────────────────────────────────
// For marks entry — only subjects THIS teacher teaches in THIS class
exports.getClassSubjects = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;
  const { classId } = req.params;

  try {
    const result = await pool.query(
      `SELECT DISTINCT
         sub.id,
         sub.name
       FROM timetable tt
       JOIN subjects sub ON sub.id = tt.subject_id
       WHERE tt.teacher_id = $1
         AND tt.school_id  = $2
         AND tt.class_id   = $3`,
      [teacherId, schoolId, classId]
    );

    return res.status(200).json({ success: true, data: result.rows });

  } catch (err) {
    console.error('[getClassSubjects]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/exams?classId=xxx ────────────────────────────────────────────
// Returns school exams scoped to the current academic year of the class.
// After promotion, the new class has a new academic_year so old exams never appear.
exports.getExams = async (req, res) => {
  const schoolId = req.user.schoolId;
  const { classId } = req.query;

  try {
    let result;
    if (classId) {
      // Exams whose term.year matches the class's academic_year
      result = await pool.query(
        `SELECT e.id, e.name, e.exam_type, e.start_date,
                t.name AS term_name
         FROM exams e
         JOIN academic_terms t ON t.id = e.term_id
         WHERE e.school_id = $1
           AND t.year = (SELECT academic_year FROM classes WHERE id = $2 AND school_id = $1)
         ORDER BY COALESCE(e.start_date, e.created_at) DESC
         LIMIT 20`,
        [schoolId, classId]
      );
    } else {
      // No classId — return all exams for school (admin / generic fallback)
      result = await pool.query(
        `SELECT e.id, e.name, e.exam_type, e.start_date,
                t.name AS term_name
         FROM exams e
         LEFT JOIN academic_terms t ON t.id = e.term_id
         WHERE e.school_id = $1
         ORDER BY COALESCE(e.start_date, e.created_at) DESC
         LIMIT 20`,
        [schoolId]
      );
    }

    return res.status(200).json({ success: true, data: result.rows });

  } catch (err) {
    console.error('[getExams]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /teacher/results ─────────────────────────────────────────────────────
// Saves marks to the `results` table (same table getClassResults reads from)
exports.submitResults = async (req, res) => {
  const schoolId = req.user.schoolId;
  const { examId, entries } = req.body;
  // entries = [{ studentId, subjectId, score }]

  if (!examId || !Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ success: false, message: 'examId and entries required.' });

  try {
    const examRes = await pool.query(
      'SELECT max_score FROM exams WHERE id = $1 AND school_id = $2',
      [examId, schoolId]
    );
    const max_score = parseInt(examRes.rows[0]?.max_score) || 100;

    const valid = entries.filter(e => {
      const s = parseFloat(e.score);
      return !isNaN(s) && e.studentId && e.subjectId;
    });

    await Promise.all(valid.map(({ studentId, subjectId, score }) =>
      pool.query(
        `INSERT INTO results (school_id, student_id, exam_id, subject_id, score, max_score)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, exam_id, subject_id)
         DO UPDATE SET score = $5, max_score = $6`,
        [schoolId, studentId, examId, subjectId, parseFloat(score), max_score]
      )
    ));

    return res.status(200).json({ success: true, message: `Saved ${valid.length} marks.` });
  } catch (err) {
    console.error('[submitResults]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /teacher/marks ───────────────────────────────────────────────────────
exports.submitMarks = async (req, res) => {
  const schoolId  = req.user.schoolId;
  const { examId, subjectId, records } = req.body;
  // records = [{ studentId, componentId, score }]

  if (!examId || !subjectId || !records || !Array.isArray(records))
    return res.status(400).json({ success: false, message: 'examId, subjectId and records required.' });

  try {
    const promises = records.map(({ studentId, componentId, score }) =>
      pool.query(
        `INSERT INTO result_components
           (school_id, student_id, exam_id, subject_id, component_id, score)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, exam_id, component_id)
         DO UPDATE SET score = $6`,
        [schoolId, studentId, examId, subjectId, componentId, score]
      )
    );

    await Promise.all(promises);

    return res.status(200).json({
      success: true,
      message: `Marks saved for ${records.length} entries.`,
    });

  } catch (err) {
    console.error('[submitMarks]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/students ──────────────────────────────────────────────────────
exports.getStudents = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;

  try {
    const result = await pool.query(
      `SELECT DISTINCT
         s.id,
         s.full_name,
         s.admission_number,
         s.gender,
         s.parent_phone,
         c.class_name,
         c.stream_name,
         c.id AS class_id
       FROM students s
       JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = $2
         AND s.status    = 'ACTIVE'
         AND (c.is_archived = false OR c.is_archived IS NULL)
         AND (
           c.id IN (
             SELECT class_id FROM timetable
             WHERE teacher_id = $1 AND school_id = $2
           )
           OR c.id IN (
             SELECT DISTINCT tt.class_id FROM timetable tt
             JOIN teacher_subjects ts
               ON ts.teacher_id = $1
               AND ts.subject_id = tt.subject_id
               AND (ts.class_id = tt.class_id OR ts.class_id IS NULL)
             WHERE tt.school_id = $2
           )
           OR c.class_teacher_id = $1
         )
       ORDER BY c.class_name ASC, s.full_name ASC`,
      [teacherId, schoolId]
    );

    return res.status(200).json({ success: true, data: result.rows });

  } catch (err) {
    console.error('[getStudents]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/profile ───────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;

  try {
    const result = await pool.query(
      `SELECT
         t.id,
         t.name,
         t.email,
         t.phone,
         t.level_type,
         sch.name AS school_name,
         sch.id   AS school_id,
         COUNT(DISTINCT tt.class_id) AS total_classes,
         (SELECT COUNT(DISTINCT s.id)
          FROM students s
          JOIN timetable tt2 ON tt2.class_id = s.class_id
          WHERE tt2.teacher_id = t.id
            AND s.status = 'ACTIVE') AS total_students,
         COALESCE(
           (SELECT json_agg(DISTINCT sub.name ORDER BY sub.name)
            FROM teacher_subjects ts2
            JOIN subjects sub ON sub.id = ts2.subject_id
            WHERE ts2.teacher_id = t.id),
           '[]'
         ) AS subjects
       FROM teachers t
       JOIN schools sch ON sch.id = t.school_id
       LEFT JOIN timetable tt ON tt.teacher_id = t.id
       WHERE t.id        = $1
         AND t.school_id = $2
       GROUP BY t.id, sch.name, sch.id`,
      [teacherId, schoolId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Teacher not found.' });

    return res.status(200).json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error('[getProfile]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/classes/:classId/results?examId=X ────────────────────────────
exports.getClassResults = async (req, res) => {
  const schoolId  = req.user.schoolId;
  const { classId } = req.params;
  let   { examId }  = req.query;

  try {
    // 1. Exams scoped to this class's academic year — no exam_classes dependency.
    //    After promotion the class has a new academic_year so old exams never appear.
    const examsResult = await pool.query(
      `SELECT e.id, e.name, e.exam_type, e.start_date, e.max_score
       FROM exams e
       JOIN academic_terms t ON t.id = e.term_id
       WHERE e.school_id = $2
         AND t.year = (SELECT academic_year FROM classes WHERE id = $1 AND school_id = $2)
       ORDER BY e.id DESC`,
      [classId, schoolId]
    );

    const exams = examsResult.rows;
    if (exams.length === 0)
      return res.status(200).json({
        success: true,
        data: { exams: [], subjects: [], students: [], subjectTrends: [] },
      });

    // Default to latest exam if none specified
    if (!examId) examId = exams[0].id;

    // 2. All subjects for this class from class_subjects
    const subjectsResult = await pool.query(
      `SELECT cs.subject_id AS id, s.name
       FROM class_subjects cs
       JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.class_id = $1
       ORDER BY s.name ASC`,
      [classId]
    );
    const allSubjects = subjectsResult.rows;

    // 3. All active students in this class
    const studentsResult = await pool.query(
      `SELECT s.id, s.full_name, s.admission_number, s.gender
       FROM students s
       WHERE s.class_id  = $1
         AND s.school_id = $2
         AND s.status    = 'ACTIVE'
       ORDER BY s.full_name ASC`,
      [classId, schoolId]
    );
    const allStudents = studentsResult.rows;

    // 4. Actual results for selected exam
    const resultsResult = await pool.query(
      `SELECT r.student_id, r.subject_id,
              r.score, r.max_score, r.grade
       FROM results r
       WHERE r.exam_id    = $1
         AND r.school_id  = $2
         AND r.student_id IN (
           SELECT id FROM students
           WHERE class_id = $3 AND status = 'ACTIVE'
         )`,
      [examId, schoolId, classId]
    );

    // Index results by student+subject for fast lookup
    const resultMap = {};
    for (const r of resultsResult.rows) {
      resultMap[`${r.student_id}_${r.subject_id}`] = r;
    }

    // 5. Build subject summary — ALL subjects, 0 if not recorded
    const subjects = allSubjects.map(sub => {
      const scores = allStudents.map(st => {
        const key = `${st.id}_${sub.id}`;
        return resultMap[key]
          ? parseFloat(resultMap[key].score)
          : 0;
      });
      const recorded = scores.filter(s => s > 0);
      const avg = recorded.length > 0
        ? Math.round(recorded.reduce((a, b) => a + b, 0)
            / recorded.length * 10) / 10
        : 0;
      const max = recorded.length > 0
        ? Math.max(...recorded) : 0;
      const min = recorded.length > 0
        ? Math.min(...recorded) : 0;

      return {
        id:             sub.id,
        name:           sub.name,
        avg_score:      avg,
        max_score:      max,
        min_score:      min,
        recorded_count: recorded.length,
        total_students: allStudents.length,
      };
    });

    // 6. Build student list — ALL students, 0 per subject if not recorded
    const students = allStudents.map(st => {
      const subjectScores = allSubjects.map(sub => {
        const key  = `${st.id}_${sub.id}`;
        const res  = resultMap[key];
        return {
          subject_id:   sub.id,
          subject_name: sub.name,
          score:        res ? parseFloat(res.score) : 0,
          grade:        res ? res.grade : '-',
          recorded:     !!res,
        };
      });

      const recorded = subjectScores.filter(s => s.recorded);
      const total    = recorded.length > 0
        ? Math.round(recorded.reduce((a, b) =>
            a + b.score, 0) / recorded.length * 10) / 10
        : 0;

      return {
        id:               st.id,
        full_name:        st.full_name,
        admission_number: st.admission_number,
        gender:           st.gender,
        avg_score:        total,
        subjects:         subjectScores,
        recorded_count:   recorded.length,
      };
    });

    // Sort students by avg_score desc
    students.sort((a, b) => b.avg_score - a.avg_score);

    // 7. Subject trends across ALL exams for this class
    const trendsResult = await pool.query(
      `SELECT
         e.id        AS exam_id,
         e.name      AS exam_name,
         r.subject_id,
         s.name      AS subject_name,
         ROUND(AVG(r.score)::numeric, 1) AS avg_score
       FROM results r
       JOIN exams e    ON e.id   = r.exam_id
       JOIN subjects s ON s.id  = r.subject_id
       JOIN exam_classes ec ON ec.exam_id  = e.id
                           AND ec.class_id = $1
       JOIN students st ON st.id = r.student_id
                       AND st.class_id = $1
       WHERE r.school_id = $2
       GROUP BY e.id, e.name, r.subject_id, s.name
       ORDER BY e.id ASC`,
      [classId, schoolId]
    );

    // Group trends by subject
    const subjectTrends = {};
    for (const row of trendsResult.rows) {
      if (!subjectTrends[row.subject_id]) {
        subjectTrends[row.subject_id] = {
          subject_id:   row.subject_id,
          subject_name: row.subject_name,
          exams:        [],
        };
      }
      subjectTrends[row.subject_id].exams.push({
        exam_id:   row.exam_id,
        exam_name: row.exam_name,
        avg_score: parseFloat(row.avg_score),
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        exams,
        selectedExamId: parseInt(examId),
        subjects,
        students,
        subjectTrends: Object.values(subjectTrends),
      },
    });

  } catch (err) {
    console.error('[getClassResults]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
// ── ADD THESE TO YOUR EXISTING teacherController.js ──────────────────────────

// ── GET /teacher/class ────────────────────────────────────────────────────────
// Returns the ONE class this teacher is class teacher of
exports.getMyClass = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;
  try {
    const result = await pool.query(
      `SELECT c.id, c.class_name, c.stream_name, c.level_type,
              COUNT(DISTINCT s.id) AS student_count
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id AND s.status = 'ACTIVE'
       WHERE c.class_teacher_id = $1
         AND c.school_id        = $2
         AND (c.is_archived = false OR c.is_archived IS NULL)
       GROUP BY c.id, c.class_name, c.stream_name, c.level_type`,
      [teacherId, schoolId]
    );
    if (result.rows.length === 0)
      return res.status(200).json({ success: true, data: null });
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[getMyClass]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/class/fees ───────────────────────────────────────────────────
// Students in the class teacher's class with fee summary (latest term)
exports.getClassFees = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;
  try {
    // Find the class this teacher is class teacher of
    const classResult = await pool.query(
      `SELECT id FROM classes
       WHERE class_teacher_id = $1 AND school_id = $2
         AND (is_archived = false OR is_archived IS NULL) LIMIT 1`,
      [teacherId, schoolId]
    );
    if (classResult.rows.length === 0)
      return res.status(200).json({ success: true, data: [] });

    const classId = classResult.rows[0].id;

    // Get latest term for this school
    const termResult = await pool.query(
      `SELECT id FROM academic_terms
       WHERE school_id = $1
       ORDER BY CASE WHEN is_active THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1`,
      [schoolId]
    );
    const termId = termResult.rows[0]?.id;
    if (!termId)
      return res.status(200).json({ success: true, data: [] });

    const result = await pool.query(
      `SELECT
         s.id,
         s.full_name,
         s.admission_number,
         s.gender,
         s.parent_name,
         s.parent_phone,
         COALESCE(si.total_amount, 0)             AS billed,
         COALESCE(si.balance, 0)                  AS balance,
         COALESCE(si.status, 'UNPAID')            AS status,
         COALESCE(
           (SELECT SUM(p.amount_paid)
            FROM payments p
            WHERE p.student_id = s.id
              AND p.term_id    = $3
              AND p.school_id  = $2), 0
         ) AS paid
       FROM students s
       LEFT JOIN student_invoices si
         ON si.student_id = s.id AND si.term_id = $3
       WHERE s.class_id  = $1
         AND s.school_id = $2
         AND s.status    = 'ACTIVE'
       ORDER BY s.full_name ASC`,
      [classId, schoolId, termId]
    );

    return res.status(200).json({ success: true, data: result.rows, termId });
  } catch (err) {
    console.error('[getClassFees]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/class/attendance-history ─────────────────────────────────────
// All attendance records for the class teacher's class
exports.getAttendanceHistory = async (req, res) => {
  const teacherId = parseInt(req.user.teacherId);
  const schoolId  = req.user.schoolId;
  try {
    const classResult = await pool.query(
      `SELECT id FROM classes
       WHERE class_teacher_id = $1 AND school_id = $2
         AND (is_archived = false OR is_archived IS NULL) LIMIT 1`,
      [teacherId, schoolId]
    );
    if (classResult.rows.length === 0)
      return res.status(200).json({ success: true, data: [] });

    const classId = classResult.rows[0].id;

    const result = await pool.query(
      `SELECT
         a.date::text,
         a.student_id,
         a.status,
         s.full_name,
         s.admission_number
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       WHERE a.class_id  = $1
         AND a.school_id = $2
       ORDER BY a.date DESC, s.full_name ASC`,
      [classId, schoolId]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getAttendanceHistory]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /teacher/students/:studentId/transactions ─────────────────────────────
exports.getStudentTransactions = async (req, res) => {
  const schoolId       = req.user.schoolId;
  const { studentId }  = req.params;
  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.amount_paid,
         p.payment_method,
         p.reference,
         p.created_at,
         t.name AS term_name
       FROM payments p
       JOIN academic_terms t ON t.id = p.term_id
       WHERE p.student_id = $1
         AND p.school_id  = $2
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [studentId, schoolId]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getStudentTransactions]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── PUT /teacher/students/:studentId/parent ───────────────────────────────────
exports.updateParentInfo = async (req, res) => {
  const schoolId      = req.user.schoolId;
  const { studentId } = req.params;
  const { parent_name, parent_phone } = req.body;
  try {
    await pool.query(
      `UPDATE students
       SET parent_name = $1, parent_phone = $2
       WHERE id = $3 AND school_id = $4`,
      [parent_name, parent_phone, studentId, schoolId]
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[updateParentInfo]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};