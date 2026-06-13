const express = require('express');
const router = express.Router();
const {
  getScales, createScale, deleteScale, setDefault,
  getScaleSubjects, getSubjectClasses,
  getBands, saveBands, copyBands,
  getScaleClasses, bulkSaveBands, getScaleOverview,
} = require('../../controllers/analytics/gradingController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/', protect, getScales);
router.post('/', protect, createScale);
router.delete('/:id', protect, deleteScale);
router.patch('/:id/default', protect, setDefault);
router.get('/:id/subjects', protect, getScaleSubjects);
router.get('/:id/subjects/:subject_id/classes', protect, getSubjectClasses);
router.get('/:id/subjects/:subject_id/classes/:class_id/bands', protect, getBands);
router.put('/:id/subjects/:subject_id/classes/:class_id/bands', protect, saveBands);
router.post('/:id/copy-bands', protect, copyBands);
router.get('/:id/classes', protect, getScaleClasses);
router.post('/:id/bulk-save-bands', protect, bulkSaveBands);
router.get('/:id/overview', protect, getScaleOverview);

module.exports = router;
