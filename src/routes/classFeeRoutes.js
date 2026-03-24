const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const classFeeController = require('../controllers/classFeeController');

router.use(protect);

router.post('/', classFeeController.setClassFees);
router.get('/:class_id/:term_id', classFeeController.getClassFees);

module.exports = router;
