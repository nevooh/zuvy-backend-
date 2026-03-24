const { pool } = require('../config/db');
/**
 * 1. ADMIT STUDENT (Clean Version)
 * Only handles student registration without the fees logic for now.
 */
exports.admitStudent = async (req, res) => {
    const {
        full_name, admission_number, grade_level, class_id,
        date_of_birth, gender, parent_name, parent_phone,
        emergency_contact_name, emergency_contact_phone
    } = req.body;
    // Using school_id from your middleware/tenant guard
    const school_id = req.user.school_id;
    // Ensure empty strings don't break the DATE column in Postgres
    const sanitizedDOB = date_of_birth === "" || !date_of_birth ? null : date_of_birth;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Insert the Student into the current schema
       // Insert the Student into the current schema
        const studentResult = await client.query(
            `INSERT INTO students (
                school_id, full_name, admission_number, class_id, grade_level,
                date_of_birth, gender, parent_name, parent_phone,
                emergency_contact_name, emergency_contact_phone
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, // Added $12 here
            [
                school_id, full_name, admission_number, class_id, grade_level,
                sanitizedDOB, gender, parent_name, parent_phone,
                emergency_contact_name, emergency_contact_phone // feesArray is now $12
            ]
        );
        await client.query('COMMIT');
        // Return the newly created student object
        res.status(201).json(studentResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        // Handle duplicate admission numbers (Postgres Unique Constraint Error)
        if (err.code === '23505') {
            return res.status(400).json({ message: "Admission number already exists in this school." });
        }
        console.error("Admit Student Error:", err.message);
        res.status(500).json({ error: "Internal server error during admission." });
    } finally {
        client.release();
    }
};
exports.getAllStudents = async (req, res) => {
  const school_id = req.user.school_id;
  const activeTermId = (req.query.term_id === "" || !req.query.term_id) ? null : req.query.term_id; 

  try {
    const result = await pool.query(
      `SELECT 
        s.id, 
        s.full_name, 
        s.admission_number, 
        s.grade_level,
        s.status,
        s.date_of_birth,           -- ADDED
    s.gender,                  -- ADDED
    s.parent_name,             -- ADDED
    s.parent_phone,            -- ADDED
    s.emergency_contact_name,  -- ADDED
    s.emergency_contact_phone, -- ADDED
    s.class_id,                -- ADDED
        -- The amount they were billed for THIS specific term
        COALESCE(inv.total_amount, 0) AS total_liability,
        
        -- The amount paid ONLY for this specific term
        COALESCE((
          SELECT SUM(amount_paid) 
          FROM payments 
          WHERE student_id = s.id AND term_id = inv.term_id
        ), 0) AS total_paid,

        -- The balance specifically for this term (Billed - Paid)
        -- This will correctly show Ous Mutua's -4905 if his invoice balance was set that way
        COALESCE(inv.balance, 0) AS balance,
        
        inv.term_name
        
       FROM students s
       /* ... inside your pool.query ... */
       LEFT JOIN LATERAL (
         SELECT i.total_amount, i.balance, i.term_id, t.name as term_name
         FROM student_invoices i
         JOIN academic_terms t ON i.term_id = t.id
         WHERE i.student_id = s.id
         AND (i.term_id = $1 OR $1 IS NULL)
         
         -- THE NEW HIERARCHY:
         ORDER BY 
           t.is_active DESC,    -- 1. If a term is currently active, it's the priority.
           t.year DESC,         -- 2. If none are active, the most recent year (2026) wins.
           t.start_date DESC    -- 3. The latest term within that year (Term 2) wins.
         LIMIT 1
       ) inv ON true
/* ... the rest of your query remains the same ... */
       
       WHERE s.school_id = $2 AND s.status = 'ACTIVE'
       ORDER BY s.created_at DESC`,
      [activeTermId, school_id]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch Students Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 3. UPDATE STUDENT
 */
exports.updateStudent = async (req, res) => {
    const { id } = req.params;
    const school_id = req.user.school_id;

    const {
        full_name,
        admission_number,
        class_id, // We use this to find the correct grade_level
        parent_name = '',
        parent_phone = '',
        emergency_contact_name = '',
        emergency_contact_phone = ''
    } = req.body;

    try {
        // 1. Fetch the actual class name from the classes table
        // This ensures the student's 'grade_level' stays synced with the class they belong to.
        const classResult = await pool.query(
            "SELECT class_name FROM classes WHERE id = $1 AND school_id = $2",
            [class_id, school_id]
        );

        if (classResult.rows.length === 0) {
            return res.status(400).json({ message: "Selected class does not exist." });
        }

        const grade_level = classResult.rows[0].class_name;

        // 2. Perform the update
        const result = await pool.query(
            `UPDATE students
             SET full_name = $1, 
                 admission_number = $2, 
                 grade_level = $3, 
                 class_id = $4,
                 parent_name = $5, 
                 parent_phone = $6,
                 emergency_contact_name = $7, 
                 emergency_contact_phone = $8
             WHERE id = $9 AND school_id = $10
             RETURNING *`,
            [
                full_name, 
                admission_number, 
                grade_level,      // Derived from the actual class table
                class_id,         
                parent_name,      
                parent_phone,     
                emergency_contact_name,  
                emergency_contact_phone, 
                id,               
                school_id         
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Student not found or unauthorized" });
        }

        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("Update Error:", err.message);
        // Handle duplicate admission numbers
        if (err.code === '23505') {
            return res.status(400).json({ error: "Admission number already exists." });
        }
        res.status(500).json({ error: "Internal server error" });
    }
};
/**
 * 4. DELETE STUDENT
 */
exports.deleteStudent = async (req, res) => {
    const { id } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(
            'DELETE FROM students WHERE id = $1 AND school_id = $2 RETURNING *',
            [id, school_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Student not found or unauthorized" });
        }

        res.status(200).json({ message: "Student deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}; // <--- MAKE SURE THIS BRACE IS CLOSED
exports.updateStudentStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; 
    const school_id = req.user.school_id;

    // --- DEBUG LOGS ---
    console.log("-----------------------------------------");
    console.log("🚀 STATUS UPDATE TRIGGERED");
    console.log("ID from URL:", id);
    console.log("Status from Flutter:", status);
    console.log("School ID from Token:", school_id);
    console.log("-----------------------------------------");

    try {
        const result = await pool.query(
            `UPDATE students SET status = $1 WHERE id = $2 AND school_id = $3 RETURNING *`,
            [status, id, school_id]
        );
        
        if (result.rows.length === 0) {
            console.log("❌ UPDATE FAILED: No student found with that ID in your school.");
            return res.status(404).json({ message: "Fail" });
        }

        console.log("✅ SUCCESS! Database now shows:", result.rows[0].status);
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("🔥 DATABASE ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
};