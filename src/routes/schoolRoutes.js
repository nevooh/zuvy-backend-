const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const schoolController = require('../controllers/schoolController');

// 🛡️ All school routes are protected
router.use(protect);

// Get Profile
router.get('/profile', schoolController.getSchoolProfile);

// Update Profile (General Info)
router.post('/update', schoolController.updateSchoolProfile);

// Update Settlement (Paybill/Account) 👈 ADD THIS
router.put('/settlement', schoolController.updateSettlementDetails);

module.exports = router;