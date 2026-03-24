const pool = require('../config/db'); // ✅ Correct path to match your folder structure

// 🚀 CREATE TEACHER
exports.createTeacher = async (req, res) => {
    try {
        // We get school_id from the authMiddleware (decoded token)
        const school_id = req.user.school_id; 
        const { full_name, phone_number, email } = req.body;

        const newTeacher = await pool.query(
            `INSERT INTO teachers (school_id, full_name, phone_number, email) 
             VALUES($1, $2, $3, $4) 
             RETURNING *`,
            [school_id, full_name, phone_number, email]
        );

        res.status(201).json(newTeacher.rows[0]);
    } catch (err) {
        console.error(err.message);
        // Handle duplicate phone/email
        if (err.code === '23505') {
            return res.status(400).json({ error: "Phone number or Email already exists" });
        }
        res.status(500).json({ error: "Server error creating teacher" });
    }
};

// 🚀 GET ALL TEACHERS (For the logged-in school only)
exports.getTeachers = async (req, res) => {
    try {
        const school_id = req.user.school_id;
        const teachers = await pool.query(
            "SELECT * FROM teachers WHERE school_id = $1 ORDER BY full_name ASC",
            [school_id]
        );
        res.json(teachers.rows);
    } catch (err) {
        res.status(500).json({ error: "Server error fetching teachers" });
    }
};

// 🚀 ASSIGN TEACHER TO CLASS/SUBJECT (The "Later" Work)
exports.assignTeacher = async (req, res) => {
    try {
        const school_id = req.user.school_id;
        const { teacher_id, subject_id, class_id, term_id } = req.body;

        const assignment = await pool.query(
            `INSERT INTO teacher_assignments (school_id, teacher_id, subject_id, class_id, term_id) 
             VALUES($1, $2, $3, $4, $5) 
             RETURNING *`,
            [school_id, teacher_id, subject_id, class_id, term_id]
        );

        res.status(201).json(assignment.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Failed to assign teacher" });
    }
};