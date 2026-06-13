const express = require('express');
const router  = express.Router();
const {
  getHomeData,
  getWeeklyTimetable,
  getClasses,
  getClassStudents,
  submitAttendance,
  getClassSubjects,
  getExams,
  submitMarks,
  submitResults,
  getStudents,
  getProfile,
  getClassResults,
  getMyClass,
  getClassFees,
  getAttendanceHistory,
  getStudentTransactions,
  updateParentInfo,
} = require('../controllers/teacherController');
const { protect, requireRole } = require('../middleware/authMiddleware');

const guard = [protect, requireRole('teacher')];

router.get('/home',                                ...guard, getHomeData);
router.get('/timetable',                           ...guard, getWeeklyTimetable);
router.get('/classes',                             ...guard, getClasses);
router.get('/classes/:classId/students',           ...guard, getClassStudents);
router.get('/classes/:classId/subjects',           ...guard, getClassSubjects);
router.get('/classes/:classId/results',            ...guard, getClassResults);
router.get('/exams',                               ...guard, getExams);
router.get('/students',                            ...guard, getStudents);
router.get('/profile',                             ...guard, getProfile);
router.post('/attendance',                         ...guard, submitAttendance);
router.post('/marks',                              ...guard, submitMarks);
router.post('/results',                            ...guard, submitResults);
router.get('/class',                               ...guard, getMyClass);
router.get('/class/fees',                          ...guard, getClassFees);
router.get('/class/attendance-history',            ...guard, getAttendanceHistory);
router.get('/students/:studentId/transactions',    ...guard, getStudentTransactions);
router.put('/students/:studentId/parent',          ...guard, updateParentInfo);

module.exports = router;