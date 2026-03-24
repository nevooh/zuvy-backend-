const express = require('express');
const router = express.Router();
const blueprintController = require('../controllers/blueprintController');
const { protect } = require('../middleware/authMiddleware'); // You named it 'protect' here

// 1. Publish new version
router.post('/', protect, blueprintController.publishBlueprint);

// 2. Fetch surgical snapshot (Term-specific)
router.get('/snapshot', protect, blueprintController.getActiveTermSnapshot);

// 3. Get Grade-specific Optionals (The new "Clean" route)
// Changed authMiddleware to protect to match your import 🚀
router.get('/optionals/:gradeName', protect, blueprintController.getGradeOptionals);

// 4. Get all history for a grade
router.get('/history/:gradeName', protect, blueprintController.getHistoryByGrade);

module.exports = router;