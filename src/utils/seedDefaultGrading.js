/**
 * Seeds Kenya CBC default grading scales for a school on first analytics load.
 * Runs once silently — skips entirely if any scale already exists.
 */

// ── Band definitions ──────────────────────────────────────────────────────────

// Official KNEC/KICD CBC 4-band scale — Primary & Pre-Primary
// AE starts at 30% (not 25%), BE covers 0–29%
const PREPRIMARY_AND_PRIMARY_BANDS = [
  { min_score: 75, max_score: 100, label: 'EE',  description: 'Exceeding Expectation',    points: null },
  { min_score: 50, max_score: 74,  label: 'ME',  description: 'Meeting Expectation',       points: null },
  { min_score: 30, max_score: 49,  label: 'AE',  description: 'Approaching Expectation',   points: null },
  { min_score: 0,  max_score: 29,  label: 'BE',  description: 'Below Expectation',         points: null },
];

// Official KJSEA / KPSEA 8-band scale (Kenya government)
// BE2 starts at 0% so a zero score still gets a label
const JSS_BANDS = [
  { min_score: 90, max_score: 100, label: 'EE1', description: 'Exceeding Expectation 1',  points: 8 },
  { min_score: 75, max_score: 89,  label: 'EE2', description: 'Exceeding Expectation 2',  points: 7 },
  { min_score: 58, max_score: 74,  label: 'ME1', description: 'Meeting Expectation 1',    points: 6 },
  { min_score: 41, max_score: 57,  label: 'ME2', description: 'Meeting Expectation 2',    points: 5 },
  { min_score: 31, max_score: 40,  label: 'AE1', description: 'Approaching Expectation 1',points: 4 },
  { min_score: 21, max_score: 30,  label: 'AE2', description: 'Approaching Expectation 2',points: 3 },
  { min_score: 11, max_score: 20,  label: 'BE1', description: 'Below Expectation 1',      points: 2 },
  { min_score: 0,  max_score: 10,  label: 'BE2', description: 'Below Expectation 2',      points: 1 },
];

// ── Scale templates ───────────────────────────────────────────────────────────

const SCALE_TEMPLATES = [
  {
    name:              'Kenya CBC Pre-Primary',
    school_level:      'preschool',
    subjects_to_count: null,
    bands:             PREPRIMARY_AND_PRIMARY_BANDS,
  },
  {
    name:              'Kenya CBC Primary',
    school_level:      'primary',
    subjects_to_count: 7,
    bands:             PREPRIMARY_AND_PRIMARY_BANDS,
  },
  {
    name:              'Kenya CBC JSS',
    school_level:      'jss',
    subjects_to_count: 7,
    bands:             JSS_BANDS,
  },
];

// ── Main seed function ────────────────────────────────────────────────────────

async function seedDefaultGrading(school_id, pool) {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const tmpl of SCALE_TEMPLATES) {
        // Skip this level if a default scale already exists for it
        const existing = await client.query(
          `SELECT id FROM grading_scales
           WHERE school_id = $1 AND school_level = $2 AND is_default = true
           LIMIT 1`,
          [school_id, tmpl.school_level]
        );
        if (existing.rows.length > 0) continue;

        // 1. Insert the scale
        const scaleRes = await client.query(
          `INSERT INTO grading_scales
             (school_id, name, school_level, subjects_to_count, is_default)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id`,
          [school_id, tmpl.name, tmpl.school_level, tmpl.subjects_to_count]
        );
        const scale_id = scaleRes.rows[0].id;

        // 2. Get all active classes at this level
        const classesRes = await client.query(
          `SELECT id FROM classes
           WHERE school_id = $1 AND level_type = $2 AND is_archived = false`,
          [school_id, tmpl.school_level]
        );

        // 3. For every class → every subject → insert all bands
        for (const cls of classesRes.rows) {
          const subjectsRes = await client.query(
            `SELECT subject_id FROM class_subjects WHERE class_id = $1`,
            [cls.id]
          );

          for (const subj of subjectsRes.rows) {
            for (const band of tmpl.bands) {
              await client.query(
                `INSERT INTO grade_bands
                   (scale_id, subject_id, class_id, min_score, max_score,
                    label, description, points)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT DO NOTHING`,
                [
                  scale_id,
                  subj.subject_id,
                  cls.id,
                  band.min_score,
                  band.max_score,
                  band.label,
                  band.description,
                  band.points,
                ]
              );
            }
          }
        }
      }

      await client.query('COMMIT');
      console.log(`✅ Kenya CBC default grading seeded for school ${school_id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // Non-fatal — never crash the app over seeding
    console.warn(`⚠️  Default grading seed skipped: ${err.message}`);
  }
}

// ── Apply bands to a single new class (call when a class is created) ──────────

async function applyDefaultBandsToClass(school_id, class_id, level_type, pool) {
  try {
    const tmpl = SCALE_TEMPLATES.find(t => t.school_level === level_type);
    if (!tmpl) return;

    // Find the school's default scale for this level
    const scaleRes = await pool.query(
      `SELECT id FROM grading_scales
       WHERE school_id = $1 AND school_level = $2 AND is_default = true
       LIMIT 1`,
      [school_id, level_type]
    );
    if (!scaleRes.rows[0]) return;
    const scale_id = scaleRes.rows[0].id;

    const subjectsRes = await pool.query(
      `SELECT subject_id FROM class_subjects WHERE class_id = $1`,
      [class_id]
    );

    for (const subj of subjectsRes.rows) {
      for (const band of tmpl.bands) {
        await pool.query(
          `INSERT INTO grade_bands
             (scale_id, subject_id, class_id, min_score, max_score,
              label, description, points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [
            scale_id, subj.subject_id, class_id,
            band.min_score, band.max_score,
            band.label, band.description, band.points,
          ]
        );
      }
    }
  } catch (err) {
    console.warn(`⚠️  applyDefaultBandsToClass skipped: ${err.message}`);
  }
}

// ── Apply bands when a subject is added to a class ────────────────────────────

async function applyDefaultBandsToSubject(school_id, class_id, subject_id, level_type, pool) {
  try {
    const tmpl = SCALE_TEMPLATES.find(t => t.school_level === level_type);
    if (!tmpl) return;

    const scaleRes = await pool.query(
      `SELECT id FROM grading_scales
       WHERE school_id = $1 AND school_level = $2 AND is_default = true
       LIMIT 1`,
      [school_id, level_type]
    );
    if (!scaleRes.rows[0]) return;
    const scale_id = scaleRes.rows[0].id;

    for (const band of tmpl.bands) {
      await pool.query(
        `INSERT INTO grade_bands
           (scale_id, subject_id, class_id, min_score, max_score,
            label, description, points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          scale_id, subject_id, class_id,
          band.min_score, band.max_score,
          band.label, band.description, band.points,
        ]
      );
    }
  } catch (err) {
    console.warn(`⚠️  applyDefaultBandsToSubject skipped: ${err.message}`);
  }
}

module.exports = {
  seedDefaultGrading,
  applyDefaultBandsToClass,
  applyDefaultBandsToSubject,
};
