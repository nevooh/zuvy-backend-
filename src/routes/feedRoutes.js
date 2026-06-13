const express  = require('express');
const router   = express.Router();
const {
  getFeed,
  createPost,
  toggleLike,
  getComments,
  addComment,
  markSeen,
  deletePost,
} = require('../controllers/feedController');
const { protect } = require('../middleware/authMiddleware');

// Base: /api/feed
router.get('/',                    protect, getFeed);
router.post('/post',               protect, createPost);
router.post('/:postId/like',       protect, toggleLike);
router.get('/:postId/comments',    protect, getComments);
router.post('/:postId/comment',    protect, addComment);
router.post('/:postId/seen',       protect, markSeen);
router.delete('/:postId',          protect, deletePost);

module.exports = router;