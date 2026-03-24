const { pool } = require('../config/db'); // Ensure this import matches your project

exports.getTermExpenses = async (req, res) => {
    const { term_id } = req.params;
    const school_id = req.user?.school_id; // Added ? check

    console.log("DEBUG: Fetching expenses for term:", term_id, "School:", school_id);

    try {
        // Change 'category' to 'description'
const query = `
    SELECT description, SUM(amount) as total_category_expense, COUNT(*) as entry_count
    FROM expenses 
    WHERE term_id = $1 AND school_id = $2
    GROUP BY description
    ORDER BY total_category_expense DESC;
`;
        const result = await pool.query(query, [term_id, school_id]);
        res.json(result.rows);
    } catch (err) {
        console.error("SQL CRASH:", err); // THIS WILL SHOW THE REAL ERROR
        res.status(500).json({ error: err.message });
    }
};

exports.addExpense = async (req, res) => {
    const { term_id, amount, description } = req.body;
    const school_id = req.user.school_id;

    try {
        // SECURITY: Verify term is active
        const term = await pool.query(
            'SELECT is_active FROM academic_terms WHERE id = $1 AND school_id = $2',
            [term_id, school_id]
        );

        if (term.rows.length === 0 || !term.rows[0].is_active) {
            return res.status(403).json({ error: "Operation not allowed: Term is locked/archived." });
        }

        await pool.query(
            'INSERT INTO expenses (school_id, term_id, amount, description) VALUES ($1, $2, $3, $4)',
            [school_id, term_id, amount, description]
        );
        res.status(201).json({ message: "Expense added!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getAllTerms = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        const query = `
            SELECT id, name, year, is_active 
            FROM academic_terms 
            WHERE school_id = $1 
            AND (is_active = true OR is_locked = true)
            ORDER BY start_date DESC;
        `;
        const result = await pool.query(query, [school_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};