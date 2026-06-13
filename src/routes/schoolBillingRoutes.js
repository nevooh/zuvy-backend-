const express = require('express');
const router  = express.Router();
const { protect, requireAdminLevel } = require('../middleware/authMiddleware');
const c = require('../controllers/schoolBillingController');

router.patch('/type',    protect, requireAdminLevel('main'), c.updateBillingType);
router.get('/invoices', protect, c.getInvoices);
router.get('/current',  protect, c.getCurrentInvoice);
router.post('/pay/mpesa', protect, c.initiateSTK);
router.post('/pay/link',  protect, c.generatePayLink);
router.post('/webhook', c.instasendWebhook);
module.exports = router;
