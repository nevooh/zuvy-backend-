const express = require('express');
const router = express.Router();
const { 
    admitStudent, 
    updateStudent, 
    deleteStudent, 
    getAllStudents,
    updateStudentStatus
} = require('../controllers/studentController'); 
const { protect } = require('../middleware/authMiddleware');

// 1. PROTECT ALL ROUTES
router.use(protect);

// 2. DEFINE ROUTES
router.get('/', getAllStudents); 
router.post('/admit', admitStudent);
router.put('/:id', updateStudent);
router.delete('/:id', deleteStudent);
router.patch('/:id/status', updateStudentStatus);
module.exports = router;