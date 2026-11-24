const jwt = require('jsonwebtoken');
const { signToken } = require('../utils/jwt');

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
});

function issueSession(res, user) {
  const token = signToken(user);
  const { exp, iat } = jwt.decode(token);
  const lifetime = exp - iat;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1) {
    throw new Error('JWT_EXPIRES_IN must be a positive whole number of seconds.');
  }
  res.cookie('fl_token', token, { ...cookieOptions(), maxAge: lifetime * 1000 });
  return lifetime;
}

module.exports = { cookieOptions, issueSession };
