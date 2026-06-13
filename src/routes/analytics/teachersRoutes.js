const express = require('express');
const router = express.Router();
const {
  getTeachers, getTeacher, createTeacher,
  updateTeacher, assignSubjects, deleteTeacher,
  setClassTeacher, getTeacherClasses,
} = require('../../controllers/analytics/teachersController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/', protect, getTeachers);
router.get('/:id', protect, getTeacher);
router.post('/', protect, createTeacher);
router.put('/:id', protect, updateTeacher);
router.put('/:id/subjects', protect, assignSubjects);
router.put('/:id/class-teacher', protect, setClassTeacher);
router.get('/:id/classes', protect, getTeacherClasses);
router.delete('/:id', protect, deleteTeacher);

module.exports = router;
