const bcrypt = require('bcryptjs');
const db = require('./src/config/db');

const createMaster = async () => {
  try {
    // 1️⃣ Set master details
    const fullName = 'Super Master';
    const email = 'master@domain.com';
    const password = 'SuperSecret123'; // You can change this

    // 2️⃣ Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3️⃣ Insert into master_admins table
    const result = await db.query(
      'INSERT INTO master_admins (full_name, email, password) VALUES ($1, $2, $3) RETURNING *',
      [fullName, email, hashedPassword]
    );

    console.log('✅ Master Admin created successfully:');
    console.log(result.rows[0]);
    console.log('Login email:', email);
    console.log('Login password:', password);
    process.exit(0);

  } catch (err) {
    console.error('❌ Error creating master admin:', err.message);
    process.exit(1);
  }
};

createMaster();
