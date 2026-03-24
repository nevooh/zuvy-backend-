const express = require('express');
const router = express.Router();
const studentOptionalController = require('../controllers/studentOptionalController');
const { protect } = require('../middleware/authMiddleware');

// 1. Sync selections (Delete old, Insert new)
// URL: POST /api/student-optionals/sync
router.post('/sync', protect, studentOptionalController.syncStudentOptionals);

// 2. Fetch existing selections for a specific student
// URL: GET /api/student-optionals/:studentId
router.get('/:studentId', protect, studentOptionalController.getStudentSelections);

module.exports = router;