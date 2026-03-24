const express = require('express');
const router = express.Router();
// Import EVERYTHING from marksController
const { 
  getStudentGrade, 
  getClassResults, 
  addMark 
} = require('../controllers/marksController'); 
const { protect } = require('../middleware/authMiddleware');

// Routes
router.post('/', protect, addMark);
router.get('/student/:student_id/subject/:subject_id/exam/:exam_id', protect, getStudentGrade);
router.get('/class/:class_id/exam/:exam_id', protect, getClassResults);

module.exports = router;