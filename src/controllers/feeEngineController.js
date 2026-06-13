const pool = require('../config/db');

exports.getSnapshot = async (req, res) => {
    const { termId, grade } = req.query;
    const schoolId = req.user.school_id;

    try {
        const result = await pool.query(
            'SELECT fees FROM term_fee_snapshots WHERE school_id=$1 AND term_id=$2 AND grade=$3',
            [schoolId, termId, grade]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ message: "Snapshot not found" });

        res.json({ fees: result.rows[0].fees });
    } catch (err) {
        console.error('[getSnapshot]', err.message);
        res.status(500).json({ error: err.message });
    }
};
