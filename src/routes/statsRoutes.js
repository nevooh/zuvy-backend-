const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/statsController'); 
const { protect } = require('../middleware/authMiddleware');

// Only logged-in users (admins) can see school metrics
router.get('/dashboard', protect, getDashboardStats);

module.exports = router;