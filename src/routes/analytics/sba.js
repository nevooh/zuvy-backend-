const express = require('express');
const router  = express.Router();
const {
  getActiveTerm,
  getClasses,
  getStudents,
  getClassSubjects,
  getSbaList,
  recordSba,
  updateSba,
  deleteSba,
  getAssessmentTypes,
  getProjects,
  createProject,
} = require('../../controllers/analytics/sbaController');
const { protect } = require('../../middleware/authMiddleware');

// Base: /api/sba
router.get('/active',           protect, getActiveTerm);
router.get('/classes',          protect, getClasses);
router.get('/students',         protect, getStudents);
router.get('/class_subjects',   protect, getClassSubjects);
router.get('/list',             protect, getSbaList);
router.get('/assessment-types', protect, getAssessmentTypes);
router.get('/projects',         protect, getProjects);

router.post('/record',          protect, recordSba);
router.post('/projects',        protect, createProject);

router.put('/record/:id',       protect, updateSba);
router.delete('/record/:id',    protect, deleteSba);

module.exports = router;
