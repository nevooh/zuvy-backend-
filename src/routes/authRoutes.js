const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/reset-pin
router.post('/reset-pin', protect, authController.resetPin);

// GET /api/auth/me - includes admin role level
router.get('/me', protect, authController.getAuthenticatedUser);

module.exports = router;
