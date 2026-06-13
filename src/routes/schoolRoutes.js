const express = require('express');
const router = express.Router();
const { protect, requireAdminLevel } = require('../middleware/authMiddleware');
const schoolController = require('../controllers/schoolController');

// 🛡️ All school routes are protected
router.use(protect);

// Get Profile
router.get('/profile', schoolController.getSchoolProfile);

// Update Profile (General Info)
router.post('/update', schoolController.updateSchoolProfile);

// Update Settlement (Paybill/Account) - main admin only
router.put('/settlement', requireAdminLevel('main'), schoolController.updateSettlementDetails);

module.exports = router;