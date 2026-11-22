const rateLimit = require('express-rate-limit');
const { hasServiceToken } = require('./serviceAuth');
const { isForeignBrowserRequest } = require('./browserRequest');

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function denyForeignBrowserWrites(req, res, next) {
  if (safeMethods.has(req.method) || !isForeignBrowserRequest(req)) {
    return next();
  }
  return res.status(403).json({
    error: {
      code: 'FORBIDDEN',
      message: 'Browser writes require a same-origin request.',
      request_id: req.id,
    },
  });
}

function isIngestion(req) {
  return req.method === 'POST' && /^\/transactions\/?$/i.test(req.path);
}

function limiter(limit, skip) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
        request_id: req.id,
      },
    }),
  });
}

const apiLimiter = limiter(300, (req) => isIngestion(req) && hasServiceToken(req));
const ingestionLimiter = limiter(120, (req) => !isIngestion(req) || hasServiceToken(req));

module.exports = { denyForeignBrowserWrites, apiLimiter, ingestionLimiter };
