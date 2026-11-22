
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'fl_token';
const JWT_ALGORITHM = 'HS256';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.trim().length < 32 || /^change_me/i.test(secret)) {
    throw new Error('JWT_SECRET must be a randomly generated secret of at least 32 characters.');
  }

  return secret;
}

function signToken(user) {
  if (
    !user ||
    !Number.isSafeInteger(Number(user.id)) ||
    Number(user.id) <= 0 ||
    typeof user.username !== 'string' ||
    !['ADMIN', 'ANALYST', 'VIEWER'].includes(user.role)
  ) {
    throw new Error('Invalid user data for JWT signing.');
  }

  return jwt.sign(
    {
      username: user.username,
      role: user.role,
    },
    getJwtSecret(),
    {
      algorithm: JWT_ALGORITHM,
      subject: String(user.id),
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    }
  );
}

function verifyRequestCookie(req) {
  try {
    const cookieHeader = req?.headers?.cookie;

    if (typeof cookieHeader !== 'string') {
      return null;
    }

    const matchingCookies = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE_NAME}=`));

    // Reject ambiguous duplicate session cookies.
    if (matchingCookies.length !== 1) {
      return null;
    }

    const token = decodeURIComponent(
      matchingCookies[0].slice(COOKIE_NAME.length + 1)
    );

    if (!token) {
      return null;
    }

    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: [JWT_ALGORITHM],
    });

    const id = Number(payload.sub);

    if (
      !Number.isSafeInteger(payload.exp) ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof payload.username !== 'string' ||
      !['ADMIN', 'ANALYST', 'VIEWER'].includes(payload.role)
    ) {
      return null;
    }

    return {
      id,
      username: payload.username,
      role: payload.role,
    };
  } catch {
    // Invalid, expired or tampered tokens never authenticate.
    return null;
  }
}

module.exports = {
  signToken,
  verifyRequestCookie,
};
