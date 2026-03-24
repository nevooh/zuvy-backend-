const express = require('express');
const router = express.Router();
const masterAuthController = require('../controllers/masterAuthController');

// POST /api/master/login
router.post('/login', masterAuthController.login);

module.exports = router;
