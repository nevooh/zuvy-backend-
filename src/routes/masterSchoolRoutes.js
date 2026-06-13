const express = require('express');
const router  = express.Router();

const { protectMaster }       = require('../middleware/masterAuthMiddleware');
const masterSchoolController  = require('../controllers/masterSchoolController');

router.get('/schools',                    protectMaster, masterSchoolController.getAllSchools);
router.post('/schools',                   protectMaster, masterSchoolController.createSchoolWithAdmin);
router.get('/schools/trash',              protectMaster, masterSchoolController.getTrash);
router.get('/schools/:id',                protectMaster, masterSchoolController.getSchoolDetail);
router.patch('/schools/:id/toggle',       protectMaster, masterSchoolController.toggleSchoolStatus);
router.patch('/schools/:id/plan',         protectMaster, masterSchoolController.updatePlan);
router.patch('/schools/:id/restore',      protectMaster, masterSchoolController.restoreSchool);
router.post('/schools/:id/reset-password',protectMaster, masterSchoolController.resetAdminPassword);
router.delete('/schools/:id',             protectMaster, masterSchoolController.deleteSchool);

module.exports = router;
