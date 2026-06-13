const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const walletController = require('../controllers/walletController');

// IntaSend webhook — public, no auth
router.post(
    '/webhook/intasend',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
        req.rawBody = req.body.toString();
        req.body    = JSON.parse(req.rawBody);
        next();
    },
    walletController.intasendWebhook
);

// PROTECTED ROUTES
router.use(protect);

router.get('/balance', walletController.getBalance);
router.get('/rate', walletController.getRate);
router.get('/info', walletController.getWalletInfo);
router.post('/topup', walletController.initiateTopUp);
router.get('/history', walletController.getHistory);
router.put('/settlement-settings', walletController.updateSettlementDetails);

module.exports = router;