const { pool } = require('../config/db');

exports.getSchoolProfile = async (req, res) => {
  // 🛰️ TRACE 1: Did the request even arrive?
  console.log("--- 📥 GET PROFILE REQUEST RECEIVED ---");
  
  const schoolId = req.user?.school_id; 
  console.log("Token School ID:", schoolId);

  if (!schoolId) {
    console.log("❌ ERROR: No school_id found in req.user. Check your auth middleware!");
    return res.status(401).json({ error: "Unauthorized: Missing school ID" });
  }

  try {
    // 🛰️ TRACE 2: Running the Query
    console.log("Running DB Query for ID:", schoolId);
    
    const result = await pool.query(
      `SELECT 
          s.id, s.name, s.email, s.is_active, 
          s.settlement_paybill, s.settlement_account, 
          sp.motto, sp.phone_primary, sp.phone_secondary, 
          sp.p_o_box, sp.town_city, sp.logo_url 
       FROM schools s
       LEFT JOIN school_profiles sp ON s.id = sp.school_id
       WHERE s.id = $1`,
      [schoolId]
    );

    // 🛰️ TRACE 3: Did we get rows?
    console.log("Query completed. Rows found:", result.rows.length);

    if (result.rows.length === 0) {
      console.log("⚠️ 404: School ID exists in token but NOT in 'schools' table.");
      return res.status(404).json({ error: "School profile not found" });
    }

    // 🛰️ TRACE 4: Success
    console.log("✅ Sending data for:", result.rows[0].name);
    res.json(result.rows[0]);
    
  } catch (err) {
    // 🛰️ TRACE 5: Database Crash
    console.error("🔥 DATABASE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// UPDATE /api/school/profile
exports.updateSchoolProfile = async (req, res) => {
  console.log("--- 🚀 SECURE UPDATE START ---");

  // 1. Get ID from Token (The Truth)
  const school_id = req.user.school_id; 

  // 2. Extract only the fields we want from the body
  const { 
    name, email, 
    settlement_paybill, settlement_account,
    motto, phone_primary, phone_secondary, 
    p_o_box, town_city, logo_url 
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update Core Table (schools)
   await client.query(
      `UPDATE schools 
       SET name = $1, 
           email = $2, 
           settlement_paybill = $3, 
           settlement_account = $4 
       WHERE id = $5`,
      [name, email, settlement_paybill || '', settlement_account || '', school_id]
    );

    // Upsert Profile Table (school_profiles)
    await client.query(
      `INSERT INTO school_profiles (school_id, motto, phone_primary, phone_secondary, p_o_box, town_city, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (school_id) 
       DO UPDATE SET 
          motto = EXCLUDED.motto, 
         
          phone_primary = EXCLUDED.phone_primary,
          phone_secondary = EXCLUDED.phone_secondary,
          p_o_box = EXCLUDED.p_o_box,
          town_city = EXCLUDED.town_city,
          logo_url = EXCLUDED.logo_url,
          updated_at = CURRENT_TIMESTAMP`,
      [
        school_id, 
        motto || '', 
        phone_primary || '', 
        phone_secondary || '', 
        p_o_box || '', 
        town_city || '', 
        logo_url || ''
      ]
    );

    await client.query('COMMIT');
    console.log("🎉 SECURE TRANSACTION COMMITTED!");
    res.json({ message: "Your school profile has been updated successfully" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("🔥 DATABASE ERROR:", err.message);
    res.status(500).json({ error: "Failed to update profile. Please try again." });
  } finally {
    client.release();
    console.log("--- 🏁 UPDATE FINISHED ---");
  }
};
// Update School Settlement Details
// Update School Settlement Details
exports.updateSettlementDetails = async (req, res) => {
    const { paybill, account } = req.body;
    const school_id = req.user.school_id; // 👈 Fixed to match your auth middleware

    try {
        await pool.query(
            "UPDATE schools SET settlement_paybill = $1, settlement_account = $2 WHERE id = $3",
            [paybill, account, school_id]
        );
        res.status(200).json({ success: true, message: "Settlement details updated!" });
    } catch (err) {
        console.error("❌ Settlement Error:", err.message);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};