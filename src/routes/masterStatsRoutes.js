const express = require('express');
const router  = express.Router();

const { protectMaster }     = require('../middleware/masterAuthMiddleware');
const masterStatsController = require('../controllers/masterStatsController');
const walletController      = require('../controllers/walletController');

router.get('/stats/overview', protectMaster, masterStatsController.getOverview);
router.get('/stats/sms',      protectMaster, masterStatsController.getSmsAnalytics);

// SMS pricing settings (master admin controls rate & minimum top-up)
router.get('/sms/settings', protectMaster, walletController.getSmsSettings);
router.put('/sms/settings', protectMaster, walletController.updateSmsSettings);

module.exports = router;
