const express = require('express');
const router = express.Router();
const {
  getReportCard, saveComment, getClassReportCards,
} = require('../../controllers/analytics/reportCardController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/class/:class_id/:exam_id', protect, getClassReportCards);
router.get('/:student_id/:exam_id', protect, getReportCard);
router.post('/:student_id/:exam_id/comment', protect, saveComment);

module.exports = router;
