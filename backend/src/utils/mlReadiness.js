const env = require('../config/env');

const READINESS_TIMEOUT_MS = 1500;
let inflight;

async function checkMlReadiness() {
  const token = env.internalMlToken;
  if (!token?.trim()) return false;
  if (!inflight) {
    inflight = Promise.resolve()
      .then(() => fetch(env.mlServiceUrl.replace(/\/+$/, '') + '/ready', {
        method: 'HEAD',
        redirect: 'error',
        headers: { 'X-Internal-Token': token },
        signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
      }))
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { inflight = undefined; });
  }
  return inflight;
}

module.exports = { checkMlReadiness, READINESS_TIMEOUT_MS };
