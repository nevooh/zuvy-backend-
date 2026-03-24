const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { createTeacher, createStudent, listUsers } = require('../controllers/userController');

// Optional: only admins can manage users
const allowRoles = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};

// Admin creates teachers/students
router.post('/create-teacher', protect, allowRoles('admin'), createTeacher);
router.post('/create-student', protect, allowRoles('admin'), createStudent);

// List all users in the school
router.get('/list', protect, allowRoles('admin'), listUsers);

module.exports = router;
