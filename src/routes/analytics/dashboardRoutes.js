const express = require('express');
const router = express.Router();

const { protect } = require('../../middleware/authMiddleware');
const { getDashboardSummary, getChartData, getSubjectPerformanceByYear, getEnhancedDashboard } = require('../../controllers/analytics/dashboardController');

router.get('/summary', protect, getDashboardSummary);
router.get('/charts', protect, getChartData);
router.get('/subject-performance', protect, getSubjectPerformanceByYear);
router.get('/enhanced', protect, getEnhancedDashboard);

module.exports = router;
