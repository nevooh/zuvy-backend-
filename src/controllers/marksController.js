const { pool } = require('../config/db');

// Add or update a student's mark for a subject + exam
exports.addMark = async (req, res) => {
    const school_id = req.user.school_id;
    const { student_id, subject_id, exam_id, score } = req.body;

    try {
        // 1️⃣ Check if mark already exists
        const existing = await pool.query(`
            SELECT id FROM marks
            WHERE student_id = $1 AND subject_id = $2 AND exam_id = $3 AND school_id = $4
        `, [student_id, subject_id, exam_id, school_id]);

        let mark_id;

        if (existing.rows.length > 0) {
            // Update existing score
            mark_id = existing.rows[0].id;
            await pool.query(`
                UPDATE marks
                SET score = $1, recorded_at = NOW()
                WHERE id = $2
            `, [score, mark_id]);
        } else {
            // Insert new mark
            const result = await pool.query(`
                INSERT INTO marks (student_id, subject_id, exam_id, class_id, score, school_id)
                SELECT $1, $2, $3, s.class_id, $4, $5
                FROM students s
                WHERE s.id = $1
                RETURNING id
            `, [student_id, subject_id, exam_id, score, school_id]);

            mark_id = result.rows[0].id;
        }

        // 2️⃣ Fetch class_id
        const classResult = await pool.query(`
            SELECT class_id FROM marks WHERE id = $1
        `, [mark_id]);

        const class_id = classResult.rows[0].class_id;

        // 3️⃣ Determine grading system
        const gradingSystemResult = await pool.query(`
            SELECT gs.id AS system_id
            FROM grading_assignments ga
            JOIN grading_systems gs ON ga.grading_system_id = gs.id
            WHERE ga.school_id = $1
              AND (ga.class_id = $2 OR ga.class_id IS NULL)
              AND (ga.subject_id = $3 OR ga.subject_id IS NULL)
            ORDER BY
              CASE WHEN ga.class_id IS NOT NULL AND ga.subject_id IS NOT NULL THEN 1
                   WHEN ga.class_id IS NOT NULL THEN 2
                   ELSE 3
              END
            LIMIT 1
        `, [school_id, class_id, subject_id]);

        let gradingSystemId;

        if (gradingSystemResult.rows.length > 0) {
            gradingSystemId = gradingSystemResult.rows[0].system_id;
        } else {
            const defaultSystem = await pool.query(`
                SELECT id FROM grading_systems
                WHERE school_id = $1 AND is_default = TRUE
                LIMIT 1
            `, [school_id]);

            if (defaultSystem.rows.length === 0) {
                return res.status(400).json({ message: 'No grading system found for this school' });
            }

            gradingSystemId = defaultSystem.rows[0].id;
        }

        // 4️⃣ Get grade + points
        const gradeResult = await pool.query(`
            SELECT grade_name, points, remarks
            FROM grade_ranges
            WHERE grading_system_id = $1
              AND min_score <= $2
              AND max_score >= $2
            LIMIT 1
        `, [gradingSystemId, score]);

        if (gradeResult.rows.length === 0) {
            return res.status(404).json({ message: 'No grade range found for this score' });
        }

        const { grade_name, points, remarks } = gradeResult.rows[0];

        // 5️⃣ Optional: update marks table with grade and points
        await pool.query(`
            UPDATE marks
            SET grade = $1, points = $2
            WHERE id = $3
        `, [grade_name, points, mark_id]);

        res.status(200).json({
            message: 'Mark recorded successfully',
            mark: {
                student_id,
                subject_id,
                exam_id,
                score,
                grade: grade_name,
                points,
                remarks
            }
        });

    } catch (err) {
        console.error("addMark Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};
// Get grade and points for a student in a subject/exam
exports.getStudentGrade = async (req, res) => {
    const { student_id, subject_id, exam_id } = req.params;
    const school_id = req.user.school_id;

    try {
        // 1️⃣ Get class_id and student score
        const markResult = await pool.query(`
            SELECT score, class_id
            FROM marks
            WHERE student_id = $1 AND subject_id = $2 AND exam_id = $3 AND school_id = $4
        `, [student_id, subject_id, exam_id, school_id]);

        if (markResult.rows.length === 0) {
            return res.status(404).json({ message: 'Mark not found' });
        }

        const { score, class_id } = markResult.rows[0];

        // 2️⃣ Find grading system for this class + subject override
        const gradingSystemResult = await pool.query(`
            SELECT gs.id AS system_id
            FROM grading_assignments ga
            JOIN grading_systems gs ON ga.grading_system_id = gs.id
            WHERE ga.school_id = $1
              AND (ga.class_id = $2 OR ga.class_id IS NULL)
              AND (ga.subject_id = $3 OR ga.subject_id IS NULL)
            ORDER BY
              CASE WHEN ga.class_id IS NOT NULL AND ga.subject_id IS NOT NULL THEN 1
                   WHEN ga.class_id IS NOT NULL THEN 2
                   ELSE 3
              END
            LIMIT 1
        `, [school_id, class_id, subject_id]);

        let gradingSystemId;

        if (gradingSystemResult.rows.length > 0) {
            gradingSystemId = gradingSystemResult.rows[0].system_id;
        } else {
            // fallback: default grading system for the school
            const defaultSystem = await pool.query(`
                SELECT id FROM grading_systems
                WHERE school_id = $1 AND is_default = TRUE
                LIMIT 1
            `, [school_id]);

            if (defaultSystem.rows.length === 0) {
                return res.status(400).json({ message: 'No grading system found for this school' });
            }
            gradingSystemId = defaultSystem.rows[0].id;
        }

        // 3️⃣ Find grade and points
        const gradeResult = await pool.query(`
            SELECT grade_name, points, remarks
            FROM grade_ranges
            WHERE grading_system_id = $1
              AND min_score <= $2
              AND max_score >= $2
            LIMIT 1
        `, [gradingSystemId, score]);

        if (gradeResult.rows.length === 0) {
            return res.status(404).json({ message: 'No grade range found for this score' });
        }

        res.status(200).json({
            score,
            grade: gradeResult.rows[0].grade_name,
            points: gradeResult.rows[0].points,
            remarks: gradeResult.rows[0].remarks
        });

    } catch (err) {
        console.error("getStudentGrade Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};
 exports.getClassResults = async (req, res) => {
    const { class_id, exam_id } = req.params;
    const school_id = req.user.school_id;

    try {
        const results = await pool.query(`
            SELECT m.student_id, s.full_name, m.score
            FROM marks m
            JOIN students s ON m.student_id = s.id
            WHERE m.class_id = $1 AND m.exam_id = $2 AND m.school_id = $3
        `, [class_id, exam_id, school_id]);

        res.status(200).json({
            class_id,
            exam_id,
            students: results.rows
        });

    } catch (err) {
        console.error("getClassResults Error:", err.message);
        res.status(500).json({ error: err.message });
    }
};
