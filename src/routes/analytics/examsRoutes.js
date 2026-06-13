const express = require('express');
const router = express.Router();
const {
  getExams,
  createExam,
  updateExam,
  deleteExam,
  getTerms,
} = require('../../controllers/analytics/examsController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/', protect, getExams);
router.post('/', protect, createExam);
router.put('/:id', protect, updateExam);
router.delete('/:id', protect, deleteExam);
router.get('/terms', protect, getTerms);

module.exports = router;
