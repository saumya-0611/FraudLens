const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth.routes');           // Shivansh
const usersRoutes = require('./routes/users.routes');         // Shivansh
const auditRoutes = require('./routes/audit.routes');         // Shivansh
const transactionsRoutes = require('./routes/transactions.routes');
const alertsRoutes = require('./routes/alerts.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const modelsRoutes = require('./routes/models.routes');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Give every request an id; it is returned in error bodies so problems can be traced.
app.use((req, res, next) => {
  req.id = 'r-' + crypto.randomBytes(3).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Health check (no /api prefix, public).
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/models', modelsRoutes);

// Unknown route -> 404 in the CONTRACTS error shape.
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Resource not found.', request_id: req.id },
  });
});

// Central error handler (must have 4 arguments). Every non-2xx uses the CONTRACTS shape.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON.', request_id: req.id },
    });
  }
  const status = err.status || 500;
  const code = err.code && err.status ? err.code : 'SERVER_ERROR';
  if (status >= 500) console.error(`[${req.id}]`, err); // full detail only in the server log
  res.status(status).json({
    error: {
      code,
      message: status >= 500 ? 'Something went wrong on the server.' : err.message,
      request_id: req.id,
    },
  });
});

module.exports = app;