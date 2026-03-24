const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const walletController = require('../controllers/walletController');

/**
 * 1. PUBLIC CALLBACKS
 * Safaricom calls these. Do NOT put 'protect' here or they will fail (401).
 */
router.post('/b2b/result', walletController.mpesaB2BResult);
router.post('/b2b/timeout', walletController.mpesaB2BTimeout);

/**
 * 2. PROTECTED ROUTES
 * These require a logged-in user (School Admin).
 */
router.use(protect);

router.get('/balance', walletController.getBalance);
router.get('/rate', walletController.getRate);
router.post('/topup', walletController.initiateTopUp);
router.get('/history', walletController.getHistory);

// The Steering Wheel: Let schools set their own paybill
router.put('/settlement-settings', walletController.updateSettlementDetails);

module.exports = router;