const express = require('express');
const router = express.Router();
const { getExams, createExam } = require('../controllers/examsController');
const { protect } = require('../middleware/authMiddleware');

// Get all exams
router.get('/', protect, getExams);

// Create a new exam
router.post('/', protect, createExam);

module.exports = router;