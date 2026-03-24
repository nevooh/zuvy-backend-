const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const termController = require('../controllers/termController');

router.use(protect);

router.post('/', termController.createTerm);
router.get('/', termController.getTerms);
router.post('/:id/activate', termController.activateTerm);
router.put('/:id/lock', termController.lockTerm);
router.put('/:id', termController.updateTerm);
router.put('/active/snapshots', termController.snapshotActiveTermFees);
module.exports = router;
