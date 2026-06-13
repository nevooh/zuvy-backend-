const express = require('express');
const router = express.Router();
const {
    getStudentFeeOverview,
    getStudentPaymentHistory,
    getFeeSummary
} = require('../controllers/teacherFeeController');
const { protect } = require('../middleware/authMiddleware');

// School-level fee collection summary (active term)
router.get('/summary', protect, getFeeSummary);

// All students with invoice status for the active term
router.get('/students', protect, getStudentFeeOverview);

// Single student — full payment history across all terms
router.get('/students/:studentId/history', protect, getStudentPaymentHistory);

module.exports = router;