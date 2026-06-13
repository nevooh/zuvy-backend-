const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const ctrl       = require('../controllers/publicRegistrationController');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many requests. Try again later.' },
});

router.post('/request-registration', limiter, ctrl.requestRegistration);
router.post('/verify-registration',  limiter, ctrl.verifyRegistration);
router.post('/request-admin-otp',    limiter, ctrl.requestAdminOtp);
router.post('/verify-admin-otp',     limiter, ctrl.verifyAdminOtp);
router.get ('/school-dashboard',             ctrl.getSchoolDashboard);
router.post('/subscription-pay',     limiter, ctrl.subscriptionPay);
router.post('/set-pin',                      ctrl.setPin);
router.post('/subscription-callback',        ctrl.subscriptionCallback);

module.exports = router;
