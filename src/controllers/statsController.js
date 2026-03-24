const { pool } = require('../config/db');

exports.getDashboardStats = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM students WHERE school_id = $1 AND status = 'ACTIVE') as active_students,
                (SELECT COUNT(*) FROM classes WHERE school_id = $1) as total_classes,
                (SELECT COUNT(*) FROM students WHERE school_id = $1 AND gender ILIKE 'Male' AND status = 'ACTIVE') as male_students,
                (SELECT COUNT(*) FROM students WHERE school_id = $1 AND gender ILIKE 'Female' AND status = 'ACTIVE') as female_students
        `, [school_id]);

        const recentStudents = await pool.query(`
            SELECT full_name, admission_number, created_at 
            FROM students 
            WHERE school_id = $1 
            ORDER BY created_at DESC 
            LIMIT 5
        `, [school_id]);

        res.status(200).json({
            summary: stats.rows[0] || {
                active_students: 0,
                total_classes: 0,
                male_students: 0,
                female_students: 0
            },
            recentStudents: recentStudents.rows || []
        });
    } catch (err) {
        console.error("Dashboard Stats Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};