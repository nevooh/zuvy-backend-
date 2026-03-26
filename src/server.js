// src/server.js

const express = require('express');
const path = require('path');
require('dotenv').config();
const { protect } = require('./middleware/authMiddleware');

const app = express();

// --- Body Parsers ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- API ROUTES ---
// Auth & Identity
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/identity', require('./routes/identityRoutes'));

// Master & School Management
app.use('/api/master', require('./routes/masterAuthRoutes')); 
app.use('/api/master', require('./routes/masterSchoolRoutes'));
app.use('/api/school', require('./routes/schoolRoutes'));
app.use('/api/blueprints', require('./routes/blueprintRoutes'));

// Finance & Payments
app.use('/api/fee-types', require('./routes/feeTypeRoutes'));
app.use('/api/class-fees', require('./routes/classFeeRoutes'));
app.use('/api/fee-engine', require('./routes/feeEngineRoutes'));
app.use('/api/finance', require('./routes/financeRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes'));

// Student & Academic
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/student-profile', require('./routes/studentProfileRoutes'));
app.use('/api/student-optionals', require('./routes/studentOptionalRoutes'));
app.use('/api/classes', require('./routes/classRoutes'));
app.use('/api/subjects', require('./routes/subjectsRoutes'));
app.use('/api/exams', protect, require('./routes/examsRoutes'));
app.use('/api/marks', protect, require('./routes/marksRoutes'));

// Teacher & Admin
app.use('/api/teachers', require('./routes/teacherRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// Parent Portal
app.use('/api/parent-auth', require('./routes/parentAuthRoutes'));
app.use('/api/parent/finance', require('./routes/parentFinanceRoutes'));
app.use('/api/parent/finance', require('./routes/parentPaymentRoute'));

// Communication & Utilities
app.use('/api/sms', require('./routes/smsRoutes'));
app.use('/api', require('./routes/smsTest'));
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/reports', require('./routes/reportsRoutes'));
app.use('/api/stats', require('./routes/statsRoutes'));
app.use('/api/terms', require('./routes/termRoutes'));

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: "Backend is running!" });
});

// --- Serve Flutter Frontend ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// --- SERVER LISTEN ---
const PORT = process.env.PORT || 8080; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});