const express        = require('express');
const router         = express.Router();
const { protectMaster } = require('../middleware/masterAuthMiddleware');
const ctrl           = require('../controllers/ownerController');

router.get('/dashboard',                  protectMaster, ctrl.getDashboard);
router.post('/schools/:id/pause',         protectMaster, ctrl.pauseSchool);
router.post('/schools/:id/activate',      protectMaster, ctrl.activateSchool);
router.post('/billing/record-payment',    protectMaster, ctrl.recordPayment);

module.exports = router;
