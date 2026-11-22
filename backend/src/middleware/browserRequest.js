function isForeignBrowserRequest(req) {
  const site = req.headers['sec-fetch-site'];
  return site === 'cross-site' || site === 'same-site';
}

const localFrontendOrigins = 'http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173';

function parseOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#\\\s]+$/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password || url.hostname.includes('*') ? null : url.origin;
  } catch {
    return null;
  }
}

function configuredWebSocketOrigins() {
  const configured = process.env.WS_ALLOWED_ORIGINS ??
    (process.env.NODE_ENV === 'production' ? '' : localFrontendOrigins);
  const origins = configured.trim() ? configured.split(',').map((value) => parseOrigin(value.trim())) : [];
  if (origins.includes(null)) throw new Error('WS_ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
  return new Set(origins);
}

module.exports = { isForeignBrowserRequest, parseOrigin, configuredWebSocketOrigins };
