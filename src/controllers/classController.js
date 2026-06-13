const db = require('../config/db');

// --- CREATE ---
exports.createClass = async (req, res) => {
    const { class_name, stream_name, teacher_name, level_type } = req.body;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `INSERT INTO classes (school_id, class_name, stream_name, teacher_name, level_type)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [school_id, class_name, stream_name, teacher_name, level_type || 'primary']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- READ (ALL) — active (non-archived) classes only ---
exports.getAllClasses = async (req, res) => {
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `SELECT c.*, COALESCE(sc.cnt, 0)::int AS student_count
             FROM classes c
             LEFT JOIN (
               SELECT class_id, COUNT(*) AS cnt
               FROM students
               WHERE status = 'ACTIVE'
               GROUP BY class_id
             ) sc ON sc.class_id = c.id
             WHERE c.school_id = $1
               AND (c.is_archived = false OR c.is_archived IS NULL)
             ORDER BY c.level_type DESC, c.class_name ASC`,
            [school_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- UPDATE ---
exports.updateClass = async (req, res) => {
    const { id } = req.params;
    const { class_name, stream_name, teacher_name, level_type } = req.body;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `UPDATE classes
             SET class_name = $1, stream_name = $2, teacher_name = $3, level_type = $4
             WHERE id = $5 AND school_id = $6
               AND (is_archived = false OR is_archived IS NULL)
             RETURNING *`,
            [class_name, stream_name, teacher_name, level_type, id, school_id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Class not found" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- DELETE ---
exports.deleteClass = async (req, res) => {
    const { id } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `DELETE FROM classes
             WHERE id = $1 AND school_id = $2
               AND (is_archived = false OR is_archived IS NULL)
             RETURNING *`,
            [id, school_id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Class not found" });
        res.json({ message: "Class deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- GET STUDENTS IN CLASS ---
exports.getClassStudents = async (req, res) => {
    const { id } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `SELECT s.*, c.class_name, c.stream_name
             FROM students s
             LEFT JOIN classes c ON c.id = s.class_id
             WHERE s.class_id = $1 AND s.school_id = $2`,
            [id, school_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- UPDATE LEVEL ORDER (GROUPED) ---
exports.updateLevelOrder = async (req, res) => {
    const { class_name, level_order } = req.body;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `UPDATE classes
             SET level_order = $1
             WHERE class_name = $2 AND school_id = $3
               AND (is_archived = false OR is_archived IS NULL)
             RETURNING *`,
            [level_order, class_name, school_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No classes found with that name" });
        }

        res.json({
            message: `Successfully updated ${result.rows.length} streams to Level ${level_order}`,
            updatedCount: result.rows.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─── PREVIEW PROMOTION ────────────────────────────────────────────────────────
// Read-only. Shows what execute will do using the Destructive Stream-Preserving
// design: each class creates a new record at level+1 inheriting the next level's
// class_name and its own stream_name. Old records are archived (not deleted).
exports.previewPromotion = async (req, res) => {
  const school_id = req.user.school_id;

  try {
    // Block if any term is still active
    const termCheck = await db.query(
      `SELECT name FROM public.academic_terms
       WHERE school_id = $1 AND is_active = true LIMIT 1`,
      [school_id]
    );
    if (termCheck.rows.length > 0) {
      return res.json({
        graduating: [], promotions: [], unmapped: [],
        total_graduating: 0, total_promoting: 0,
        can_proceed: false,
        active_term_blocked: true,
        active_term_name: termCheck.rows[0].name
      });
    }

    const result = await db.query(
      `SELECT c.*,
              COUNT(s.id) FILTER (WHERE s.status = 'ACTIVE')::int AS active_count
       FROM public.classes c
       LEFT JOIN public.students s ON s.class_id = c.id
       WHERE c.school_id = $1
         AND (c.is_archived = false OR c.is_archived IS NULL)
       GROUP BY c.id
       ORDER BY c.level_order DESC NULLS LAST, c.class_name ASC`,
      [school_id]
    );

    const classes = result.rows;
    if (classes.length === 0) {
      return res.json({
        graduating: [], promotions: [], unmapped: [],
        total_graduating: 0, total_promoting: 0, can_proceed: false
      });
    }

    const withOrder = classes.filter(c => c.level_order != null);
    if (withOrder.length === 0) {
      return res.status(400).json({
        error: 'No level sequence configured. Set levels in "Level Sequence" first.'
      });
    }

    // Global level map — active preferred, falls back to most recent archived
    const globalResult = await db.query(
      `SELECT DISTINCT ON (level_order) level_order, class_name, level_type
       FROM public.classes
       WHERE school_id = $1 AND level_order IS NOT NULL
       ORDER BY level_order,
                is_archived ASC NULLS LAST,
                academic_year DESC NULLS LAST`,
      [school_id]
    );
    const globalLevelMap = {};
    for (const row of globalResult.rows) {
      globalLevelMap[row.level_order] = {
        class_name: row.class_name,
        level_type: row.level_type
      };
    }
    const globalMaxLevel = Math.max(...Object.keys(globalLevelMap).map(Number));

    // Determine current academic year
    const yearResult = await db.query(
      `SELECT MAX(academic_year) AS max_year FROM public.classes
       WHERE school_id = $1
         AND (is_archived = false OR is_archived IS NULL)`,
      [school_id]
    );
    const currentYear = yearResult.rows[0].max_year ?? new Date().getFullYear();
    const newYear = currentYear + 1;

    const graduating = [], promotions = [], unmapped = [];

    for (const cls of classes) {
      if (cls.level_order == null) {
        unmapped.push({
          class_id: cls.id,
          class_name: cls.class_name,
          stream_name: cls.stream_name,
          issue: 'level_order not set'
        });
        continue;
      }

      if (cls.level_order === globalMaxLevel) {
        graduating.push({
          class_id: cls.id,
          class_name: cls.class_name,
          stream_name: cls.stream_name,
          student_count: cls.active_count
        });
      } else {
        const target = globalLevelMap[cls.level_order + 1];
        if (!target) {
          unmapped.push({
            class_id: cls.id,
            class_name: cls.class_name,
            stream_name: cls.stream_name,
            issue: `No class configured at level ${cls.level_order + 1}. Add it in Level Sequence.`
          });
        } else {
          promotions.push({
            from: {
              class_id: cls.id,
              class_name: cls.class_name,
              stream_name: cls.stream_name,
              level_order: cls.level_order,
              student_count: cls.active_count
            },
            to: {
              class_name: target.class_name,
              level_type: target.level_type,
              stream_name: cls.stream_name,
              level_order: cls.level_order + 1,
              academic_year: newYear
            }
          });
        }
      }
    }

    return res.json({
      graduating,
      promotions,
      unmapped,
      current_year: currentYear,
      new_year: newYear,
      total_graduating: graduating.reduce((s, c) => s + c.student_count, 0),
      total_promoting:  promotions.reduce((s, p) => s + p.from.student_count, 0),
      can_proceed: unmapped.length === 0 && classes.length > 0,
      active_term_blocked: false
    });

  } catch (err) {
    console.error('previewPromotion error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── EXECUTE PROMOTION ────────────────────────────────────────────────────────
// Destructive Stream-Preserving Promotion:
//   • Each class creates a new DB record at level+1 with the next level's
//     class_name, the source's stream_name, and the new academic year.
//   • The source record is archived (is_archived=true). It is never deleted.
//   • Students are moved via class_id update (trigger logs to promotion_history).
//   • Max-level classes graduate to alumni; their record is also archived.
//   • Processing is top-down so students don't cascade into each other within
//     the same promotion run.
exports.promoteAllStudents = async (req, res) => {
  const school_id = req.user.school_id;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Block if any term is still active
    const termCheck = await client.query(
      `SELECT name FROM public.academic_terms
       WHERE school_id = $1 AND is_active = true LIMIT 1`,
      [school_id]
    );
    if (termCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot promote while "${termCheck.rows[0].name}" is still active. Close the term first.`
      });
    }

    // Fetch all active (non-archived) classes with student counts
    const result = await client.query(
      `SELECT c.*,
              COUNT(s.id) FILTER (WHERE s.status = 'ACTIVE')::int AS active_count
       FROM public.classes c
       LEFT JOIN public.students s ON s.class_id = c.id
       WHERE c.school_id = $1
         AND (c.is_archived = false OR c.is_archived IS NULL)
       GROUP BY c.id
       ORDER BY c.level_order DESC NULLS LAST`,
      [school_id]
    );

    const classes = result.rows;
    if (classes.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No classes found' });
    }

    const withOrder = classes.filter(c => c.level_order != null);
    if (withOrder.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No level sequence configured. Set levels first.'
      });
    }

    // Validate: every class must have a level_order set
    for (const cls of classes) {
      if (cls.level_order == null) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `"${cls.class_name}" has no level set. Fix in Level Sequence.`
        });
      }
    }

    // Global level map — ALL classes school-wide (active preferred, then most recent
    // archived). This lets grade 6 primary find grade 7 jss even after jss promotion
    // has already archived the old grade 7 record.
    const globalResult = await client.query(
      `SELECT DISTINCT ON (level_order) level_order, class_name, level_type
       FROM public.classes
       WHERE school_id = $1 AND level_order IS NOT NULL
       ORDER BY level_order,
                is_archived ASC NULLS LAST,
                academic_year DESC NULLS LAST`,
      [school_id]
    );
    const globalLevelMap = {};
    for (const row of globalResult.rows) {
      globalLevelMap[row.level_order] = {
        class_name: row.class_name,
        level_type: row.level_type
      };
    }

    // True school-wide max — derived from ACTIVE classes only.
    // Using globalLevelMap (which includes archived classes) would inflate the
    // max if a failed/partial promotion left archived classes at higher levels,
    // causing the real top class to be "promoted" instead of graduated.
    const globalMaxLevel = Math.max(...classes.map(c => c.level_order));
    console.log('[promotion] globalMaxLevel =', globalMaxLevel,
      '| active class levels:', classes.map(c => `${c.class_name}(${c.level_order})`));

    // Validate: every class in this level_type batch must have a destination
    for (const cls of classes) {
      if (cls.level_order !== globalMaxLevel && !globalLevelMap[cls.level_order + 1]) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `No class configured at level ${cls.level_order + 1}. Add it in Level Sequence first.`
        });
      }
    }

    // Determine new academic year
    const yearResult = await client.query(
      `SELECT MAX(academic_year) AS max_year FROM public.classes
       WHERE school_id = $1
         AND (is_archived = false OR is_archived IS NULL)`,
      [school_id]
    );
    const currentYear = yearResult.rows[0].max_year ?? new Date().getFullYear();
    const newYear = currentYear + 1;

    let graduated = 0, promoted = 0;

    // Process top-down (highest level first) to avoid student cascade collisions
    for (const cls of classes) {

      if (cls.level_order === globalMaxLevel) {
        // ── GRADUATE ──────────────────────────────────────────────────────────
        await client.query(
          `INSERT INTO public.alumni
             (school_id, student_name, admission_number, last_class_name, graduation_year)
           SELECT school_id, full_name, admission_number, $2, $3::int
           FROM public.students
           WHERE class_id = $1 AND status = 'ACTIVE'`,
          [cls.id, cls.class_name, newYear]
        );

        const r = await client.query(
          `UPDATE public.students SET status = 'GRADUATED'
           WHERE class_id = $1 AND status = 'ACTIVE' RETURNING id`,
          [cls.id]
        );
        graduated += r.rowCount;

      } else {
        // ── PROMOTE ───────────────────────────────────────────────────────────
        // Use global map so cross-level-type names and level_types are correct
        // (e.g. grade 6 primary → grade 7 jss inherits 'jss' not 'primary')
        const target = globalLevelMap[cls.level_order + 1];

        const newClass = await client.query(
          `INSERT INTO public.classes
             (school_id, class_name, stream_name, teacher_name, level_type,
              level_order, academic_year, previous_stream_id, is_archived)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
           RETURNING id`,
          [
            school_id,
            target.class_name,
            cls.stream_name,
            cls.teacher_name,
            target.level_type,
            cls.level_order + 1,
            newYear,
            cls.id
          ]
        );
        const newClassId = newClass.rows[0].id;

        const r = await client.query(
          `UPDATE public.students SET class_id = $1
           WHERE class_id = $2 AND status = 'ACTIVE' RETURNING id`,
          [newClassId, cls.id]
        );
        promoted += r.rowCount;

        // Copy subject assignments from the most recent archived class at the
        // destination level (same stream) so the new class starts with the
        // correct subjects rather than an empty slate.
        const prevDest = await client.query(
          `SELECT id FROM public.classes
           WHERE school_id = $1
             AND level_order = $2
             AND stream_name = $3
             AND is_archived = true
           ORDER BY academic_year DESC
           LIMIT 1`,
          [school_id, cls.level_order + 1, cls.stream_name]
        );
        if (prevDest.rows.length > 0) {
          await client.query(
            `INSERT INTO class_subjects (class_id, subject_id)
             SELECT $1, subject_id FROM class_subjects
             WHERE class_id = $2
             ON CONFLICT DO NOTHING`,
            [newClassId, prevDest.rows[0].id]
          );
        }
      }

      // Archive old record — never deleted, stays as historical anchor
      await client.query(
        `UPDATE public.classes SET is_archived = true WHERE id = $1`,
        [cls.id]
      );
    }

    // Strip all teacher and subject assignments — clean slate for new year
    await client.query(
      `DELETE FROM public.teacher_subjects
       WHERE teacher_id IN (SELECT id FROM public.teachers WHERE school_id = $1)`,
      [school_id]
    );
    await client.query(
      `UPDATE public.teachers SET class_id = NULL WHERE school_id = $1`,
      [school_id]
    );
    await client.query(
      `UPDATE public.classes SET class_teacher_id = NULL
       WHERE school_id = $1 AND (is_archived = false OR is_archived IS NULL)`,
      [school_id]
    );

    await client.query('COMMIT');
    return res.json({
      message: `Done. ${promoted} students promoted, ${graduated} graduated to alumni.`,
      summary: { promoted, graduated, new_year: newYear }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('promoteAllStudents error:', err);
    return res.status(500).json({ error: 'Promotion failed: ' + err.message });
  } finally {
    client.release();
  }
};

// --- DELETE BY CLASS NAME ---
exports.deleteClassByName = async (req, res) => {
  const { class_name } = req.query;
  const school_id = req.user.school_id;

  if (!class_name) {
    return res.status(400).json({ error: "class_name is required" });
  }

  try {
    const result = await db.query(
      `DELETE FROM classes
       WHERE class_name = $1 AND school_id = $2
         AND (is_archived = false OR is_archived IS NULL)
       RETURNING *`,
      [class_name, school_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No classes found with that name" });
    }

    res.json({ message: `Deleted ${result.rows.length} streams in ${class_name}` });
  } catch (err) {
    console.error(err);
    if (err.code === 'P0001') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
};

// --- ASSIGN TEACHER TO MULTIPLE CLASSES ---
exports.assignTeacherToClasses = async (req, res) => {
    const { teacher_id, class_ids } = req.body;
    const school_id = req.user.school_id;

    if (!class_ids || !Array.isArray(class_ids)) {
        return res.status(400).json({ error: "No classes selected" });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        for (const class_id of class_ids) {
            await client.query(
                `INSERT INTO teacher_assignments (teacher_id, class_id, school_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
                [teacher_id, class_id, school_id]
            );
        }

        await client.query('COMMIT');
        res.json({ message: "Teacher linked to selected classes successfully" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

exports.getTeacherAssignments = async (req, res) => {
    const { teacherId } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `SELECT c.id, c.class_name, c.stream_name
             FROM classes c
             JOIN teacher_assignments ta ON c.id = ta.class_id
             WHERE ta.teacher_id = $1 AND ta.school_id = $2
               AND (c.is_archived = false OR c.is_archived IS NULL)`,
            [teacherId, school_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
