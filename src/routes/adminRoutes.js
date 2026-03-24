const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// 1. Import 'protect' instead of 'verifyToken'
const { protect } = require('../middleware/authMiddleware'); 

// 2. Use 'protect' in the route
router.put('/update-profile', protect, adminController.updateAdminProfile);

module.exports = router;