const express = require('express');
const router = express.Router();
const { getStudentProfile, getStudentFullHistory } = require('../../controllers/analytics/studentProfileController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/:id/history', protect, getStudentFullHistory);
router.get('/:id', protect, getStudentProfile);

module.exports = router;
