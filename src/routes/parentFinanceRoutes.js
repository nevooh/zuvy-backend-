// src/routes/parentFinanceRoutes.js
const express = require('express');
const router = express.Router();

// Import the specific finance controller
const financeController = require('../controllers/studentFinanceLedgerController');

// Using 'protect' to match your other routes (like postController)
const { protect } = require('../middleware/authMiddleware');

// The Premium route for fetching a student's ledger
// Flutter will call: GET /api/parent/finance/ledger/:studentId
router.get('/ledger/:studentId', protect, financeController.getStudentPremiumLedger);

module.exports = router;