const express = require('express');
const router = express.Router();
const { getStudents, getClasses } = require('../../controllers/analytics/studentsController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/', protect, getStudents);
router.get('/classes', protect, getClasses);

module.exports = router;
