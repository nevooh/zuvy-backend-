const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const feeTypeController = require('../controllers/feeTypeController');

router.use(protect);

router.post('/', feeTypeController.createFeeType);
router.get('/', feeTypeController.getFeeTypes);

module.exports = router;
