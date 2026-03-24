const { pool } = require('../config/db');

// Get all exams for a school
exports.getExams = async (req, res) => {
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(`
            SELECT e.id, e.exam_name, e.term_id, e.max_marks, e.created_at, t.term_name
            FROM exams e
            LEFT JOIN academic_terms t ON e.term_id = t.id
            WHERE e.school_id = $1
            ORDER BY e.created_at DESC
        `, [school_id]);

        res.status(200).json(result.rows);

    } catch (err) {
        console.error("getExams Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// Create a new exam
exports.createExam = async (req, res) => {
    const school_id = req.user.school_id;
    const { exam_name, term_id, max_marks } = req.body;

    try {
        const result = await pool.query(`
            INSERT INTO exams (school_id, exam_name, term_id, max_marks)
            VALUES ($1, $2, $3, $4)
            RETURNING id, exam_name, term_id, max_marks, created_at
        `, [school_id, exam_name, term_id, max_marks]);

        res.status(201).json(result.rows[0]);

    } catch (err) {
        console.error("createExam Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};