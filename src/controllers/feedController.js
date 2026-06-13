const { pool } = require('../config/db');

function getSchoolId(req) {
  return req.user?.school_id || req.user?.schoolId || req.school_id;
}

async function assertPostInSchool(postId, schoolId) {
  const result = await pool.query(
    `SELECT id FROM school_posts WHERE id = $1 AND school_id = $2 LIMIT 1`,
    [postId, schoolId]
  );

  if (result.rowCount === 0) {
    const err = new Error('Post not found');
    err.status = 404;
    throw err;
  }
}

// ── GET /feed — paginated, unseen first ───────────────────────────────────────
exports.getFeed = async (req, res) => {
  const schoolId  = req.user.schoolId;
  const userPhone = req.user.phoneNumber;
  const page      = parseInt(req.query.page) || 1;
  const limit     = 10;
  const offset    = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.teacher_name,
         p.caption,
         p.image_url,
         p.video_url,
         p.post_type,
         p.likes_count,
         p.created_at,
         t.id AS teacher_id,
         -- Pull media_items JSON array (new multi-media column)
         COALESCE(p.media_items, '[]'::jsonb) AS media_items,
         EXISTS (
           SELECT 1 FROM post_likes pl
           WHERE pl.post_id = p.id AND pl.user_phone = $2
         ) AS liked_by_me,
         EXISTS (
           SELECT 1 FROM post_views pv
           WHERE pv.post_id = p.id AND pv.user_phone = $2
         ) AS seen_by_me
       FROM school_posts p
       LEFT JOIN teachers t ON t.id = p.teacher_id
       WHERE p.school_id = $1
       ORDER BY
         seen_by_me ASC,        -- unseen posts come first
         p.created_at DESC      -- within each group, newest first
       LIMIT $3 OFFSET $4`,
      [schoolId, userPhone, limit, offset]
    );

    return res.status(200).json({
      success: true,
      page,
      data: result.rows,
    });

  } catch (err) {
    console.error('[getFeed]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /feed/post — teacher creates a post ──────────────────────────────────
exports.createPost = async (req, res) => {
  const schoolId  = req.user.schoolId;
  const teacherId = parseInt(req.user.teacherId);
  const { caption, imageUrl, videoUrl, postType, mediaItems } = req.body;

  if (req.user.role !== 'teacher' || !teacherId) {
    return res.status(403).json({ success: false, message: 'Teachers only.' });
  }

  // mediaItems = [{ url, type }]  (new)
  // imageUrl / videoUrl           (legacy single-media, still supported)
  const hasContent = caption || imageUrl || videoUrl ||
      (Array.isArray(mediaItems) && mediaItems.length > 0);

  if (!hasContent) {
    return res.status(400).json({
      success: false,
      message: 'Post needs a caption or media.' });
  }

  try {
    const teacherResult = await pool.query(
      `SELECT name FROM teachers WHERE id = $1 AND school_id = $2`,
      [teacherId, schoolId]
    );

    if (teacherResult.rows.length === 0)
      return res.status(404).json({
        success: false, message: 'Teacher not found.' });

    const teacherName = teacherResult.rows[0].name;

    // Build media_items: if new array provided use it,
    // else fall back to legacy single fields
    let mediaItemsJson = '[]';
    if (Array.isArray(mediaItems) && mediaItems.length > 0) {
      mediaItemsJson = JSON.stringify(mediaItems);
    } else if (imageUrl) {
      mediaItemsJson = JSON.stringify([{ url: imageUrl, type: 'image' }]);
    } else if (videoUrl) {
      mediaItemsJson = JSON.stringify([{ url: videoUrl, type: 'video' }]);
    }

    // Derive first-item URLs for legacy columns (backwards compat)
    const parsedItems = JSON.parse(mediaItemsJson);
    const firstImage  = parsedItems.find(i => i.type === 'image')?.url || imageUrl || null;
    const firstVideo  = parsedItems.find(i => i.type === 'video')?.url || videoUrl || null;

    const result = await pool.query(
      `INSERT INTO school_posts
         (school_id, teacher_id, teacher_name,
          caption, image_url, video_url, post_type, media_items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        schoolId, teacherId, teacherName,
        caption   || null,
        firstImage,
        firstVideo,
        postType  || (firstVideo ? 'video' : firstImage ? 'image' : 'text'),
        mediaItemsJson,
      ]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error('[createPost]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /feed/:postId/like — toggle like ─────────────────────────────────────
exports.toggleLike = async (req, res) => {
  const { postId } = req.params;
  const userPhone  = req.user.phoneNumber;
  const userRole   = req.user.role;
  const schoolId   = getSchoolId(req);

  try {
    await assertPostInSchool(postId, schoolId);

    const existing = await pool.query(
      `SELECT id FROM post_likes WHERE post_id = $1 AND user_phone = $2`,
      [postId, userPhone]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `DELETE FROM post_likes WHERE post_id = $1 AND user_phone = $2`,
        [postId, userPhone]
      );
      await pool.query(
        `UPDATE school_posts
         SET likes_count = GREATEST(likes_count - 1, 0)
         WHERE id = $1`,
        [postId]
      );
      return res.status(200).json({ success: true, liked: false });
    } else {
      await pool.query(
        `INSERT INTO post_likes (post_id, user_phone, user_role)
         VALUES ($1, $2, $3)`,
        [postId, userPhone, userRole]
      );
      await pool.query(
        `UPDATE school_posts SET likes_count = likes_count + 1 WHERE id = $1`,
        [postId]
      );
      return res.status(200).json({ success: true, liked: true });
    }

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[toggleLike]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /feed/:postId/comments ─────────────────────────────────────────────────
exports.getComments = async (req, res) => {
  const { postId } = req.params;
  const schoolId = getSchoolId(req);

  try {
    await assertPostInSchool(postId, schoolId);

    const result = await pool.query(
      `SELECT id, parent_name, comment_text,
              user_phone, user_role, created_at
       FROM post_comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    return res.status(200).json({ success: true, data: result.rows });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[getComments]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /feed/:postId/comment ─────────────────────────────────────────────────
exports.addComment = async (req, res) => {
  const { postId }     = req.params;
  const { commentText } = req.body;
  const userPhone      = req.user.phoneNumber;
  const userRole       = req.user.role;
  const schoolId       = getSchoolId(req);

  if (!commentText?.trim())
    return res.status(400).json({
      success: false, message: 'Comment cannot be empty.' });

  try {
    await assertPostInSchool(postId, schoolId);

    let commenterName = 'User';

    if (userRole === 'teacher') {
      const t = await pool.query(
        `SELECT name FROM teachers WHERE phone = $1`, [userPhone]);
      if (t.rows.length > 0) commenterName = t.rows[0].name;
    } else {
      const p = await pool.query(
        `SELECT parent_name FROM students
         WHERE parent_phone = $1 LIMIT 1`, [userPhone]);
      if (p.rows.length > 0) commenterName = p.rows[0].parent_name;
    }

    const result = await pool.query(
      `INSERT INTO post_comments
         (post_id, parent_name, comment_text, user_phone, user_role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [postId, commenterName, commentText.trim(), userPhone, userRole]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[addComment]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /feed/:postId/seen ────────────────────────────────────────────────────
exports.markSeen = async (req, res) => {
  const { postId } = req.params;
  const userPhone  = req.user.phoneNumber;
  const schoolId   = getSchoolId(req);

  try {
    await assertPostInSchool(postId, schoolId);

    await pool.query(
      `INSERT INTO post_views (post_id, user_phone)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [postId, userPhone]
    );
    return res.status(200).json({ success: true });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[markSeen]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── DELETE /feed/:postId ───────────────────────────────────────────────────────
exports.deletePost = async (req, res) => {
  const { postId }  = req.params;
  const teacherId   = parseInt(req.user.teacherId);
  const userRole    = req.user.role;

  if (userRole !== 'teacher')
    return res.status(403).json({ success: false, message: 'Teachers only.' });

  try {
    const result = await pool.query(
      `DELETE FROM school_posts
       WHERE id = $1 AND teacher_id = $2
       RETURNING id`,
      [postId, teacherId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({
        success: false, message: 'Post not found or not yours.' });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[deletePost]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
