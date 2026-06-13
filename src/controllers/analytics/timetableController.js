const pool = require('../../config/analyticsPool');

exports.getSlots = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM time_slots
       WHERE school_id = $1 ${level ? 'AND level_type = $2' : ''}
       ORDER BY sort_order, start_time`,
      level ? [school_id, level] : [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createSlot = async (req, res) => {
  const school_id = req.school_id;
  const { name, start_time, end_time,
          is_break, sort_order, level_type } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO time_slots
        (school_id, name, start_time, end_time,
         is_break, sort_order, level_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [school_id, name, start_time, end_time,
       is_break || false, sort_order || 0,
       level_type || 'primary']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSlot = async (req, res) => {
  const school_id = req.school_id;
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM time_slots WHERE id=$1 AND school_id=$2`,
      [id, school_id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTimetable = async (req, res) => {
  const school_id = req.school_id;
  const { class_id } = req.params;
  try {
    const classRes = await pool.query(
      `SELECT level_type FROM classes WHERE id = $1 AND school_id = $2`,
      [class_id, school_id]
    );
    const levelType = classRes.rows[0]?.level_type;
    const slots = await pool.query(
      `SELECT * FROM time_slots
       WHERE school_id = $1 ${levelType ? 'AND level_type = $2' : ''}
       ORDER BY sort_order, start_time`,
      levelType ? [school_id, levelType] : [school_id]
    );
    const entries = await pool.query(
      `SELECT tt.*, s.name as subject_name,
              s.code as subject_code,
              t.name as teacher_name,
              t.id as teacher_id
       FROM timetable tt
       LEFT JOIN subjects s ON s.id = tt.subject_id
       LEFT JOIN teachers t ON t.id = tt.teacher_id
       WHERE tt.class_id = $1 AND tt.school_id = $2`,
      [class_id, school_id]
    );
    const map = {};
    for (const e of entries.rows) {
      if (!map[e.day_of_week]) map[e.day_of_week] = {};
      map[e.day_of_week][e.slot_id] = e;
    }
    res.json({ slots: slots.rows, timetable: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSubjectTeacher = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, subject_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT t.id, t.name
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       WHERE ts.subject_id = $1
         AND (ts.class_id = $2 OR ts.class_id IS NULL)
         AND t.school_id = $3
       ORDER BY CASE WHEN ts.class_id = $2 THEN 0 ELSE 1 END
       LIMIT 1`,
      [subject_id, class_id, school_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// all teachers assigned to a subject in a class (for dropdown filtering)
exports.getTeachersForSubject = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, subject_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT DISTINCT t.id, t.name
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       WHERE ts.subject_id = $1
         AND (ts.class_id = $2 OR ts.class_id IS NULL)
         AND t.school_id = $3
       ORDER BY t.name`,
      [subject_id, class_id, school_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.checkTeacherConflict = async (req, res) => {
  const school_id = req.school_id;
  const { teacher_id, day_of_week,
          slot_id, exclude_class_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT tt.class_id, c.class_name, c.stream_name
       FROM timetable tt
       JOIN classes c ON c.id = tt.class_id
       WHERE tt.teacher_id = $1
       AND tt.day_of_week = $2
       AND tt.slot_id = $3
       AND tt.school_id = $4
       ${exclude_class_id ? 'AND tt.class_id != $5' : ''}`,
      exclude_class_id
        ? [teacher_id, day_of_week, slot_id, school_id, exclude_class_id]
        : [teacher_id, day_of_week, slot_id, school_id]
    );
    if (result.rows.length > 0) {
      const conflict = result.rows[0];
      res.json({
        conflict: true,
        class_name: `${conflict.class_name} ${conflict.stream_name || ''}`.trim(),
      });
    } else {
      res.json({ conflict: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setEntry = async (req, res) => {
  const school_id = req.school_id;
  const { class_id, day_of_week, slot_id,
          subject_id, teacher_id, level_type,
          room, is_double } = req.body;
  try {
    if (!subject_id) {
      await pool.query(
        `DELETE FROM timetable
         WHERE class_id=$1 AND day_of_week=$2
         AND slot_id=$3 AND school_id=$4`,
        [class_id, day_of_week, slot_id, school_id]
      );
      return res.json({ message: 'Cleared' });
    }

    if (teacher_id) {
      const conflict = await pool.query(
        `SELECT tt.class_id, c.class_name, c.stream_name
         FROM timetable tt
         JOIN classes c ON c.id = tt.class_id
         WHERE tt.teacher_id = $1
         AND tt.day_of_week = $2
         AND tt.slot_id = $3
         AND tt.school_id = $4
         AND tt.class_id != $5`,
        [teacher_id, day_of_week, slot_id, school_id, class_id]
      );
      if (conflict.rows.length > 0) {
        const c = conflict.rows[0];
        return res.status(409).json({
          error: `Teacher is already assigned to ${c.class_name} ${c.stream_name || ''} at this time`,
          conflict_class: `${c.class_name} ${c.stream_name || ''}`.trim(),
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO timetable
        (school_id, class_id, day_of_week, slot_id,
         subject_id, teacher_id, level_type, room)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (class_id, day_of_week, slot_id)
       DO UPDATE SET subject_id=$5, teacher_id=$6, room=$8
       RETURNING *`,
      [school_id, class_id, day_of_week, slot_id,
       subject_id, teacher_id || null,
       level_type || 'primary', room || null]
    );

    // double period: also fill the next non-break slot
    if (is_double) {
      const nextSlot = await pool.query(
        `SELECT id FROM time_slots
         WHERE school_id = $1 AND level_type = $2
         AND is_break = false
         AND sort_order > (
           SELECT sort_order FROM time_slots WHERE id = $3
         )
         ORDER BY sort_order LIMIT 1`,
        [school_id, level_type || 'primary', slot_id]
      );
      if (nextSlot.rows[0]) {
        const nextId = nextSlot.rows[0].id;
        // skip if teacher conflict on next slot
        let canFill = true;
        if (teacher_id) {
          const c2 = await pool.query(
            `SELECT id FROM timetable
             WHERE teacher_id=$1 AND day_of_week=$2
             AND slot_id=$3 AND school_id=$4 AND class_id!=$5`,
            [teacher_id, day_of_week, nextId, school_id, class_id]
          );
          if (c2.rows.length > 0) canFill = false;
        }
        if (canFill) {
          await pool.query(
            `INSERT INTO timetable
              (school_id, class_id, day_of_week, slot_id,
               subject_id, teacher_id, level_type, room)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (class_id, day_of_week, slot_id)
             DO UPDATE SET subject_id=$5, teacher_id=$6, room=$8`,
            [school_id, class_id, day_of_week, nextId,
             subject_id, teacher_id || null,
             level_type || 'primary', room || null]
          );
        }
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSchoolDays = async (req, res) => {
  const school_id = req.school_id;
  try {
    const result = await pool.query(
      `SELECT DISTINCT day_of_week FROM timetable
       WHERE school_id = $1
       ORDER BY day_of_week`,
      [school_id]
    );
    res.json(result.rows.map(r => r.day_of_week));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSettings = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query;
  try {
    const result = await pool.query(
      `SELECT active_days FROM timetable_settings
       WHERE school_id = $1 AND level_type = $2`,
      [school_id, level || 'primary']
    );
    res.json({
      active_days: result.rows[0]?.active_days || [1, 2, 3, 4, 5],
    });
  } catch (err) {
    // table may not exist yet — return default
    res.json({ active_days: [1, 2, 3, 4, 5] });
  }
};

exports.saveSettings = async (req, res) => {
  const school_id = req.school_id;
  const { level, active_days } = req.body;
  try {
    await pool.query(
      `INSERT INTO timetable_settings (school_id, level_type, active_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id, level_type)
       DO UPDATE SET active_days = $3`,
      [school_id, level || 'primary', active_days]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.copyTimetable = async (req, res) => {
  const school_id = req.school_id;
  const { from_class_id, to_class_id } = req.body;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM timetable WHERE class_id=$1 AND school_id=$2`,
        [to_class_id, school_id]
      );
      await client.query(
        `INSERT INTO timetable
          (school_id, class_id, day_of_week, slot_id,
           subject_id, teacher_id, level_type, room)
         SELECT school_id, $1, day_of_week, slot_id,
                subject_id, teacher_id, level_type, room
         FROM timetable
         WHERE class_id=$2 AND school_id=$3`,
        [to_class_id, from_class_id, school_id]
      );
      await client.query('COMMIT');
      res.json({ message: 'Copied' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTeacherWorkload = async (req, res) => {
  const school_id = req.school_id;
  const { level } = req.query;
  try {
    const rows = await pool.query(
      `SELECT t.id, t.name as teacher_name,
              tt.day_of_week,
              COUNT(tt.id) as periods
       FROM teachers t
       LEFT JOIN timetable tt
         ON tt.teacher_id = t.id
         AND tt.school_id = $1
         ${level ? 'AND tt.level_type = $2' : ''}
       WHERE t.school_id = $1
       GROUP BY t.id, t.name, tt.day_of_week
       ORDER BY t.name, tt.day_of_week`,
      level ? [school_id, level] : [school_id]
    );

    const map = {};
    for (const row of rows.rows) {
      if (!map[row.id]) {
        map[row.id] = {
          teacher_id: row.id,
          teacher_name: row.teacher_name,
          total: 0,
          by_day: {},
        };
      }
      if (row.day_of_week !== null) {
        const n = parseInt(row.periods);
        map[row.id].by_day[row.day_of_week] = n;
        map[row.id].total += n;
      }
    }

    const workload = Object.values(map)
      .sort((a, b) => b.total - a.total);
    res.json(workload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
