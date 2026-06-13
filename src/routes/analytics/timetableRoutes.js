const express = require('express');
const router = express.Router();
const {
  getSlots, createSlot, deleteSlot,
  getTimetable, setEntry, getSchoolDays,
  getSubjectTeacher, getTeachersForSubject,
  checkTeacherConflict,
  getSettings, saveSettings,
  copyTimetable, getTeacherWorkload,
} = require('../../controllers/analytics/timetableController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/slots',            protect, getSlots);
router.post('/slots',           protect, createSlot);
router.delete('/slots/:id',     protect, deleteSlot);
router.get('/class/:class_id',  protect, getTimetable);
router.post('/entry',           protect, setEntry);
router.get('/days',             protect, getSchoolDays);
router.get('/subject-teacher',   protect, getSubjectTeacher);
router.get('/subject-teachers',  protect, getTeachersForSubject);
router.get('/check-conflict',   protect, checkTeacherConflict);
router.get('/settings',         protect, getSettings);
router.post('/settings',        protect, saveSettings);
router.post('/copy',            protect, copyTimetable);
router.get('/workload',         protect, getTeacherWorkload);

module.exports = router;
