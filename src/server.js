// src/server.js

const express = require('express');
const cors = require('cors');
require('dotenv').config();


// 1️⃣ Create Express app
const app = express();
const { protect } = require('./middleware/authMiddleware');
// 🚀 Increase the limit so logos can be uploaded (50MB is plenty)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// 2️⃣ Middleware
app.use(cors());
app.use(express.json()); // for parsing application/json
app.use('/api/terms', require('./routes/termRoutes'));
app.use('/api/fee-types', require('./routes/feeTypeRoutes'));
app.use('/api/class-fees', require('./routes/classFeeRoutes'));
// Add this with your other routes
app.use('/api/stats', require('./routes/statsRoutes'));
// 3️⃣ Import auth routes
const authRoutes = require('./routes/authRoutes');

// 4️⃣ Mount auth routes
app.use('/api/auth', authRoutes);
app.use('/api/identity', require('./routes/identityRoutes'));
const feeEngineRoutes = require('./routes/feeEngineRoutes');
const studentOptionalRoutes = require('./routes/studentOptionalRoutes');
const smsRoutes = require('./routes/smsRoutes');// Make sure the path is correct
// ... other middleware
app.use('/api/student-optionals', studentOptionalRoutes);
// ... other middleware ...
app.use('/api/fee-engine', feeEngineRoutes);
// ... other app.use calls
// Inside your main server file (e.g., server.js)
app.use('/api/school', require('./routes/schoolRoutes'));
// 5️⃣ Health check route
app.get('/health', (req, res) => {
    res.json({ status: "Backend is running!" });
});
const masterAuthRoutes = require('./routes/masterAuthRoutes');
const masterSchoolRoutes = require('./routes/masterSchoolRoutes');
const financeRoutes = require('./routes/financeRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const smsTest = require('./routes/smsTest');
app.use('/api/sms', smsRoutes);
app.use('/api', smsTest);
app.use('/api/reports', reportsRoutes);
const walletRoutes = require('./routes/walletRoutes');
app.use('/api/wallet', walletRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/master', masterAuthRoutes);  // login
app.use('/api/master', masterSchoolRoutes); // protected routes
const studentRoutes = require('./routes/studentRoutes');
app.use('/api/students', studentRoutes);
app.use('/api/classes', require('./routes/classRoutes'));
app.use('/api/blueprints', require('./routes/blueprintRoutes'));
const parentAuthRoutes = require('./routes/parentAuthRoutes');
app.use('/api/parent-auth', parentAuthRoutes);
const postRoutes = require('./routes/postRoutes');
const parentFinanceRoutes = require('./routes/parentFinanceRoutes'); 
app.use('/api/parent/finance', parentFinanceRoutes);
// Remove the 'src/' since we are already inside it
const parentPaymentRoute = require('./routes/parentPaymentRoute');

// Now your Flutter baseUrl will match: http://localhost:5000/api/parent/finance
app.use('/api/parent/finance', parentPaymentRoute);
// ... other routes
app.use('/api/posts', postRoutes);
const subjectsRoutes = require('./routes/subjectsRoutes');
const examsRoutes = require('./routes/examsRoutes');
const marksRoutes = require('./routes/marksRoutes');
app.use('/api/subjects', subjectsRoutes);   // subjects protected
app.use('/api/exams', protect, examsRoutes);         // exams protected
app.use('/api/marks', protect, marksRoutes);   
const teacherRoutes = require('./routes/teacherRoutes');
app.use('/api/teachers', teacherRoutes);
const studentProfileRoutes = require('./routes/studentProfileRoutes');

// Set the base path
app.use('/api/student-profile', studentProfileRoutes);
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5000;

// Explicitly bind to 0.0.0.0 to allow network access
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://172.17.88.145:${PORT}`);
    console.log(`✅ Network access enabled for your phone!`);
});