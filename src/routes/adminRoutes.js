const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// 1. Import 'protect' and 'requireAdminLevel' instead of 'verifyToken'
const { protect, requireAdminLevel } = require('../middleware/authMiddleware'); 

// 2. Use 'protect' in the route
router.put('/update-profile', protect, adminController.updateAdminProfile);

// Sub-admin management routes (main admin only)
router.get('/sub-admins', protect, adminController.listSubAdmins);
router.post('/create-sub-admin', protect, requireAdminLevel('main'), adminController.createSubAdmin);
router.put('/toggle-sub-admin/:userId', protect, requireAdminLevel('main'), adminController.toggleSubAdminStatus);
router.post('/reset-sub-admin-pin/:userId', protect, requireAdminLevel('main'), adminController.resetSubAdminPin);

module.exports = router;