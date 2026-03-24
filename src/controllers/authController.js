const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Find user by email
        const userQuery = await db.query(
            `SELECT u.*, s.is_active AS school_active
             FROM users u
             LEFT JOIN schools s ON u.school_id = s.id
             WHERE u.email = $1`,
            [email]
        );
        const user = userQuery.rows[0];

        if (!user) {
            return res.status(401).json({ message: "Incorrect email or password" });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Incorrect email or password" });
        }

        // ✅ Check if the school is active
        if (!user.school_active) {
            return res.status(403).json({ message: "School is inactive. Access denied." });
        }

        // Create JWT
        const token = jwt.sign(
            { id: user.id, school_id: user.school_id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: {
                name: user.full_name,
                role: user.role,
                school_id: user.school_id
            }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
