const pool = require('../config/db');

// 1. GET ALL SUBJECTS (For the Flutter Selection Modal)
exports.getSchoolSubjects = async (req, res) => {
    try {
        // We filter by school_id to ensure Caleb's school doesn't see "Sky Tech High" subjects
        const result = await pool.query(
            'SELECT id, subject_name, subject_code, department, is_core FROM subjects WHERE school_id = $1 ORDER BY subject_name ASC',
            [req.user.school_id] // Assumes your authMiddleware provides this
        );

        res.status(200).json({
            success: true,
            subjects: result.rows // Flutter expects 'subjects' key
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. GET STUDENT CURRICULUM (Your existing logic, confirmed)
exports.getStudentCurriculum = async (req, res) => {
    const { id } = req.params; 

    try {
        const studentCheck = await pool.query(`
            SELECT id, admission_number, full_name, school_id 
            FROM students 
            WHERE (id::text = $1 OR admission_number = $1) 
            LIMIT 1
        `, [id]);

        if (studentCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        const student = studentCheck.rows[0];
        const studentUuid = student.id;

        const yearRes = await pool.query(`
            SELECT year FROM academic_terms 
            WHERE school_id = $1 
            ORDER BY year DESC LIMIT 1
        `, [student.school_id]);
        
        const activeYear = yearRes.rows[0]?.year || "2026";

        const curriculumQuery = `
            SELECT sub.subject_name, sub.subject_code, sub.department, ss.is_core, ss.academic_year
            FROM student_subjects ss
            JOIN subjects sub ON ss.subject_id = sub.id
            WHERE ss.student_id = $1 AND ss.academic_year = $2
            ORDER BY ss.is_core DESC, sub.subject_name ASC
        `;
        
        const result = await pool.query(curriculumQuery, [studentUuid, activeYear]);

        res.status(200).json({
            success: true,
            student_name: student.full_name,
            meta: {
                student_id: studentUuid,
                academic_year: activeYear,
            },
            curriculum: {
                core_subjects: result.rows.filter(s => s.is_core === true),
                elective_subjects: result.rows.filter(s => s.is_core === false)
            }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
exports.assignSubjects = async (req, res) => {
    const { student_id, subject_ids } = req.body;
    const school_id = req.user.school_id;

    if (!student_id || !subject_ids) {
        return res.status(400).json({ success: false, message: "Missing student_id or subject_ids" });
    }

    try {
        await pool.query('BEGIN');

        // 1. Fetch active year
        const yearRes = await pool.query(
            'SELECT year FROM academic_terms WHERE school_id = $1 ORDER BY year DESC LIMIT 1',
            [school_id]
        );
        
        const activeYear = yearRes.rows[0]?.year;
        if (!activeYear) throw new Error("No active academic year found.");

        // 2. Clear old records for this year
        await pool.query(
            'DELETE FROM student_subjects WHERE student_id = $1 AND academic_year = $2',
            [student_id, activeYear]
        );

        // 3. Insert with inverted logic: NOT is_optional = is_core
        if (subject_ids.length > 0) {
            const insertQuery = `
                INSERT INTO student_subjects (student_id, subject_id, academic_year, is_core, school_id)
                SELECT 
                    $1::uuid, 
                    id, 
                    $2::int, 
                    NOT is_optional, -- 🎯 If NOT optional, then it IS core.
                    $4::uuid
                FROM subjects 
                WHERE id = ANY($3::uuid[])
            `;
            
            await pool.query(insertQuery, [student_id, activeYear, subject_ids, school_id]);
        }

        await pool.query('COMMIT');
        
        res.status(200).json({ 
            success: true, 
            message: "Curriculum synced! Core/Electives mapped correctly.",
            synced_year: activeYear 
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("SKY TECH ERROR:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};