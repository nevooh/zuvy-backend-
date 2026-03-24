const express = require('express');
const router = express.Router();
const feeController = require('../controllers/feeController');
const pool = require('../config/db');
// Fee Items
router.post('/items', feeController.createFeeItem);
router.get('/items/:schoolId', feeController.getFeeItems);
router.put('/items/:id', feeController.updateFeeItem);
router.delete('/items/:id', feeController.deleteFeeItem);

// Fee Structures
router.post('/structures', feeController.createFeeStructure);
router.get('/structures/:schoolId', feeController.getFeeStructures);
router.put('/structures/:id', feeController.updateFeeStructure);

// Fee Structure Items
router.post('/structures/:id/items', feeController.addItemsToStructure);
router.get('/structures/:id/items', feeController.getStructureItems);
router.put('/structure-items/:id', feeController.updateStructureItem);
router.delete('/structure-items/:id', feeController.deleteStructureItem);

// Invoices
router.post('/invoices/generate', feeController.generateInvoices);
router.get('/invoices/:studentId', feeController.getStudentInvoices);
router.get('/invoices/school/:schoolId/term/:term', feeController.getInvoicesByTerm);

// Payments
router.post('/payments', feeController.recordPayment);
router.get('/payments/:studentId', feeController.getStudentPayments);

// Adjustments
router.post('/adjustments', feeController.applyAdjustment);
router.get('/adjustments/:studentId', feeController.getStudentAdjustments);


module.exports = router;
