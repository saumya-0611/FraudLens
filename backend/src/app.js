const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { denyForeignBrowserWrites, apiLimiter, ingestionLimiter } = require('./middleware/apiHardening');

const authRoutes = require('./routes/auth.routes');           // Shivansh
const usersRoutes = require('./routes/users.routes');         // Shivansh
const auditRoutes = require('./routes/audit.routes');         // Shivansh
const transactionsRoutes = require('./routes/transactions.routes');
const alertsRoutes = require('./routes/alerts.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const modelsRoutes = require('./routes/models.routes');

const app = express();

app.disable('x-powered-by');
app.use(helmet());

// Give every request an id; it is returned in error bodies so problems can be traced.
app.use((req, res, next) => {
  req.id = 'r-' + crypto.randomBytes(3).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use('/api', denyForeignBrowserWrites, apiLimiter, ingestionLimiter);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Health check (no /api prefix, public).
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// OpenAPI 3.0 JSON spec & Swagger UI (/api-docs and /api-docs/openapi.json)
const swaggerDirs = [
  path.resolve(__dirname, './swagger'),
  path.resolve(__dirname, '../../docs/swagger'),
  path.resolve(__dirname, '../swagger'),
];
app.get('/api-docs/openapi.json', (req, res) => {
  for (const dir of swaggerDirs) {
    const p = path.join(dir, 'openapi.json');
    if (fs.existsSync(p)) {
      return res.sendFile(p);
    }
  }
  return res.json({ openapi: '3.0.3', info: { title: 'FraudLens API', version: '1.0.0' }, paths: {} });
});
app.get('/api-docs', (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self' https://unpkg.com 'unsafe-inline';");
  for (const dir of swaggerDirs) {
    const p = path.join(dir, 'index.html');
    if (fs.existsSync(p)) {
      const html = fs.readFileSync(p, 'utf8').replace('./openapi.json', '/api-docs/openapi.json');
      return res.type('html').send(html);
    }
  }
  return res.type('html').send('<html><body><h1>FraudLens Swagger UI</h1></body></html>');
});

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
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.', request_id: req.id },
    });
  }
  const status = err.status || 500;
  const code = err.code && err.status ? err.code : 'SERVER_ERROR';
  if (status >= 500) console.error(`[${req.id}] Request failed:`, err.code || err.name);
  res.status(status).json({
    error: {
      code,
      message: status >= 500 ? 'Something went wrong on the server.' : err.message,
      request_id: req.id,
    },
  });
});

module.exports = app;
