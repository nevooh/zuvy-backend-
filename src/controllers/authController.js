const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// POST /api/auth/reset-pin  (requires valid JWT — obtained via OTP login)
exports.resetPin = async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.toString().length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  }
  try {
    const hashed = await bcrypt.hash(pin.toString(), 10);
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res, next) => {
   const { email, password } = req.body;

   if (!email || !password) {
     return res.status(400).json({ message: 'Email and password are required.' });
   }

   try {
     const userQuery = await db.query(
       `SELECT u.*, s.is_active AS school_active
        FROM users u
        LEFT JOIN schools s ON u.school_id = s.id
        WHERE u.email = $1`,
       [email.trim().toLowerCase()]
     );
     const user = userQuery.rows[0];

     if (!user) {
       return res.status(401).json({ message: 'Incorrect email or password' });
     }

     const isMatch = await bcrypt.compare(password, user.password);
     if (!isMatch) {
       return res.status(401).json({ message: 'Incorrect email or password' });
     }

     if (!user.school_active) {
       return res.status(403).json({ message: 'School is inactive. Access denied.' });
     }

     const token = jwt.sign(
       { id: user.id, school_id: user.school_id, role: user.role },
       process.env.JWT_SECRET,
       { expiresIn: '7d' }
     );

     if (user.school_id) {
       db.query(
         'UPDATE schools SET last_login_at = NOW() WHERE id = $1',
         [user.school_id]
       ).catch(() => {});
     }

     res.json({
       token,
       user: {
         name:      user.full_name,
         role:      user.role,
         school_id: user.school_id,
       },
     });

   } catch (err) {
     next(err);
   }
};

// GET /api/auth/me — return authenticated user with admin role level
exports.getAuthenticatedUser = async (req, res) => {
  try {
    const adminRecord = await db.query(
      'SELECT role_level FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
      [req.user.id, req.school_id]
    );

    const roleLevel = adminRecord.rows[0]?.role_level ?? 'main';

    res.json({
      message: 'Authenticated ✅',
      user: {
        ...req.user,
        admin_role_level: roleLevel
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};
