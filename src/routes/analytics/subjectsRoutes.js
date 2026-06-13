const express = require('express');
const router = express.Router();
const {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getClassSubjects,
  assignSubjectToClass,
  removeSubjectFromClass,
} = require('../../controllers/analytics/subjectsController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/', protect, getSubjects);
router.post('/', protect, createSubject);
router.put('/:id', protect, updateSubject);
router.delete('/:id', protect, deleteSubject);
router.get('/class/:class_id', protect, getClassSubjects);
router.post('/assign', protect, assignSubjectToClass);
router.delete('/class/:class_id/subject/:subject_id', protect, removeSubjectFromClass);

module.exports = router;
