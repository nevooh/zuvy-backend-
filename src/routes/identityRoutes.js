const express = require('express');
const router = express.Router();
const { getStudentIdentity } = require('../controllers/identityController');
const { protect } = require('../middleware/authMiddleware');

// Fetch student identity by UUID
router.get('/:id', protect, getStudentIdentity);

module.exports = router;