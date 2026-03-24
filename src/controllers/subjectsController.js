const { pool } = require('../config/db');

// Get all subjects for a school (with all new fields)
exports.getSubjects = async (req, res) => {
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(`
            SELECT id, subject_name, short_name, subject_code, department, is_optional, created_at
            FROM subjects
            WHERE school_id = $1
            ORDER BY department, subject_name
        `, [school_id]);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error("getSubjects Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// Create a new subject with full metadata
exports.createSubject = async (req, res) => {
    const school_id = req.user.school_id;
    const { subject_name, short_name, subject_code, department, is_optional } = req.body;

    try {
        const result = await pool.query(`
            INSERT INTO subjects (school_id, subject_name, short_name, subject_code, department, is_optional)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [school_id, subject_name, short_name, subject_code, department, is_optional || false]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("createSubject Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// LINK Subject to Multiple Classes (Bulk Insert)
exports.linkSubjectToClasses = async (req, res) => {
    const school_id = req.user.school_id;
    const { subject_id, class_ids } = req.body; // Expects an array of class_ids

    try {
        // We use a Promise.all or a single unnest query for performance
        const query = `
            INSERT INTO class_subjects (school_id, subject_id, class_id)
            SELECT $1, $2, unnest($3::uuid[])
            ON CONFLICT (class_id, subject_id) DO NOTHING
            RETURNING *;
        `;
        
        const result = await pool.query(query, [school_id, subject_id, class_ids]);
        res.status(200).json({ message: "Classes linked successfully", count: result.rowCount });
    } catch (err) {
        console.error("linkSubjectToClasses Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};
// FETCH existing links for a specific subject
exports.getSubjectLinks = async (req, res) => {
    const { id } = req.params; // Get subject ID from the URL
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(`
            SELECT class_id 
            FROM class_subjects 
            WHERE subject_id = $1 AND school_id = $2
        `, [id, school_id]);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error("getSubjectLinks Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};