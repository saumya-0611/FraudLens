const router = require('express').Router();
const env = require('../config/env');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { driftCheck } = require('../validation/schemas');
const { audit } = require('../audit/auditLogger');
const { asyncHandler, AppError } = require('../utils/errors');

const VERSION_REGEX = /^[a-zA-Z0-9_.-]{1,30}$/;

/**
 * Recursively strips account_ref from all levels of an object or array.
 */
function sanitizeDeep(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date || obj instanceof RegExp || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeDeep);
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'account_ref') {
      continue;
    }
    cleaned[key] = typeof value === 'object' && value !== null
      ? sanitizeDeep(value)
      : value;
  }
  return cleaned;
}

/**
 * Proxies an HTTP request to the internal ML service.
 * Appends X-Internal-Token header, enforces timeout, and deep-sanitizes the response.
 */
async function callMlService(endpoint, { method = 'GET', body = null, timeoutMs = 10000 } = {}) {
  const baseUrl = (env.mlServiceUrl || 'http://localhost:8000').replace(/\/+$/, '');
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

  const headers = {
    Accept: 'application/json',
  };

  if (env.internalMlToken) {
    headers['X-Internal-Token'] = env.internalMlToken;
  }

  const fetchOptions = {
    method,
    headers,
  };

  if (body !== null && body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    fetchOptions.signal = AbortSignal.timeout(timeoutMs);
  }

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new AppError(504, 'SERVER_ERROR', 'ML service request timed out.');
    }
    throw new AppError(503, 'SERVER_ERROR', 'ML service is unavailable.');
  }

  let responseData;
  const contentType = (res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : '') || '';
  if (contentType.includes('application/json')) {
    try {
      responseData = await res.json();
    } catch {
      responseData = {};
    }
  } else {
    try {
      const text = await res.text();
      responseData = text ? { message: text } : {};
    } catch {
      responseData = {};
    }
  }

  return {
    status: res.status,
    ok: res.ok,
    data: sanitizeDeep(responseData),
  };
}

// GET /api/models - List model versions, active version, and latest drift report
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const upstream = await callMlService('/models', {
      method: 'GET',
      timeoutMs: 10000,
    });

    res.status(upstream.status).json(upstream.data);
  })
);

// POST /api/models/drift-check - Compute PSI drift check on recent predictions
router.post(
  '/drift-check',
  authenticate,
  authorize('ADMIN'),
  validate(driftCheck),
  asyncHandler(async (req, res) => {
    const sampleSize = req.body?.sample_size;
    const query = sampleSize === undefined ? '' : `?${new URLSearchParams({ sample_size: sampleSize })}`;
    const upstream = await callMlService(`/drift/check${query}`, {
      method: 'POST',
      timeoutMs: 10000,
    });

    if (upstream.ok) {
      try {
        await audit({
          req,
          userId: req.user?.id,
          username: req.user?.username || 'system',
          action: 'MODEL_DRIFT_CHECK',
          entity: 'model',
          entityId: upstream.data?.model_version || null,
          details: {
            sample_size: upstream.data?.sample_size,
            psi_score: upstream.data?.psi_score,
            status: upstream.data?.status,
          },
        });
      } catch (auditErr) {
        console.error('[ModelsRoute] Audit log failed for MODEL_DRIFT_CHECK:', auditErr.message);
      }
    }

    res.status(upstream.status).json(upstream.data);
  })
);

// POST /api/models/retrain - Trigger candidate model retraining (30s timeout, 202 on success)
router.post(
  '/retrain',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const upstream = await callMlService('/retrain', {
      method: 'POST',
      body: req.body,
      timeoutMs: 30000, // 30-second timeout per CONTRACTS and Task B6
    });

    if (upstream.ok) {
      try {
        await audit({
          req,
          userId: req.user?.id,
          username: req.user?.username || 'system',
          action: 'MODEL_RETRAIN',
          entity: 'model',
          entityId: upstream.data?.version || null,
          details: {
            status: upstream.data?.status,
            metrics: upstream.data?.metrics,
            version: upstream.data?.version,
          },
        });
      } catch (auditErr) {
        console.error('[ModelsRoute] Audit log failed for MODEL_RETRAIN:', auditErr.message);
      }
      return res.status(202).json(upstream.data);
    }

    res.status(upstream.status).json(upstream.data);
  })
);

// POST /api/models/:version/activate - Activate validated model version
router.post(
  '/:version/activate',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { version } = req.params;

    if (!version || !VERSION_REGEX.test(version)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid model version identifier.');
    }

    const upstream = await callMlService(`/models/${encodeURIComponent(version)}/activate`, {
      method: 'POST',
      body: req.body,
      timeoutMs: 10000,
    });

    if (upstream.ok) {
      try {
        await audit({
          req,
          userId: req.user?.id,
          username: req.user?.username || 'system',
          action: 'MODEL_ACTIVATED',
          entity: 'model',
          entityId: version,
          details: {
            version,
            status: upstream.data?.status,
          },
        });
      } catch (auditErr) {
        console.error('[ModelsRoute] Audit log failed for MODEL_ACTIVATED:', auditErr.message);
      }
    }

    res.status(upstream.status).json(upstream.data);
  })
);

module.exports = router;
module.exports.callMlService = callMlService;
module.exports.sanitizeDeep = sanitizeDeep;
