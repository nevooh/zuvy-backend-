const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Master Admin creates a School + School Admin
 */
exports.createSchoolWithAdmin = async (req, res) => {
    const { school_name, school_email, admin_name, admin_email } = req.body;

    try {
        // 1️⃣ Start a DB transaction
        await db.pool.query('BEGIN');

        // 2️⃣ Create the school
        const schoolResult = await db.query(
            `INSERT INTO schools (name, email)
             VALUES ($1, $2)
             RETURNING id`,
            [school_name, school_email]
        );

        const schoolId = schoolResult.rows[0].id;

        // 3️⃣ Auto-generate admin PIN/password
        const rawPassword = crypto.randomBytes(4).toString('hex'); // 8 chars
        const hashedPassword = await bcrypt.hash(rawPassword, 10);

        // 4️⃣ Create school admin
        await db.query(
            `INSERT INTO users (school_id, full_name, email, password, role)
             VALUES ($1, $2, $3, $4, 'ADMIN')`,
            [schoolId, admin_name, admin_email, hashedPassword]
        );

        // 5️⃣ Commit transaction
        await db.pool.query('COMMIT');

        res.status(201).json({
            message: 'School and admin created successfully',
            admin_login_password: rawPassword // send ONCE
        });

    } catch (err) {
        // Rollback if anything fails
        await db.pool.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
};
// Corrected getAllSchools in masterSchoolController.js
exports.getAllSchools = async (req, res) => {
    try {
        // 1️⃣ Run the query - we store it in 'result'
        const result = await db.query(
            `SELECT id, name, email, is_active, created_at 
             FROM schools 
             ORDER BY created_at DESC`
        );

        // 2️⃣ Send 'result.rows' (NOT snapshot.rows)
        res.json(result.rows); 
        
    } catch (err) {
        console.error("DB Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};// Toggle school status (Active/Inactive)
exports.toggleSchoolStatus = async (req, res) => {
    const { id } = req.params;
    try {
        // This SQL flips the boolean: if true becomes false, if false becomes true
        const result = await db.query(
            'UPDATE schools SET is_active = NOT is_active WHERE id = $1 RETURNING is_active',
            [id]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "School not found" });
        }

        res.json({ message: "Status updated", is_active: result.rows[0].is_active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};