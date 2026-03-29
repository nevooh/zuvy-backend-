const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const Papa = require('papaparse');
const XLSX = require('xlsx');

// Strip all spaces and lowercase for fuzzy matching
const normalize = (str) => String(str).toLowerCase().replace(/\s+/g, '');

// Multer — store in memory, no disk
const storage = multer.memoryStorage();
exports.upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv') || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});

function parseFile(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    const text = file.buffer.toString('utf8');
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    return result.data;
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  throw new Error('Unsupported file type');
}

exports.bulkImportStudents = async (req, res) => {
  const school_id = req.user.school_id;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let rows;
  try {
    rows = parseFile(req.file);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!rows.length) {
    return res.status(400).json({ error: 'File is empty' });
  }

  // Normalize headers
  rows = rows.map(row => {
    const normalized = {};
    for (const key of Object.keys(row)) {
      normalized[key.trim().toLowerCase().replace(/\s+/g, '_')] =
        typeof row[key] === 'string' ? row[key].trim() : row[key];
    }
    return normalized;
  });

  // Fetch classes with stream_name
  const classesResult = await pool.query(
    `SELECT id, class_name, stream_name FROM classes WHERE school_id = $1`,
    [school_id]
  );

  // Key = "grade1_brown", "grade1_" (no stream), "grade2_red" etc
  const classMap = {};
  for (const cls of classesResult.rows) {
    const key = normalize(cls.class_name) + '_' + normalize(cls.stream_name || '');
    classMap[key] = cls.id;
  }

  let openingTermId = null;
  const getOpeningTerm = async () => {
    if (openingTermId) return openingTermId;
    let termResult = await pool.query(
      `SELECT id FROM academic_terms WHERE school_id = $1 AND name = 'Opening Balance' LIMIT 1`,
      [school_id]
    );
    if (termResult.rowCount > 0) {
      openingTermId = termResult.rows[0].id;
    } else {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const insert = await pool.query(
        `INSERT INTO academic_terms(id, school_id, name, year, start_date, end_date, is_active, is_locked, created_at)
         VALUES($1, $2, 'Opening Balance', $3, $4, $4, false, true, NOW()) RETURNING id`,
        [uuidv4(), school_id, now.getFullYear(), today]
      );
      openingTermId = insert.rows[0].id;
    }
    return openingTermId;
  };

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const full_name = row['full_name'] || row['name'] || row['student_name'];
    const admission_number = row['admission_number'] || row['adm'] || row['adm_no'] || row['admission'];
    const class_name = row['class_name'] || row['class'] || row['grade'];
    const stream_name = row['stream_name'] || row['stream'] || '';

    if (!full_name) {
      results.failed++;
      results.errors.push(`Row ${rowNum}: missing full_name`);
      continue;
    }
    if (!admission_number) {
      results.failed++;
      results.errors.push(`Row ${rowNum}: missing admission_number`);
      continue;
    }
    if (!class_name) {
      results.failed++;
      results.errors.push(`Row ${rowNum}: missing class_name`);
      continue;
    }

    const key = normalize(class_name) + '_' + normalize(stream_name);
    const class_id = classMap[key];
    if (!class_id) {
      results.failed++;
      results.errors.push(`Row ${rowNum}: class "${class_name} ${stream_name}".trim() not found — check class_name and stream_name match your system`);
      continue;
    }

    const gender = row['gender'] || null;
    const date_of_birth = row['date_of_birth'] || row['dob'] || null;
    const parent_name = row['parent_name'] || null;
    const parent_phone = row['parent_phone'] || row['parent_contact'] || null;
    const emergency_contact_name = row['emergency_contact_name'] || null;
    const emergency_contact_phone = row['emergency_contact_phone'] || null;
    const opening_fee = parseFloat(row['opening_fee'] || row['opening_balance'] || row['arrears'] || 0);

    try {
      const studentInsert = await pool.query(
  `INSERT INTO students(
    id, school_id, full_name, admission_number, date_of_birth,
    gender, parent_name, parent_phone,
    emergency_contact_name, emergency_contact_phone,
    status, class_id, grade_level, created_at
  )
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12,NOW())
  ON CONFLICT ON CONSTRAINT unique_admission_per_school DO NOTHING
  RETURNING id`,
  [
    uuidv4(), school_id, full_name, admission_number,
    date_of_birth || null, gender, parent_name, parent_phone,
    emergency_contact_name, emergency_contact_phone, class_id,
    class_name  // 👈 this sets grade_level directly from what admin typed
  ]
);

      if (studentInsert.rowCount === 0) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: admission "${admission_number}" already exists — skipped`);
        continue;
      }

      const student_id = studentInsert.rows[0].id;

      if (opening_fee > 0) {
        const term_id = await getOpeningTerm();
        const invoice_id = uuidv4();

        await pool.query(
          `INSERT INTO student_invoices(id, school_id, student_id, term_id, total_amount, balance, status, previous_balance_carried, created_at)
           VALUES($1,$2,$3,$4,$5,$5,'UNPAID',0,NOW())`,
          [invoice_id, school_id, student_id, term_id, opening_fee]
        );

        await pool.query(
          `INSERT INTO student_ledger(id, student_id, term_id, type, amount, reference_type, reference_id, created_at)
           VALUES($1,$2,$3,'DEBIT',$4,'Opening Balance',$5,NOW())`,
          [uuidv4(), student_id, term_id, opening_fee, invoice_id]
        );
      }

      results.success++;

    } catch (err) {
      results.failed++;
      results.errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }

  return res.status(200).json({
    message: `Import complete`,
    success: results.success,
    failed: results.failed,
    errors: results.errors
  });
};