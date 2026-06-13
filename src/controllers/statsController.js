const { pool } = require('../config/db');

exports.getDashboardStats = async (req, res) => {
    const school_id = req.user.school_id;
    try {
        // 1. Core summary
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM students WHERE school_id = $1 AND status = 'ACTIVE') as active_students,
                (SELECT COUNT(*) FROM classes   WHERE school_id = $1 AND (is_archived = false OR is_archived IS NULL)) as total_classes,
                (SELECT COUNT(*) FROM students WHERE school_id = $1 AND gender ILIKE 'Male'   AND status = 'ACTIVE') as male_students,
                (SELECT COUNT(*) FROM students WHERE school_id = $1 AND gender ILIKE 'Female' AND status = 'ACTIVE') as female_students
        `, [school_id]);

        // 2. Recent students (with class name)
        const recentStudents = await pool.query(`
            SELECT s.full_name, s.admission_number, s.created_at,
                   c.class_name
            FROM students s
            LEFT JOIN classes c ON c.id = s.class_id
                AND (c.is_archived = false OR c.is_archived IS NULL)
            WHERE s.school_id = $1
            ORDER BY s.created_at DESC
            LIMIT 5
        `, [school_id]);

        // 3. Active term
        const termRes = await pool.query(`
            SELECT name, year, start_date, end_date, is_active,
                   (end_date::date - CURRENT_DATE) AS days_remaining
            FROM academic_terms
            WHERE school_id = $1 AND is_active = true
            LIMIT 1
        `, [school_id]);

        // 4. Monthly new students — last 6 months (fills gaps with 0)
        const admissionsRes = await pool.query(`
            WITH months AS (
                SELECT
                    TO_CHAR(gs, 'Mon') AS month,
                    gs AS month_date
                FROM generate_series(
                    DATE_TRUNC('month', NOW() - INTERVAL '5 months'),
                    DATE_TRUNC('month', NOW()),
                    '1 month'
                ) gs
            ),
            counts AS (
                SELECT DATE_TRUNC('month', created_at) AS month_date,
                       COUNT(*) AS count
                FROM students
                WHERE school_id = $1
                  AND created_at >= NOW() - INTERVAL '6 months'
                GROUP BY DATE_TRUNC('month', created_at)
            )
            SELECT m.month, COALESCE(c.count, 0) AS count
            FROM months m
            LEFT JOIN counts c ON c.month_date = m.month_date
            ORDER BY m.month_date
        `, [school_id]);

        // 5. Students per active class (ordered by level)
        const classStudentsRes = await pool.query(`
            SELECT c.class_name,
                   COUNT(s.id) AS student_count
            FROM classes c
            LEFT JOIN students s ON s.class_id = c.id AND s.status = 'ACTIVE'
            WHERE c.school_id = $1
              AND (c.is_archived = false OR c.is_archived IS NULL)
            GROUP BY c.class_name, c.level_order
            ORDER BY c.level_order ASC NULLS LAST
            LIMIT 12
        `, [school_id]);

        // 6. Fee collection summary for the active term
        const feeRes = await pool.query(`
            SELECT
                COALESCE(SUM(si.total_amount), 0)              AS total_invoiced,
                COALESCE(SUM(si.total_amount - si.balance), 0) AS total_paid
            FROM student_invoices si
            JOIN students        s  ON s.id  = si.student_id
            JOIN academic_terms  t  ON t.id  = si.term_id
            WHERE s.school_id = $1
              AND t.school_id = $1
              AND t.is_active = true
        `, [school_id]);

        res.status(200).json({
            summary: stats.rows[0] || {
                active_students: 0, total_classes: 0,
                male_students: 0,   female_students: 0,
            },
            recentStudents:    recentStudents.rows    || [],
            activeTerm:        termRes.rows[0]        || null,
            monthlyAdmissions: admissionsRes.rows      || [],
            studentsPerClass:  classStudentsRes.rows   || [],
            feeCollection:     feeRes.rows[0]          || { total_invoiced: 0, total_paid: 0 },
        });
    } catch (err) {
        console.error("Dashboard Stats Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};
