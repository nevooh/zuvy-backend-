// Global error handler — mount this last in server.js
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== 'production';

  // Postgres unique-constraint violation
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Record already exists.' });
  }

  // Postgres foreign-key violation
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Referenced record does not exist.' });
  }

  // JWT errors bubbled up without being caught
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired.' });
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);

  return res.status(err.status || 500).json({
    success: false,
    message: isDev ? err.message : 'Internal server error.',
  });
};
