const pool = require('../config/db'); // Your DB connection

exports.getSnapshot = async (req, res) => {
    const { termId, grade } = req.query;
    const schoolId = req.user.school_id;

    console.log("--- DEBUG START ---");
    console.log("Looking for Snapshot with:", { schoolId, termId, grade });

    try {
        const result = await pool.query(
            'SELECT fees FROM term_fee_snapshots WHERE school_id = $1 AND term_id = $2 AND grade = $3',
            [schoolId, termId, grade]
        );

        // Debug: See the raw row count
        console.log("Rows found:", result.rows.length);

        if (result.rows.length === 0) {
            console.log("Result: No snapshot matches those IDs.");
            console.log("--- DEBUG END ---");
            return res.status(404).json({ message: "Snapshot not found" });
        }

        // Debug: This is the most important part
        const feesData = result.rows[0].fees;
        console.log("Data Type of Fees:", typeof feesData);
        console.log("Raw Fees Content:", JSON.stringify(feesData, null, 2));
        console.log("--- DEBUG END ---");

        res.json({ fees: feesData });
    } catch (err) {
        console.error("DEBUG ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
};

