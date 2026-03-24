const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const smsController = require('../controllers/smsController');

// 1. Get all templates for the school
router.get('/templates', protect, smsController.getTemplates);

// 2. Create a new template
router.post('/templates', protect, smsController.createTemplate);

// 3. Toggle Auto-SMS status (THE SAVER)
router.post('/toggle-auto', protect, smsController.toggleAutoSMS);

// --- ADD THIS LINE BELOW ---
// 4. Get current settings (THE LOADER)
router.get('/settings', protect, smsController.getSettings); 
// ---------------------------

// 5. Get the logs (Sent/Unsent)
router.get('/logs', protect, smsController.getLogs);

// 6. Manual Bulk Send (Send to a specific class)
router.post('/send-bulk', protect, smsController.sendBulkSMS);

router.get('/tags', protect, smsController.getSupportedTags);
// routes/smsRoutes.js
router.post('/set-default', protect, smsController.setDefaultPaymentTemplate);
module.exports = router;