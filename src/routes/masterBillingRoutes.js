const express    = require('express');
const router     = express.Router();
const { protectMaster } = require('../middleware/masterAuthMiddleware');
const c          = require('../controllers/masterBillingController');

router.get('/billing/settings',              protectMaster, c.getSettings);
router.patch('/billing/settings',            protectMaster, c.updateSettings);
router.get('/billing/overview',              protectMaster, c.getOverview);
router.get('/billing/schools',               protectMaster, c.getSchoolsBilling);
router.get('/billing/invoices',              protectMaster, c.getAllInvoices);
router.post('/billing/process-trials',       protectMaster, c.processTrials);
router.post('/billing/warn-trials',          protectMaster, c.warnTrials);
router.post('/billing/suspend-overdue',      protectMaster, c.suspendOverdue);
router.patch('/billing/invoices/:id/pay',    protectMaster, c.markInvoicePaid);
router.patch('/billing/invoices/:id/extend', protectMaster, c.extendGrace);
router.patch('/schools/:id/trial',           protectMaster, c.setTrialEndDate);
router.patch('/billing/schools/:id/end-trial', protectMaster, c.endTrial);
router.post('/billing/schools/:id/bill',     protectMaster, c.manualBill);
router.patch('/billing/schools/:id/type',    protectMaster, c.setSchoolBillingType);

module.exports = router;
