const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/parentPaymentController');

// 1. You imported 'protect' here...
const { protect } = require('../middleware/authMiddleware');

// 2. ...so you must use 'protect' here instead of 'verifyToken'
router.post('/payments/checkout-summary', protect, paymentController.getCheckoutSummary);

router.post('/payments/stk-push', protect, paymentController.initiateFeePayment);

// 3. Keep this PUBLIC (No middleware)
router.post('/payments/callback', paymentController.mpesaFeeCallback);

module.exports = router;
