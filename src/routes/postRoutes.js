const express = require('express');
const router = express.Router();

// Option A: If you are importing everything as one object
const postController = require('../controllers/postController'); 

// Option B: If you are destructuring (common in modern Node apps)
// const { getSchoolFeed, addComment, toggleLike } = require('../controllers/postController');

const { protect } = require('../middleware/authMiddleware');

// If you used Option A, your routes should look like this:
router.get('/feed', protect, postController.getSchoolFeed);
router.post('/comment', protect, postController.addComment);
router.post('/like', protect, postController.toggleLike);

module.exports = router;