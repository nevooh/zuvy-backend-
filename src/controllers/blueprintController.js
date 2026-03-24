const pool = require('../config/db');

exports.publishBlueprint = async (req, res) => {
    const { year, grade_name, system_type, data } = req.body;
    const school_id = req.user.school_id;

    try {
        await pool.query('BEGIN');

        // FIX: Deactivate previous plans even if year is NULL
        // We use "IS NOT DISTINCT FROM" so that NULL = NULL evaluates to true
        await pool.query(
            `UPDATE fee_blueprints 
             SET is_active = false 
             WHERE school_id = $1 AND grade_name = $2 AND year IS NOT DISTINCT FROM $3`,
            [school_id, grade_name, year]
        );

        // Versioning logic
        const countRes = await pool.query(
            `SELECT COUNT(*) FROM fee_blueprints WHERE school_id = $1 AND grade_name = $2`,
            [school_id, grade_name]
        );
        const version = `v${parseInt(countRes.rows[0].count) + 1}.0`;

        // Insert new active plan
        const result = await pool.query(
            `INSERT INTO fee_blueprints (school_id, year, grade_name, system_type, data, version, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
            [school_id, year, grade_name, system_type, JSON.stringify(data), version]
        );

        await pool.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Database error during publish" });
    }
};
exports.getHistoryByGrade = async (req, res) => {
    const { gradeName } = req.params;
    const school_id = req.user.school_id;

    console.log(`--- DEBUG START ---`);
    console.log(`Target Grade: ${gradeName}`);
    console.log(`School ID: ${school_id}`);

    try {
       // Simplified and clean
const result = await pool.query(
    `SELECT id, year, grade_name, system_type, data, version, is_active, created_at 
     FROM fee_blueprints 
     WHERE school_id = $1 
     AND LOWER(grade_name) = LOWER($2)
     ORDER BY created_at DESC`,
    [school_id, gradeName]
);
        console.log(`Rows Found: ${result.rows.length}`);
        if (result.rows.length > 0) {
            console.log(`Latest Version in DB: ${result.rows[0].version}`);
            console.log(`Is Latest Active?: ${result.rows[0].is_active}`);
        }
        console.log(`--- DEBUG END ---`);

        res.json(result.rows);
    } catch (err) {
        console.error("DB ERROR:", err);
        res.status(500).json({ error: "Error fetching history" });
    }
};
// Get only the snapshot for the active term for a specific grade
exports.getActiveTermSnapshot = async (req, res) => {
    const { gradeName, termName } = req.query; // e.g., ?gradeName=4&termName=Term 1
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(
            `SELECT 
                id, 
                version,
                data->$2 as term_fees -- This extracts ONLY the key "Term 1" from the JSON
             FROM fee_blueprints 
             WHERE school_id = $1 
               AND grade_name = $3 
               AND is_active = true 
             LIMIT 1`,
            [school_id, termName, gradeName]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No active blueprint found for this grade." });
        }

        // result.rows[0].term_fees will be just the fees for that term
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error fetching term snapshot" });
    }
};
exports.getGradeOptionals = async (req, res) => {
    const { gradeName } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(
            `SELECT data FROM fee_blueprints 
             WHERE school_id = $1 AND grade_name = $2 AND is_active = true 
             LIMIT 1`,
            [school_id, gradeName]
        );

        if (result.rows.length === 0) return res.json([]);

        const fullData = result.rows[0].data;
        const optionalSet = new Set(); // Use a Set to avoid duplicates (e.g., Library in Term 1 & 2)

        // 1. Loop through each term (Term 1, Term 2, etc.)
        Object.values(fullData).forEach(termData => {
            if (typeof termData === 'object') {
                // 2. Loop through each fee in that term
                Object.values(termData).forEach(fee => {
                    // 3. If it's not mandatory, add it to our list
                    if (fee.is_mandatory === false) {
                        // Trim to handle that "lunch " vs "lunch" space issue in your logs!
                        optionalSet.add(fee.name.trim().toUpperCase());
                    }
                });
            }
        });

        const finalOptionals = Array.from(optionalSet);
        console.log(`DEBUG: Extracted Optionals for ${gradeName}:`, finalOptionals);
        
        res.json(finalOptionals);
    } catch (err) {
        console.error("ERROR:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};