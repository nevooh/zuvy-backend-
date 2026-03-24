const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await db.query(
            'SELECT * FROM master_admins WHERE email = $1 AND is_active = true',
            [email]
        );

        const admin = result.rows[0];

        if (!admin) {
            return res.status(401).json({ message: 'Access denied' });
        }

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Access denied' });
        }

        const token = jwt.sign(
            { id: admin.id, role: 'MASTER_ADMIN' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            admin: {
                name: admin.full_name,
                role: 'MASTER_ADMIN'
            }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
