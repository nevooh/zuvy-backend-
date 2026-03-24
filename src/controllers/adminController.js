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