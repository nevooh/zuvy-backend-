const express = require('express');
const router = express.Router();
const { applyOpeningBalance } = require('../controllers/openingBalanceController');
const { protect } = require('../middleware/authMiddleware');

// Only authenticated users (admins) can apply opening balances
router.post('/apply', protect, applyOpeningBalance);

module.exports = router;