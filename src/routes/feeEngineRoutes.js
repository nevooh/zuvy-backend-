const express = require('express');
const router = express.Router();

// 1. Import the Controller (Logic)
const feeController = require('../controllers/feeEngineController');

// 2. Import the Middleware (Security)
const { protect } = require('../middleware/authMiddleware'); 

// 3. Define the URL paths
router.get('/snapshot', protect, feeController.getSnapshot);



module.exports = router;
