require('dotenv').config();
const validateEnv = require('./config/validateEnv');
validateEnv();

// Silence verbose debug logs in production without touching every callsite
if (process.env.NODE_ENV === 'production') {
  console.log   = () => {};
  console.debug = () => {};
  console.info  = () => {};
}

const runMigrations = require('./config/migrate');
runMigrations();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');
const { protect }  = require('./middleware/authMiddleware');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5000', 'http://localhost:8080'];

const isDev = process.env.NODE_ENV !== 'production';

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === 'null') return callback(null, true); // file:// / mobile / Postman
    if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const smsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'SMS rate limit reached.' },
});

const { startDLRPoller } = require('./services/smsService');
// after DB is ready:
startDLRPoller(); // polls every 5 min for pending messages

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Public (landing page registration + OTP login) ───────────────────────────
app.use('/api/public', require('./routes/publicRoutes'));

// ── Owner billing portal ──────────────────────────────────────────────────────
app.use('/api/owner',  require('./routes/ownerRoutes'));

// ── Instasend payment webhook (no auth — called by Instasend servers) ─────────
app.post('/api/billing/webhook', require('./controllers/schoolBillingController').instasendWebhook);

// ── Auth ──────────────────────────────────────────────────────────────────────
app.use('/api/auth',        authLimiter, require('./routes/authRoutes'));
app.use('/api/master',                   require('./routes/masterAuthRoutes'));
app.use('/api/master',                   require('./routes/masterSchoolRoutes'));
app.use('/api/master',                   require('./routes/masterStatsRoutes'));
app.use('/api/master',                   require('./routes/masterBillingRoutes'));
app.use('/api/parent-auth', authLimiter, require('./routes/parentAuthRoutes'));

// ── School & Setup ────────────────────────────────────────────────────────────
app.use('/api/school/billing', require('./routes/schoolBillingRoutes'));
app.use('/api/school',    require('./routes/schoolRoutes'));
app.use('/api/admin',     require('./routes/adminRoutes'));
app.use('/api/identity',  require('./routes/identityRoutes'));

// ── Academic ──────────────────────────────────────────────────────────────────
app.use('/api/terms',             require('./routes/termRoutes'));
app.use('/api/classes',           require('./routes/classRoutes'));
app.use('/api/subjects',          require('./routes/subjectsRoutes'));
app.use('/api/blueprints',        require('./routes/blueprintRoutes'));
app.use('/api/exams',    protect,  require('./routes/examsRoutes'));
app.use('/api/marks',    protect,  require('./routes/marksRoutes'));
app.use('/api/student-optionals', require('./routes/studentOptionalRoutes'));
app.use('/api/opening_balances',  require('./routes/openingBalanceRoutes'));

// ── Students & Teachers ───────────────────────────────────────────────────────
app.use('/api/students',        require('./routes/studentRoutes'));
app.use('/api/student-profile', require('./routes/studentProfileRoutes'));
app.use('/api/teacher',         require('./routes/teacherRoutes'));
app.use('/api/bulk-import',     require('./routes/bulkImportRoutes'));

// ── Finance ───────────────────────────────────────────────────────────────────
app.use('/api/finance',        require('./routes/financeRoutes'));
app.use('/api/fee-types',      require('./routes/feeTypeRoutes'));
app.use('/api/class-fees',     require('./routes/classFeeRoutes'));
app.use('/api/fee-engine',     require('./routes/feeEngineRoutes'));
app.use('/api/fees',           require('./routes/teacherFeeRoutes'));
app.use('/api/wallet',         require('./routes/walletRoutes'));
app.use('/api/parent/finance',   require('./routes/parentFinanceRoutes'));
app.use('/api/parent/finance',   require('./routes/parentPaymentRoute'));
app.use('/api/parent/academics', require('./routes/parentAcademicsRoutes'));

// ── Communication ─────────────────────────────────────────────────────────────
app.use('/api/sms',   smsLimiter, require('./routes/smsRoutes'));
app.use('/api/feed',  require('./routes/feedRoutes'));

// ── Reporting ─────────────────────────────────────────────────────────────────
app.use('/api/stats',   require('./routes/statsRoutes'));
app.use('/api/reports', require('./routes/reportsRoutes'));

// ── Analytics ─────────────────────────────────────────────────────────────────
app.use('/api/analytics/dashboard',       require('./routes/analytics/dashboardRoutes'));
app.use('/api/analytics/students',        require('./routes/analytics/studentsRoutes'));
app.use('/api/analytics/student',         require('./routes/analytics/studentProfileRoutes'));
app.use('/api/analytics/subjects',        require('./routes/analytics/subjectsRoutes'));
app.use('/api/analytics/exams',           require('./routes/analytics/examsRoutes'));
app.use('/api/analytics/results',         require('./routes/analytics/resultsRoutes'));
app.use('/api/analytics/grading',         require('./routes/analytics/gradingRoutes'));
app.use('/api/analytics/attendance',      require('./routes/analytics/attendanceRoutes'));
app.use('/api/analytics/teachers',        require('./routes/analytics/teachersRoutes'));
app.use('/api/analytics/timetable',       require('./routes/analytics/timetableRoutes'));
app.use('/api/analytics/reportcard',      require('./routes/analytics/reportCardRoutes'));
app.use('/api/analytics/sba',             require('./routes/analytics/sba'));
app.use('/api/analytics/sms',             smsLimiter, require('./routes/analytics/smsRoutes'));
app.use('/api/analytics/bulk-assignment', require('./routes/analytics/bulkAssignmentRoutes'));

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.error(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
