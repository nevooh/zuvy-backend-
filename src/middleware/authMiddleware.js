const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  if (!token)
    return res.status(401).json({ success: false, message: "No token, authorization denied." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Normalize naming: expose both snake_case and camelCase so all controllers work
    // regardless of whether the token was issued before or after the naming fix.
    decoded.school_id  = decoded.school_id  ?? decoded.schoolId;
    decoded.teacher_id = decoded.teacher_id ?? decoded.teacherId;
    decoded.schoolId   = decoded.school_id;
    decoded.teacherId  = decoded.teacher_id;
    req.user       = decoded;
    req.school_id  = decoded.school_id;
    req.user_id    = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token is not valid." });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: "Access denied." });
  next();
};

// Require main admin level (for PIN reset, bank account edit, subscription page)
const requireAdminLevel = (level) => async (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  try {
    // Check the admin's role_level in admin_accounts table
    const db = require('../config/db');
    const result = await db.query(
      'SELECT role_level FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
      [req.user.id, req.school_id]
    );

    const adminRecord = result.rows[0];
    if (!adminRecord) {
      // Fallback: if no admin_accounts record yet, treat as main admin (backward compat)
      // This allows the original/director admin to work before they're added to admin_accounts
      if (level === 'main') {
        return next();
      }
      return res.status(403).json({ success: false, message: `Only ${level} admins can access this.` });
    }

    if (adminRecord.role_level !== level) {
      return res.status(403).json({ success: false, message: `Only ${level} admins can access this.` });
    }

    next();
  } catch (err) {
    console.error('REQUIRE_ADMIN_LEVEL_ERROR:', err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

module.exports = { protect, requireRole, requireAdminLevel };