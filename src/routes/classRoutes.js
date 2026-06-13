const express = require('express');
const router = express.Router();
const classController = require('../controllers/classController');
const { protect } = require('../middleware/authMiddleware');
router.put('/update-level-order', protect, classController.updateLevelOrder);
router.post('/', protect, classController.createClass);      // Create
router.get('/', protect, classController.getAllClasses);    // Read All
router.put('/:id', protect, classController.updateClass);   // Update
// routes/classRoutes.js
router.delete('/delete-by-name', protect, classController.deleteClassByName); // <-- move this up
router.delete('/:id', protect, classController.deleteClass); // DELETE single stream by UUID
router.get('/:id/students', protect, classController.getClassStudents);
router.get('/promote-preview', protect, classController.previewPromotion);
router.post('/promote-all',    protect, classController.promoteAllStudents);
router.get('/teacher-assignments/:teacherId', protect, classController.getTeacherAssignments);
router.post('/assign-teacher-classes', protect, classController.assignTeacherToClasses);
module.exports = router;