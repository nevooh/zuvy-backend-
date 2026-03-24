const db = require('../config/db');

// --- CREATE ---
exports.createClass = async (req, res) => {
    const { class_name, stream_name, teacher_name } = req.body;
    const school_id = req.user.school_id;
    try {
        const result = await db.query(
            'INSERT INTO classes (school_id, class_name, stream_name, teacher_name) VALUES ($1, $2, $3, $4) RETURNING *',
            [school_id, class_name, stream_name, teacher_name]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- READ (ALL) ---
exports.getAllClasses = async (req, res) => {

    const school_id = req.user.school_id;

    try {

        const result = await db.query('SELECT * FROM classes WHERE school_id = $1 ORDER BY class_name ASC', [school_id]);

        res.json(result.rows);

    } catch (err) {

        res.status(500).json({ error: err.message });

    }

};
// --- UPDATE ---
exports.updateClass = async (req, res) => {
    const { id } = req.params; // The Class UUID
    const { class_name, stream_name, teacher_name } = req.body;
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            `UPDATE classes 
             SET class_name = $1, stream_name = $2, teacher_name = $3 
             WHERE id = $4 AND school_id = $5 RETURNING *`,
            [class_name, stream_name, teacher_name, id, school_id]
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
            'DELETE FROM classes WHERE id = $1 AND school_id = $2 RETURNING *', 
            [id, school_id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Class not found" });
        res.json({ message: "Class deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// Get all students in a specific class
exports.getClassStudents = async (req, res) => {
    const { id } = req.params; // Class ID
    const school_id = req.user.school_id;

    try {
        const result = await db.query(
            'SELECT * FROM students WHERE class_id = $1 AND school_id = $2',
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
exports.promoteAllStudents = async (req, res) => {
  const school_id = req.user.school_id;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN'); // start transaction

    // 1️⃣ Get all classes for this school
    const classesResult = await client.query(
      `SELECT * FROM public.classes WHERE school_id = $1 ORDER BY level_order DESC`,
      [school_id]
    );
    const classes = classesResult.rows;

    if (classes.length === 0) {
      await client.query('ROLLBACK'); // cancel if nothing found
      return res.status(400).json({ error: "No classes found" });
    }

    const maxLevel = Math.max(...classes.map(c => c.level_order || 0));

    for (let cls of classes) {
      if (cls.level_order === maxLevel) {
        // Move students to alumni
        await client.query(
          `INSERT INTO public.alumni (school_id, student_name, admission_number, last_class_name, graduation_year)
           SELECT s.school_id, s.full_name, s.admission_number, c.class_name, EXTRACT(YEAR FROM CURRENT_TIMESTAMP)
           FROM public.students s JOIN public.classes c ON s.class_id = c.id
           WHERE s.class_id = $1`,
          [cls.id]
        );

        // Delete students & class
        await client.query(`DELETE FROM public.students WHERE class_id = $1`, [cls.id]);
        await client.query(`DELETE FROM public.classes WHERE id = $1`, [cls.id]);

      } else {
        const nextLevel = cls.level_order + 1;
        let newName;

        if (cls.class_name.toLowerCase().includes('pp1')) newName = 'pp2';
        else if (cls.class_name.toLowerCase().includes('pp2')) newName = 'grade 1';
        else if (cls.class_name.toLowerCase().startsWith('grade')) {
          const currentNum = parseInt(cls.class_name.replace(/[^0-9]/g, '')) || 0;
          newName = `grade ${currentNum + 1}`;
        } else {
          newName = `Level ${nextLevel}`;
        }

        await client.query(
          `UPDATE public.classes 
           SET class_name = $1, level_order = $2 
           WHERE id = $3`,
          [newName, nextLevel, cls.id]
        );
      }
    }

    await client.query('COMMIT'); // commit everything at once
    return res.json({ message: "Promotion successful! Classes upgraded." });

  } catch (err) {
    await client.query('ROLLBACK'); // undo everything if anything fails
    console.error(err);
    return res.status(500).json({ error: err.message });

  } finally {
    client.release(); // release DB client
  }
};
// --- DELETE BY CLASS NAME ---
exports.deleteClassByName = async (req, res) => {
  const { class_name } = req.query; // query param
  const school_id = req.user.school_id;

  if (!class_name) {
    return res.status(400).json({ error: "class_name is required" });
  }

  try {
    // Try to delete the class (the trigger will block it if students exist)
    const result = await db.query(
      'DELETE FROM classes WHERE class_name = $1 AND school_id = $2 RETURNING *',
      [class_name, school_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No classes found with that name" });
    }

    res.json({ message: `Deleted ${result.rows.length} streams in ${class_name}` });
  } catch (err) {
    console.error(err);

    // Check for trigger exception code
    if (err.code === 'P0001') { // Raised by RAISE EXCEPTION in trigger
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
            // Use INSERT with ON CONFLICT so we don't assign the same teacher twice to one class
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
             WHERE ta.teacher_id = $1 AND ta.school_id = $2`,
            [teacherId, school_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};