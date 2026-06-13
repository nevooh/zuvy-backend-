const express = require('express');
const router  = express.Router();
const {
  getTemplates, createTemplate, deleteTemplate,
  getExams, searchStudents, getRecipients,
  previewResults, sendSms,
  getHistory, getStats, deliveryReport,
} = require('../../controllers/analytics/smsController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/templates',          protect, getTemplates);
router.post('/templates',         protect, createTemplate);
router.delete('/templates/:id',   protect, deleteTemplate);
router.get('/exams',              protect, getExams);
router.get('/students/search',    protect, searchStudents);
router.get('/recipients',         protect, getRecipients);
router.post('/preview-results',   protect, previewResults);
router.post('/send',              protect, sendSms);
router.get('/history',            protect, getHistory);
router.get('/stats',              protect, getStats);
// No auth — Africa's Talking calls this directly
router.post('/delivery-report',           deliveryReport);

module.exports = router;
