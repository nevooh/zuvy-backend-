const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const studentProfile = require('../controllers/studentProfileController');

// All profile routes protected
router.use(protect);

// 1. GET: Fetch subjects for the modal
router.get('/subjects', studentProfile.getSchoolSubjects);

// 2. GET: Fetch existing curriculum
router.get('/:id/curriculum', studentProfile.getStudentCurriculum);

// 3. POST: 🚨 THIS WAS MISSING! 🚨
router.post('/assign', studentProfile.assignSubjects);

module.exports = router;