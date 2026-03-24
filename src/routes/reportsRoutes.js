const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controllers
const reportsController = require('../controllers/reportsController');
const expenseController = require('../controllers/expenseController');

router.use(protect);

// Report Routes
router.get('/finance-summary', reportsController.getFinanceSummary);
router.get('/finance-active', reportsController.getActiveFinance);
router.get('/finance-history', reportsController.getFinanceHistory);
router.get('/class-termly-reports', reportsController.getClassTermlyReports);
router.get('/general-finance-summary', reportsController.getGeneralFinanceSummary);
router.get('/all-terms', reportsController.getAllTerms);
// Expense Routes
router.get('/expenses/:term_id', expenseController.getTermExpenses);
router.post('/expenses', expenseController.addExpense);

module.exports = router;