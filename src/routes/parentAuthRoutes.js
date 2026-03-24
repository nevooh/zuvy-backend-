// src/routes/parentRoutes.js
const express = require('express');
const router = express.Router();
const parentAuthController = require('../controllers/parentAuthController');

// DOOR 1: When Flutter calls /request-otp
router.post('/request-otp', parentAuthController.requestParentAccess);

// DOOR 2: When Flutter calls /verify-otp
router.post('/verify-otp', parentAuthController.verifyOtp);

module.exports = router;