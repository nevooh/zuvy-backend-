const express    = require('express');
const router     = express.Router();
const { registerToken } = require('../controllers/fcmController');
const { protect }       = require('../middleware/authMiddleware');

// POST /api/parent/fcm-token
router.post('/fcm-token', protect, registerToken);

module.exports = router;
