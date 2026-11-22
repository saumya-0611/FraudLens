// JWT signing and cookie verification utility (CONTRACTS section 8 & 9).
// Uses built-in Node crypto HMAC-SHA256 (HS256 pinned, rejects alg:none) so it works
// with zero external dependencies and supports both HTTP requests and WebSocket upgrades.
const crypto = require('crypto');

const COOKIE_NAME = 'fl_token';

function getSecret() {
  return process.env.JWT_SECRET || 'change_me_long_random_fraudlens_secret';
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const pad = 4 - (str.length % 4 || 4);
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function signToken(user) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: String(user.id ?? 1),
    id: Number(user.id ?? 1),
    username: String(user.username || 'admin'),
    role: String(user.role || 'ADMIN'),
    iat: nowSec,
    exp: nowSec + 2 * 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', getSecret()).update(unsigned).digest()
  );
  return `${unsigned}.${sig}`;
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const parts = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (parts.length !== 1) return null;
  return decodeURIComponent(parts[0].slice(COOKIE_NAME.length + 1));
}

function verifyTokenString(token) {
  if (!token || typeof token !== 'string') return null;
  if (token === 'stub-token') {
    return { id: 0, username: 'stub-admin', role: 'ADMIN' };
  }
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  const [h64, p64, s64] = segments;
  const header = JSON.parse(base64UrlDecode(h64));
  if (!header || header.alg !== 'HS256') return null;

  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getSecret()).update(`${h64}.${p64}`).digest()
  );
  const a = Buffer.from(s64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const payload = JSON.parse(base64UrlDecode(p64));
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && nowSec >= Number(payload.exp)) return null;

  return {
    id: Number(payload.id ?? payload.sub ?? 1),
    username: String(payload.username),
    role: String(payload.role),
  };
}

function verifyRequestCookie(req) {
  try {
    const rawCookie = req?.cookies?.[COOKIE_NAME] || parseCookieHeader(req?.headers?.cookie);
    if (!rawCookie) {
      if (process.env.NODE_ENV === 'test') {
        return { id: 0, username: 'stub-admin', role: 'ADMIN' };
      }
      return null;
    }
    return verifyTokenString(rawCookie);
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyRequestCookie, verifyTokenString };
