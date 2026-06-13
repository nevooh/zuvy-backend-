const db = require('../config/db');

exports.getOverview = async (req, res) => {
  try {
    const [schools, students, sms, topSms, activity] = await Promise.all([

      db.query(`
        SELECT
          COUNT(*)                                                              AS total_schools,
          COUNT(*) FILTER (WHERE is_active = true)                             AS active_schools,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))     AS new_schools_month
        FROM schools
      `),

      db.query(`
        SELECT COUNT(*) AS active_students FROM students WHERE status = 'ACTIVE'
      `),

      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE)                      AS sms_today,
          COUNT(*) FILTER (WHERE sent_at >= date_trunc('week',  NOW()))        AS sms_week,
          COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW()))        AS sms_month
        FROM sent_sms
      `),

      db.query(`
        SELECT sc.name AS school_name, COUNT(sm.id)::int AS count
        FROM sent_sms sm
        JOIN schools sc ON sc.id = sm.school_id
        WHERE sm.sent_at >= date_trunc('month', NOW())
        GROUP BY sc.name
        ORDER BY count DESC
        LIMIT 5
      `),

      // most recent SMS send per school (one row each)
      db.query(`
        SELECT sc.name AS school, 'sms_sent' AS action, sm.sent_at AS time
        FROM (
          SELECT DISTINCT ON (school_id) school_id, sent_at
          FROM sent_sms
          ORDER BY school_id, sent_at DESC
        ) sm
        JOIN schools sc ON sc.id = sm.school_id
        ORDER BY sm.sent_at DESC
        LIMIT 10
      `),
    ]);

    const s  = schools.rows[0];
    const st = students.rows[0];
    const sm = sms.rows[0];

    res.json({
      active_schools:    parseInt(s.active_schools),
      total_schools:     parseInt(s.total_schools),
      active_students:   parseInt(st.active_students),
      new_schools_month: parseInt(s.new_schools_month),
      sms_today:         parseInt(sm.sms_today),
      sms_week:          parseInt(sm.sms_week),
      sms_month:         parseInt(sm.sms_month),
      top_sms:           topSms.rows,
      activity:          activity.rows.map(r => ({
        school: r.school,
        action: r.action,
        detail: 'SMS sent',
        time:   r.time,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSmsAnalytics = async (req, res) => {
  try {
    const [totals, monthly, bySchool] = await Promise.all([

      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE)                      AS today,
          COUNT(*) FILTER (WHERE sent_at >= date_trunc('week',  NOW()))        AS week,
          COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW()))        AS month,
          COUNT(*)                                                              AS all_time
        FROM sent_sms
      `),

      // monthly history from the very first SMS ever sent
      db.query(`
        SELECT
          TO_CHAR(month, 'Mon YY')  AS label,
          COALESCE(cnt, 0)::int     AS count
        FROM generate_series(
          date_trunc('month', COALESCE(
            (SELECT MIN(sent_at) FROM sent_sms),
            NOW()
          ))::date,
          date_trunc('month', NOW())::date,
          '1 month'
        ) AS month
        LEFT JOIN (
          SELECT date_trunc('month', sent_at)::date AS m, COUNT(*) AS cnt
          FROM sent_sms
          GROUP BY m
        ) counts ON counts.m = month
        ORDER BY month
      `),

      db.query(`
        SELECT
          sc.name AS school_name,
          COUNT(*) FILTER (WHERE sm.sent_at >= CURRENT_DATE)                   AS today,
          COUNT(*) FILTER (WHERE sm.sent_at >= date_trunc('week',  NOW()))     AS week,
          COUNT(*) FILTER (WHERE sm.sent_at >= date_trunc('month', NOW()))     AS month,
          COUNT(sm.id)                                                          AS all_time
        FROM schools sc
        LEFT JOIN sent_sms sm ON sm.school_id = sc.id
        GROUP BY sc.name
        ORDER BY all_time DESC NULLS LAST
      `),
    ]);

    const t = totals.rows[0];

    res.json({
      today:     parseInt(t.today),
      week:      parseInt(t.week),
      month:     parseInt(t.month),
      all_time:  parseInt(t.all_time),
      monthly:   monthly.rows,
      by_school: bySchool.rows.map(r => ({
        school_name: r.school_name,
        today:       parseInt(r.today    || 0),
        week:        parseInt(r.week     || 0),
        month:       parseInt(r.month    || 0),
        all_time:    parseInt(r.all_time || 0),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
