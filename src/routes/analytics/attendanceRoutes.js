const express = require('express');
const router = express.Router();
const {
  getAttendanceSummary,
  getClassAttendance,
  saveAttendance,
  getChronicAbsentees,
  getStudentAttendance,
  getClassesForLevel,
  getCalendar,
  getSpreadsheet,
  getActiveTerm,
  getTermsList,
  getMarkedDays,
} = require('../../controllers/analytics/attendanceController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/active-term', protect, getActiveTerm);
router.get('/terms', protect, getTermsList);
router.get('/summary', protect, getAttendanceSummary);
router.get('/class', protect, getClassAttendance);
router.post('/save', protect, saveAttendance);
router.get('/absentees', protect, getChronicAbsentees);
router.get('/student/:student_id', protect, getStudentAttendance);
router.get('/classes', protect, getClassesForLevel);
router.get('/calendar', protect, getCalendar);
router.get('/marked-days', protect, getMarkedDays);
router.get('/spreadsheet', protect, getSpreadsheet);

module.exports = router;
