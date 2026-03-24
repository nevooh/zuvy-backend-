const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const { protect } = require('../middleware/authMiddleware'); // Use the 'protect' function

// 🚀 Use 'protect' instead of 'authMiddleware' as the handler
router.get('/', protect, teacherController.getTeachers);
router.post('/', protect, teacherController.createTeacher);
router.post('/assign', protect, teacherController.assignTeacher);

module.exports = router; // 👈 This MUST be at the very bottom alone