const { pool } = require('../config/db');

exports.getStudentIdentity = async (req, res) => {
    const { id } = req.params;
    // We don't rely on req.user.school_id if it's undefined for parents
    
    console.log("🔍 FETCHING FOR STUDENT ID:", id);

    try {
        const student = await pool.query(`
            SELECT 
                s.full_name, 
                s.admission_number, 
                s.grade_level, 
                s.gender, 
                s.date_of_birth, 
                s.parent_name, 
                s.parent_phone, 
                s.status,
                c.class_name 
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.id = $1
        `, [id]);

        if (student.rows.length === 0) {
            console.log("❌ STUDENT NOT FOUND IN DB");
            return res.status(404).json({ error: "Student record not found" });
        }

        console.log("✅ FOUND:", student.rows[0].full_name);
        res.status(200).json(student.rows[0]);
    } catch (err) {
        console.error("Identity Fetch Error:", err.message);
        res.status(500).json({ error: "Server error" });
    }
};