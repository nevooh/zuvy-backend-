const express = require('express');
const router = express.Router();
const { bulkImportStudents, upload } = require('../controllers/bulkImportController');
const { protect } = require('../middleware/authMiddleware');

// Bulk import students via CSV or Excel
router.post('/students', protect, upload.single('file'), bulkImportStudents);

module.exports = router;