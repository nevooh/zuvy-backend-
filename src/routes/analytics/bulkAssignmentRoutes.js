const express = require('express');
const router = express.Router();
const { getMatrix, saveMatrix } = require('../../controllers/analytics/bulkAssignmentController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/',  protect, getMatrix);
router.post('/', protect, saveMatrix);

module.exports = router;
