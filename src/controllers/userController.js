const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Create Student
exports.createStudent = async (req, res) => {
    const { full_name, email, password, class_id, guardian_name, guardian_contact } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ message: 'Full name, email, and password are required' });
    }

    try {
        // Check if email exists
        const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        // Hash password
        const hashedPassword = bcrypt.hashSync(password, 10);

        // Insert into users table
        const newUser = await db.query(
            'INSERT INTO users (school_id, full_name, email, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [req.user.school_id, full_name, email, hashedPassword, 'student']
        );

        const userId = newUser.rows[0].id;

        // Insert into students table
        await db.query(
            'INSERT INTO students (user_id, class_id, guardian_name, guardian_contact) VALUES ($1, $2, $3, $4)',
            [userId, class_id || null, guardian_name || null, guardian_contact || null]
        );

        res.status(201).json({ message: 'Student created successfully', student_id: userId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};
exports.createTeacher = async (req, res) => {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    try {
        // Check email
        const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const newTeacher = await db.query(
            'INSERT INTO users (school_id, full_name, email, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role',
            [req.user.school_id, full_name, email, hashedPassword, 'teacher']
        );

        res.status(201).json({ message: 'Teacher created successfully', teacher: newTeacher.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};
