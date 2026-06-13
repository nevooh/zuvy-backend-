const { normalizePhone } = require('./phone');

function normalizedParentPhoneSql(column = 'parent_phone') {
  return `
    CASE
      WHEN REGEXP_REPLACE(COALESCE(${column}, ''), '[\\s+\\-()]', '', 'g') LIKE '0%'
        THEN '254' || SUBSTRING(REGEXP_REPLACE(COALESCE(${column}, ''), '[\\s+\\-()]', '', 'g') FROM 2)
      WHEN REGEXP_REPLACE(COALESCE(${column}, ''), '[\\s+\\-()]', '', 'g') ~ '^[71]'
        THEN '254' || REGEXP_REPLACE(COALESCE(${column}, ''), '[\\s+\\-()]', '', 'g')
      ELSE REGEXP_REPLACE(COALESCE(${column}, ''), '[\\s+\\-()]', '', 'g')
    END
  `;
}

function isParentRole(req) {
  return req.user?.role === 'parent';
}

async function assertParentOwnsStudent(pool, req, studentId) {
  const schoolId = req.user?.school_id || req.user?.schoolId || req.school_id;
  const phoneNumber = req.user?.phoneNumber;

  if (!schoolId || !phoneNumber) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const result = await pool.query(
    `SELECT id
       FROM students
      WHERE id = $1
        AND school_id = $2
        AND status = 'ACTIVE'
        AND ${normalizedParentPhoneSql('parent_phone')} = $3
      LIMIT 1`,
    [studentId, schoolId, normalizePhone(phoneNumber)]
  );

  if (result.rowCount === 0) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  return true;
}

module.exports = {
  assertParentOwnsStudent,
  isParentRole,
  normalizePhone,
  normalizedParentPhoneSql,
};
