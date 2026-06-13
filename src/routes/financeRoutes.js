const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const { protect } = require('../middleware/authMiddleware');

// 🔥 1️⃣ Generate invoice for ONE student
router.post('/invoices/generate', protect, financeController.generateInvoice);

// 💳 2️⃣ Post payment
router.post('/payments', protect, financeController.postPayment);
router.get('/payments/:student_id', protect, financeController.getStudentPayments);
router.get('/summary/:student_id', protect, financeController.getStudentFinancialSummary);
router.get('/general-audit', protect, financeController.getGeneralAudit);
router.get('/student-statement/:student_id', protect, financeController.getStudentStatement);
router.get('/detailed-audit/:student_id', protect, financeController.getDetailedAudit);
router.get('/search-students', protect, financeController.searchStudents);

// Admin fee structure endpoints (called by school_os_admin Flutter app)
router.post('/set-class-fee', protect, financeController.setClassFee);
router.get('/class-fees',     protect, financeController.getAdminClassFees);
router.post('/bulk-apply',    protect, financeController.bulkApplyFees);

module.exports = router;