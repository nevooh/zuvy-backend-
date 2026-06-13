const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/parentAcademicsController');
const { protect } = require('../middleware/authMiddleware');

router.get('/:studentId/history',    protect, ctrl.getAcademicHistory);
router.get('/:studentId/attendance', protect, ctrl.getAttendanceDetail);

module.exports = router;
