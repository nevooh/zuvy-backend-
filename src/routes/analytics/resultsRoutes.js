const express = require('express');
const router = express.Router();
const {
  getResultsGrid,
  saveResults,
  getExamClasses,
  getExamStudents,
  getLeaderboard,
  getStudentProfile,
} = require('../../controllers/analytics/resultsController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/grid', protect, getResultsGrid);
router.post('/save', protect, saveResults);
router.get('/exam/:exam_id/classes', protect, getExamClasses);
router.get('/exam-students', protect, getExamStudents);
router.get('/leaderboard', protect, getLeaderboard);
router.get('/student/:id', protect, getStudentProfile);

module.exports = router;
