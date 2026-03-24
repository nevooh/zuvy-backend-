const express = require('express');
const router = express.Router();
// ADD 'getSubjectLinks' to this list:
const { 
  getSubjects, 
  createSubject, 
  linkSubjectToClasses, 
  getSubjectLinks 
} = require('../controllers/subjectsController');

const { protect } = require('../middleware/authMiddleware');

// Base: /api/subjects
router.get('/', protect, getSubjects);
router.post('/', protect, createSubject);

// Link subject to specific classes
router.post('/link-classes', protect, linkSubjectToClasses);

// REMOVE 'subjectController.' and just use the function name:
router.get('/:id/links', protect, getSubjectLinks); 

module.exports = router;