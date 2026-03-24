const { pool } = require('../config/db');

/**
 * Create a new academic term and auto-deploy fees from Blueprint
 */
exports.createTerm = async (req, res) => {
  // We now expect 'term_number' (1, 2, or 3) from the frontend
  const { name, year, start_date, end_date, term_number } = req.body;
  const school_id = req.user.school_id;

  if (!term_number) {
    return res.status(400).json({ error: "term_number (1, 2, or 3) is required to deploy fees." });
  }

  // Use a client from the pool to handle a Transaction
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Start Transaction

    // 1. Create the Academic Term
    const termResult = await client.query(
      `INSERT INTO academic_terms (school_id, name, year, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [school_id, name, year, start_date, end_date]
    );
    
    const newTerm = termResult.rows[0];

 // 2. SaaS Automation: Map JSON blueprint to Relational Live Structure
    const deployFeesQuery = `
      INSERT INTO class_fee_structure (school_id, class_id, term_id, fee_type_id, amount)
      SELECT 
        b.school_id, 
        c.id,                                      -- This gets the UUID from 'classes'
        $1,                                        -- The new term ID
        (fee_item->>'fee_type_id')::uuid,          -- Extract from JSON data
        (fee_item->>'amount')::numeric             -- Extract from JSON data
      FROM fee_blueprints b
      -- JOIN using the correct column 'class_name' we just found!
      JOIN classes c ON c.school_id = b.school_id AND c.class_name = b.grade_name
      CROSS JOIN LATERAL jsonb_array_elements(b.data->'terms'->$3) AS fee_item
      WHERE b.school_id = $2 
        AND b.is_active = true
    `;
    
    // Pass the parameters (convert term_number to string for JSON key matching)
    await client.query(deployFeesQuery, [newTerm.id, school_id, term_number.toString()]);
    await client.query('COMMIT'); // Save everything permanently
    
    console.log(`Success: Term ${name} created and fees deployed for School: ${school_id}`);
    res.status(201).json(newTerm);

  } catch (err) {
    await client.query('ROLLBACK'); // Undo everything if any step fails
    console.error('Create term error:', err.message);
    res.status(500).json({ error: "Failed to create term and deploy fees: " + err.message });
  } finally {
    client.release(); // Return the connection back to the pool
  }
};
/**
 * Get all terms for a school
 */
exports.getTerms = async (req, res) => {
  const school_id = req.user.school_id;

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM academic_terms
      WHERE school_id = $1
      ORDER BY is_active DESC, start_date ASC
      `,
      [school_id]
    );

    return res.json(rows);

  } catch (err) {
    console.error('Get terms error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
/** * Activate a term */
exports.activateTerm = async (req, res) => {
  const { id } = req.params;
  const school_id = req.user.school_id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Deactivate current active term
    await client.query(
      `UPDATE academic_terms
       SET is_active = false
       WHERE school_id = $1 AND is_active = true`,
      [school_id]
    );

    // 2. Activate the new term
    // THIS WILL FIRE THE TRIGGER: activate_academic_term_snapshot()
    const result = await client.query(
      `UPDATE academic_terms
       SET is_active = true
       WHERE id = $1 AND school_id = $2
       RETURNING *`,
      [id, school_id]
    );

    await client.query('COMMIT');

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Term not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ACTIVATION ERROR:', err.message); // <--- LOG THIS
    res.status(400).json({ error: "Database Trigger Error: " + err.message });
  } finally {
    client.release();
  }
};
exports.lockTerm = async (req, res) => {
  const { id } = req.params;
  const school_id = req.user.school_id;

  try {
    await pool.query('SELECT lock_academic_term($1, $2)', [id, school_id]);
    res.json({ message: 'Term locked successfully' });
  } catch (err) {
    console.error('Lock term error:', err);
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update term info (Flexible for Upcoming, End-date only for Active)
 */
exports.updateTerm = async (req, res) => {
  const { id } = req.params;
  const school_id = req.user.school_id;

  // Flutter might send 'startDate' or 'start_date'. This handles both.
  const name = req.body.name;
  const year = req.body.year;
  const start_date = req.body.start_date || req.body.startDate;
  const end_date = req.body.end_date || req.body.endDate;

  // Debug log: Check your terminal when you click update!
  console.log(`Updating Term: ${id} for School: ${school_id}`);
  console.log(`Data received:`, { name, year, start_date, end_date });

  try {
    const result = await pool.query(
      `UPDATE academic_terms 
       SET name = $1, 
           year = $2, 
           start_date = $3, 
           end_date = $4 
       WHERE id = $5 AND school_id = $6 
       RETURNING *`,
      [
        name, 
        parseInt(year), 
        start_date, 
        end_date, 
        id, 
        school_id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Term not found or unauthorized' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('DATABASE ERROR:', err.message);
    
    // Check if the error is from your Postgres triggers
    let clientMessage = err.message;
    if (err.message.contains('block_locked_term_edits')) {
        clientMessage = "Cannot edit: This term is locked.";
    }

    res.status(400).json({ error: clientMessage });
  }
};
/**
 * Snapshots the blueprint data into the term_fee_snapshots table
 * for the currently active term.
 */
exports.snapshotActiveTermFees = async (req, res) => {
  const school_id = req.user.school_id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get the ID and Term Number of the currently active term
    // Note: You might need to add 'term_number' to your academic_terms table 
    // if it's not there, or derive it from the name. 
    // For now, let's assume we are looking for the active one.
    const activeTermRes = await client.query(
      `SELECT id, name FROM academic_terms WHERE school_id = $1 AND is_active = true`,
      [school_id]
    );

    if (activeTermRes.rows.length === 0) {
      throw new Error("No active term found to snapshot.");
    }

    const activeTerm = activeTermRes.rows[0];
    
    // Logic to determine if it's term "1", "2", or "3" from the name
    // Adjust this regex based on how you name your terms (e.g., "Term 1 2026")
    const termMatch = activeTerm.name.match(/\d/); 
    const termNumber = termMatch ? termMatch[0] : "1"; 

    // 2. Clear existing snapshots for this term to avoid "Unique Constraint" errors
    await client.query(
      `DELETE FROM term_fee_snapshots WHERE school_id = $1 AND term_id = $2`,
      [school_id, activeTerm.id]
    );

    // 3. The "Magic" Query: Transfer from Blueprint to Snapshot
    const snapshotQuery = `
      INSERT INTO term_fee_snapshots (school_id, term_id, grade, fees)
      SELECT 
        school_id, 
        $1,                       -- The active term UUID
        grade_name,               -- Matches 'grade' in snapshot table
        data->'terms'->$2         -- Extracts the specific term array from JSON
      FROM fee_blueprints
      WHERE school_id = $3 
        AND is_active = true
        AND data->'terms' ? $2    -- Only if the term key exists in JSON
    `;

    await client.query(snapshotQuery, [activeTerm.id, termNumber, school_id]);

    await client.query('COMMIT');
    res.json({ message: `Snapshots created for ${activeTerm.name}` });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Snapshot Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
