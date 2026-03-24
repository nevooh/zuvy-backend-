const express = require('express');
const router = express.Router();

const { protectMaster } = require('../middleware/masterAuthMiddleware');
const masterSchoolController = require('../controllers/masterSchoolController');

// 1️⃣ Fetch all schools (Used for the Table)
router.get('/schools', protectMaster, masterSchoolController.getAllSchools);

// 2️⃣ Register a new school (Used for the Dialog)
router.post(
    '/schools',
    protectMaster,
    masterSchoolController.createSchoolWithAdmin
);

// 3️⃣ Toggle Active/Inactive status (Used for the Actions column)
// We use PATCH because we are only updating one field (is_active)
router.patch(
    '/schools/:id/toggle', 
    protectMaster, 
    masterSchoolController.toggleSchoolStatus
);

module.exports = router;