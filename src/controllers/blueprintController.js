const pool = require('../config/db');

exports.publishBlueprint = async (req, res) => {
    const { year, grade_name, system_type, data } = req.body;
    const school_id = req.user.school_id;

    try {
        await pool.query('BEGIN');

        await pool.query(
            `UPDATE fee_blueprints
             SET is_active = false
             WHERE school_id = $1 AND grade_name = $2 AND year IS NOT DISTINCT FROM $3`,
            [school_id, grade_name, year]
        );

        const countRes = await pool.query(
            `SELECT COUNT(*) FROM fee_blueprints WHERE school_id = $1 AND grade_name = $2`,
            [school_id, grade_name]
        );
        const version = `v${parseInt(countRes.rows[0].count) + 1}.0`;

        const result = await pool.query(
            `INSERT INTO fee_blueprints (school_id, year, grade_name, system_type, data, version, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
            [school_id, year, grade_name, system_type, JSON.stringify(data), version]
        );

        await pool.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('[publishBlueprint]', err.message);
        res.status(500).json({ error: "Database error during publish" });
    }
};

exports.getHistoryByGrade = async (req, res) => {
    const { gradeName } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(
            `SELECT id, year, grade_name, system_type, data, version, is_active, created_at
             FROM fee_blueprints
             WHERE school_id = $1 AND LOWER(grade_name) = LOWER($2)
             ORDER BY created_at DESC`,
            [school_id, gradeName]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[getHistoryByGrade]', err.message);
        res.status(500).json({ error: "Error fetching history" });
    }
};

exports.getActiveTermSnapshot = async (req, res) => {
    const { gradeName, termName } = req.query;
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(
            `SELECT id, version, data->$2 AS term_fees
             FROM fee_blueprints
             WHERE school_id=$1 AND grade_name=$3 AND is_active=true
             LIMIT 1`,
            [school_id, termName, gradeName]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ error: "No active blueprint found for this grade." });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[getActiveTermSnapshot]', err.message);
        res.status(500).json({ error: "Error fetching term snapshot" });
    }
};

exports.getGradeOptionals = async (req, res) => {
    const { gradeName } = req.params;
    const school_id = req.user.school_id;

    try {
        const result = await pool.query(
            `SELECT data FROM fee_blueprints
             WHERE school_id=$1 AND grade_name=$2 AND is_active=true
             LIMIT 1`,
            [school_id, gradeName]
        );

        if (result.rows.length === 0) return res.json([]);

        const fullData = result.rows[0].data;
        const optionalSet = new Set();

        Object.values(fullData).forEach(termData => {
            if (typeof termData === 'object') {
                Object.values(termData).forEach(fee => {
                    if (fee.is_mandatory === false)
                        optionalSet.add(fee.name.trim().toUpperCase());
                });
            }
        });

        res.json(Array.from(optionalSet));
    } catch (err) {
        console.error('[getGradeOptionals]', err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
