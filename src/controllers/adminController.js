const db = require('../config/db');
const bcrypt = require('bcryptjs');


exports.updateAdminProfile = async (req, res) => {
    // 🛡️ THE FIX: Your token uses 'id', so we extract 'id' and rename it to 'userId'
    const { id: userId, school_id, role } = req.user; 
    const { new_name, new_password, old_password } = req.body;

    try {
        // 1️⃣ Validation: Check if anything was even sent
        if (!new_name && !new_password) {
            return res.status(400).json({ message: "No changes provided to update." });
        }

        // 2️⃣ Security Check: Ensure only an ADMIN is hitting this
        if (role !== 'ADMIN') {
            return res.status(403).json({ message: "Access denied. Admins only." });
        }

        let updates = [];
        let params = [];
        let count = 1;

        // 3️⃣ Password Logic: Verify current PIN before allowing a new one
        if (new_password) {
            if (!old_password) {
                return res.status(400).json({ message: "Your current PIN is required to set a new one." });
            }

            // Fetch the current hashed password from the database
            const userRes = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
            
            if (userRes.rowCount === 0) {
                return res.status(404).json({ message: "Admin account not found." });
            }

            const isMatch = await bcrypt.compare(old_password, userRes.rows[0].password);
            if (!isMatch) {
                return res.status(401).json({ message: "The current PIN you entered is incorrect." });
            }

            // Hash the NEW PIN
            const hashed = await bcrypt.hash(new_password, 10);
            updates.push(`password = $${count}`);
            params.push(hashed);
            count++;
        }

        // 4️⃣ Name Logic
        if (new_name) {
            updates.push(`full_name = $${count}`);
            params.push(new_name);
            count++;
        }

        // 5️⃣ Final Query Construction
        // We use .join(', ') so the SQL syntax is always perfect (no trailing commas)
        let query = `UPDATE users SET ${updates.join(', ')}`;
        
        // Add the strict WHERE clause to ensure the admin only updates themselves
        query += ` WHERE id = $${count} AND school_id = $${count + 1} AND role = 'ADMIN'`;
        params.push(userId, school_id);

        const result = await db.query(query, params);

        if (result.rowCount === 0) {
            return res.status(403).json({ message: "Update failed. You may not have permission to modify this account." });
        }

        res.json({ 
            success: true, 
            message: "Profile updated successfully! 🚀" 
        });

    } catch (err) {
        console.error("ADMIN_UPDATE_ERROR:", err.message);
        res.status(500).json({ error: "A server error occurred while updating your profile." });
    }
};

// ────── Sub-Admin Management Endpoints ──────────

// GET /api/admin/sub-admins — List all sub-admins for this school (main admin only)
exports.listSubAdmins = async (req, res) => {
    const { id: userId, school_id, role } = req.user;

    try {
        if (role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        // Verify user is a main admin
        const adminCheck = await db.query(
            'SELECT role_level FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
            [userId, school_id]
        );

        const adminRecord = adminCheck.rows[0];
        if (adminRecord && adminRecord.role_level !== 'main') {
            return res.status(403).json({ success: false, message: "Only main admins can view sub-admins." });
        }

        // Get all sub-admins and their user details
        const result = await db.query(
            `SELECT 
               u.id, u.full_name, u.email, 
               aa.role_level, aa.is_active, aa.created_at, aa.created_by
             FROM users u
             JOIN admin_accounts aa ON u.id = aa.user_id
             WHERE aa.school_id = $1 AND aa.role_level = 'sub'
             ORDER BY aa.created_at DESC`,
            [school_id]
        );

        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error("LIST_SUB_ADMINS_ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/admin/create-sub-admin — Create a new sub-admin (main admin only)
exports.createSubAdmin = async (req, res) => {
    const { id: userId, school_id, role } = req.user;
    const { email, full_name, password } = req.body;

    try {
        if (role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        // Verify user is a main admin
        const adminCheck = await db.query(
            'SELECT role_level FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
            [userId, school_id]
        );

        const adminRecord = adminCheck.rows[0];
        if (adminRecord && adminRecord.role_level !== 'main') {
            return res.status(403).json({ success: false, message: "Only main admins can create sub-admins." });
        }

        if (!email || !full_name || !password) {
            return res.status(400).json({ success: false, message: "Email, name, and password are required." });
        }

        // Check if email already exists
        const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (existingUser.rowCount > 0) {
            return res.status(400).json({ success: false, message: "Email already exists." });
        }

        // Create user account
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUserRes = await db.query(
            `INSERT INTO users (email, full_name, password, school_id, role, phone)
             VALUES ($1, $2, $3, $4, 'ADMIN', '')
             RETURNING id`,
            [email.toLowerCase().trim(), full_name, hashedPassword, school_id]
        );

        const newUserId = newUserRes.rows[0].id;

        // Create admin account record
        await db.query(
            `INSERT INTO admin_accounts (user_id, school_id, role_level, is_active, created_by)
             VALUES ($1, $2, 'sub', true, $3)`,
            [newUserId, school_id, userId]
        );

        res.json({ success: true, message: "Sub-admin created successfully.", data: { id: newUserId, email, full_name } });
    } catch (err) {
        console.error("CREATE_SUB_ADMIN_ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// PUT /api/admin/toggle-sub-admin/:userId — Pause/activate a sub-admin (main admin only)
exports.toggleSubAdminStatus = async (req, res) => {
    const { id: userId, school_id, role } = req.user;
    const { userId: targetUserId } = req.params;

    try {
        if (role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        // Verify user is a main admin
        const adminCheck = await db.query(
            'SELECT role_level FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
            [userId, school_id]
        );

        const adminRecord = adminCheck.rows[0];
        if (adminRecord && adminRecord.role_level !== 'main') {
            return res.status(403).json({ success: false, message: "Only main admins can toggle sub-admin status." });
        }

        // Get current status
        const current = await db.query(
            'SELECT is_active FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
            [targetUserId, school_id]
        );

        if (current.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Sub-admin not found." });
        }

        const newStatus = !current.rows[0].is_active;

        // Update status
        await db.query(
            'UPDATE admin_accounts SET is_active = $1, updated_at = NOW() WHERE user_id = $2 AND school_id = $3',
            [newStatus, targetUserId, school_id]
        );

        res.json({ success: true, message: `Sub-admin ${newStatus ? 'activated' : 'paused'}.`, data: { is_active: newStatus } });
    } catch (err) {
        console.error("TOGGLE_SUB_ADMIN_ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/admin/reset-sub-admin-pin/:userId — Reset a sub-admin's PIN (main admin only, requires confirmation)
exports.resetSubAdminPin = async (req, res) => {
    const { id: userId, school_id, role } = req.user;
    const { userId: targetUserId } = req.params;
    const { newPin, confirmation } = req.body;

    try {
        if (role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        // Verify user is a main admin
        const adminCheck = await db.query(
            'SELECT role_level FROM admin_accounts WHERE user_id = $1 AND school_id = $2',
            [userId, school_id]
        );

        const adminRecord = adminCheck.rows[0];
        if (adminRecord && adminRecord.role_level !== 'main') {
            return res.status(403).json({ success: false, message: "Only main admins can reset sub-admin PINs." });
        }

        if (!newPin || !confirmation) {
            return res.status(400).json({ success: false, message: "New PIN and confirmation are required." });
        }

        if (confirmation !== 'CONFIRM') {
            return res.status(400).json({ success: false, message: "Invalid confirmation." });
        }

        // Verify target is a sub-admin in this school
        const targetCheck = await db.query(
            'SELECT id FROM admin_accounts WHERE user_id = $1 AND school_id = $2 AND role_level = \'sub\'',
            [targetUserId, school_id]
        );

        if (targetCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Sub-admin not found." });
        }

        // Update password
        const hashedPin = await bcrypt.hash(newPin.toString(), 10);
        await db.query(
            'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
            [hashedPin, targetUserId]
        );

        res.json({ success: true, message: "Sub-admin PIN reset successfully." });
    } catch (err) {
        console.error("RESET_SUB_ADMIN_PIN_ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};