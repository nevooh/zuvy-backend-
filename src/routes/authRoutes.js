const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/auth/login
router.post('/login', authController.login);

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
    res.json({
        message: 'Authenticated ✅',
        user: req.user
    });
});

module.exports = router;
