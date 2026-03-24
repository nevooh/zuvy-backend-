const pool = require('../config/db');

exports.syncStudentOptionals = async (req, res) => {
    const { student_id, selected_codes } = req.body;

    console.log(`DEBUG: Syncing Student: ${student_id}, Codes:`, selected_codes);

    if (!student_id) {
        return res.status(400).json({ error: "Missing student_id" });
    }

    try {
        // Start transaction
        await pool.query('BEGIN');

        // 1. Wipe current selections
        await pool.query(
            'DELETE FROM student_optionals WHERE student_id = $1',
            [student_id]
        );

        // 2. Insert new selections safely using unnest
        if (selected_codes && Array.isArray(selected_codes) && selected_codes.length > 0) {
            await pool.query(
                `INSERT INTO student_optionals (student_id, fee_code) 
                 SELECT $1, unnest($2::text[])`,
                [student_id, selected_codes]
            );
        }

        await pool.query('COMMIT');
        console.log("DEBUG: Sync Complete for", student_id);
        res.status(200).json({ message: "Selections synced successfully" });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("DEBUG ERROR during sync:", err.message);
        res.status(500).json({ error: "Failed to sync optionals", details: err.message });
    }
};

exports.getStudentSelections = async (req, res) => {
    const { studentId } = req.params; 

    try {
        const result = await pool.query(
            'SELECT fee_code FROM student_optionals WHERE student_id = $1',
            [studentId]
        );
        
        const codes = result.rows.map(row => row.fee_code);
        console.log(`DEBUG: Found ${codes.length} saved services for student ${studentId}`);
        res.json(codes);
    } catch (err) {
        console.error("DEBUG ERROR during fetch:", err.message);
        res.status(500).json({ error: "Error fetching student selections" });
    }
};