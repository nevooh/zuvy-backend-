const REQUIRED = [
  'DB_USER',
  'DB_HOST',
  'DB_DATABASE',
  'DB_PASSWORD',
  'DB_PORT',
  'JWT_SECRET',
];

module.exports = function validateEnv() {
  const missing = REQUIRED.filter(key => !process.env[key]);
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  // Fixed: Removed the duplicate/nested loop block and combined them cleanly
  if (isProduction && (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('replace_with'))) {
    console.error('JWT_SECRET must be a strong production-safe secret.');
    process.exit(1);
  }

  if (isProduction && !process.env.ALLOWED_ORIGINS) {
    console.error('ALLOWED_ORIGINS is required in production.');
    process.exit(1);
  }
};
