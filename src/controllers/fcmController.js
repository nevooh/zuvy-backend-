const pool = require('../config/db');

// POST /api/parent/fcm-token
// Called by the app whenever it gets a new FCM token
exports.registerToken = async (req, res, next) => {
  const { fcm_token } = req.body;
  const phone = req.user?.phoneNumber;

  if (!fcm_token || !phone) {
    return res.status(400).json({ error: 'Missing fcm_token or auth' });
  }

  try {
    await pool.query(
      `INSERT INTO parent_devices (phone, fcm_token, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (phone) DO UPDATE
         SET fcm_token  = EXCLUDED.fcm_token,
             updated_at = NOW()`,
      [phone, fcm_token]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
