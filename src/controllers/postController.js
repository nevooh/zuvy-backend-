const { pool } = require('../config/db');

exports.getSchoolFeed = async (req, res) => {
    const school_id = req.user.schoolId;
    const user_id = req.user.id; // Get the logged-in user's ID from the token

    try {
        const feed = await pool.query(`
            SELECT p.*, 
            -- Check if the CURRENT user has a row in post_likes for this post
            EXISTS (
                SELECT 1 FROM post_likes 
                WHERE post_id = p.id AND user_id = $2
            ) AS is_liked_by_me,
            COALESCE(
                (SELECT json_agg(c) FROM (
                    SELECT id, parent_name, comment_text, created_at 
                    FROM post_comments WHERE post_id = p.id 
                    ORDER BY created_at ASC
                ) c), '[]'
            ) as comments
            FROM school_posts p
            WHERE p.school_id = $1
            ORDER BY p.created_at DESC
        `, [school_id, user_id]);

        res.status(200).json(feed.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ADD COMMENT: Let a parent post a comment
exports.addComment = async (req, res) => {
    const { post_id, parent_name, comment_text } = req.body;
    
    try {
        const newComment = await pool.query(`
            INSERT INTO post_comments (post_id, parent_name, comment_text)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [post_id, parent_name, comment_text]);

        res.status(201).json(newComment.rows[0]);
    } catch (err) {
        console.error("Add Comment Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};
exports.toggleLike = async (req, res) => {
    const { post_id } = req.body;
    const user_id = req.user.id;

    try {
        const existingLike = await pool.query(
            "SELECT id FROM post_likes WHERE post_id = $1 AND user_id = $2",
            [post_id, user_id]
        );

        if (existingLike.rows.length > 0) {
            // REMOVE LIKE
            await pool.query("DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2", [post_id, user_id]);
            const result = await pool.query(
                "UPDATE school_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1 RETURNING likes_count", 
                [post_id]
            );
            return res.status(200).json({ isLiked: false, likesCount: result.rows[0].likes_count });
        } else {
            // ADD LIKE
            await pool.query("INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)", [post_id, user_id]);
            const result = await pool.query(
                "UPDATE school_posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count", 
                [post_id]
            );
            return res.status(200).json({ isLiked: true, likesCount: result.rows[0].likes_count });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};