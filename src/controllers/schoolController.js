const { pool } = require('../config/db');

exports.getSchoolProfile = async (req, res) => {
  const schoolId = req.user?.school_id;

  if (!schoolId)
    return res.status(401).json({ error: "Unauthorized: Missing school ID" });

  try {
    const result = await pool.query(
      `SELECT
         s.id, s.name, s.email, s.is_active,
         s.settlement_account,
         sp.motto, sp.phone_primary, sp.phone_secondary,
         sp.p_o_box, sp.town_city, sp.logo_url, sp.bank_account
       FROM schools s
       LEFT JOIN school_profiles sp ON s.id = sp.school_id
       WHERE s.id = $1`,
      [schoolId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "School profile not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[getSchoolProfile]', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updateSchoolProfile = async (req, res) => {
  const school_id = req.user.school_id;
  const {
    name, email,
    settlement_account,
    motto, phone_primary, phone_secondary,
    p_o_box, town_city, logo_url, bank_account
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE schools SET name=$1, email=$2, settlement_account=$3 WHERE id=$4`,
      [name, email, settlement_account || '', school_id]
    );

    await client.query(
      `INSERT INTO school_profiles (school_id, motto, phone_primary, phone_secondary, p_o_box, town_city, logo_url, bank_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (school_id) DO UPDATE SET
         motto              = EXCLUDED.motto,
         phone_primary      = EXCLUDED.phone_primary,
         phone_secondary    = EXCLUDED.phone_secondary,
         p_o_box            = EXCLUDED.p_o_box,
         town_city          = EXCLUDED.town_city,
         logo_url           = EXCLUDED.logo_url,
         bank_account       = EXCLUDED.bank_account,
         updated_at         = CURRENT_TIMESTAMP`,
      [school_id, motto || '', phone_primary || '', phone_secondary || '', p_o_box || '', town_city || '', logo_url || '', bank_account || '']
    );

    await client.query('COMMIT');
    res.json({ message: "School profile updated successfully" });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[updateSchoolProfile]', err.message);
    res.status(500).json({ error: "Failed to update profile. Please try again." });
  } finally {
    client.release();
  }
};

exports.updateSettlementDetails = async (req, res) => {
  const { account } = req.body;
  const school_id = req.user.school_id;
  try {
    await pool.query(
      "UPDATE schools SET settlement_account=$1 WHERE id=$2",
      [account, school_id]
    );
    res.status(200).json({ success: true, message: "Settlement account updated!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
